import { addDays, zoneMidnight, type CalendarEvent } from '../../shared/calendar';
import type { CalendarStatus } from '../../shared/google-calendar';
import { GoogleCalendarClient } from './client';
import { fromGoogleEvent } from './mapping';
import { syncOwnedEvents } from './sync';
import { CalendarKeychain, type CalendarSecrets } from './keychain';
import { authorizeDesktop, requestTokens, type CalendarCredentials } from './oauth';

export interface CalendarSettings { get(key:string): string | null; set(key:string,value:string): void }
export { zoneMidnight } from '../../shared/calendar';

export class CalendarService {
  private secrets: CalendarSecrets | null = null;
  private access: {token:string;expires:number} | null = null;
  private refresh: Promise<string> | null = null;
  private generation = 0;
  private disconnecting = false;
  private running = false;
  private credentialMutation: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private syncFlight: Promise<void> | null = null;
  private oauthAbort: AbortController | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private fingerprint = '';
  private status: CalendarStatus = {configured:false,connected:false,connecting:false,syncing:false,lastSync:null,error:null};
  private connectionAbort = new AbortController();

  constructor(private source: ()=>CalendarEvent[], private settings: CalendarSettings,
    private notify: ()=>void, private openExternal: (url:string)=>Promise<unknown>,
    private keychain: Pick<CalendarKeychain,'read'|'write'|'clear'> = new CalendarKeychain(), private fetcher: typeof fetch = fetch) {
    this.ready = this.keychain.read().then(secrets => {
      this.secrets = secrets;
      this.status.configured = !!secrets?.clientId;
      this.status.connected = !!secrets?.refreshToken;
      this.status.lastSync = this.settings.get('calendar.lastSync');
    }).catch(error => { this.status.error = error instanceof Error ? error.message : 'Could not read protected Calendar credentials. Reconnect in Settings.'; });
  }
  async getStatus(): Promise<CalendarStatus> { await this.ready; return {...this.status}; }
  private changed(): void { this.notify(); }
  private persist(secrets: CalendarSecrets | null): Promise<void> {
    const operation = this.credentialMutation.then(() => secrets ? this.keychain.write(secrets) : this.keychain.clear());
    this.credentialMutation = operation.catch(() => {});
    return operation;
  }

  private clientForConnection(): GoogleCalendarClient {
    const generation = this.generation;
    const signal = this.connectionAbort.signal;
    return new GoogleCalendarClient(async force => {
      if (generation !== this.generation) throw new Error('Calendar connection changed.');
      const token = await this.token(force);
      if (generation !== this.generation) throw new Error('Calendar connection changed.');
      return token;
    }, this.fetcher, signal);
  }
  private invalidateConnection(): void {
    this.generation++;
    this.connectionAbort.abort();
    this.connectionAbort = new AbortController();
  }

  private async token(force: boolean): Promise<string> {
    await this.ready;
    if (!this.secrets?.refreshToken) throw new Error('Connect Google Calendar in Settings.');
    if (!force && this.access && this.access.expires>Date.now()+60000) return this.access.token;
    if (this.refresh) return this.refresh;
    const generation = this.generation;
    const secrets = this.secrets;
    this.refresh = (async () => {
      const tokens = await requestTokens({client_id:secrets.clientId,client_secret:secrets.clientSecret,refresh_token:secrets.refreshToken!,grant_type:'refresh_token'},this.fetcher,this.connectionAbort.signal);
      if (generation !== this.generation) throw new Error('Calendar connection changed.');
      this.access = {token:tokens.access_token,expires:Date.now()+tokens.expires_in*1000};
      if (tokens.refresh_token) {
        this.secrets = {...secrets,refreshToken:tokens.refresh_token};
        await this.persist(this.secrets);
      }
      return tokens.access_token;
    })().finally(() => { this.refresh=null; });
    return this.refresh;
  }
  async connect(credentials: CalendarCredentials): Promise<CalendarStatus> {
    await this.ready;
    if (this.oauthAbort || this.disconnecting) throw new Error('A Calendar connection change is still finishing. Please retry shortly.');
    if (!credentials.clientId.trim() || !credentials.clientSecret.trim()) throw new Error('Enter the Desktop OAuth client ID and secret.');
    this.oauthAbort = new AbortController();
    this.status.connecting=true; this.status.error=null; this.changed();
    this.invalidateConnection();
    const generation = this.generation;
    try {
      const tokens = await authorizeDesktop(credentials,this.openExternal,this.fetcher,120000,this.oauthAbort.signal);
      if (generation !== this.generation) throw new Error('Google sign-in cancelled.');
      if (!tokens.refresh_token) throw new Error('Google did not grant offline access. Connect again and accept the Calendar permissions.');
      const secrets = {...credentials,refreshToken:tokens.refresh_token};
      await this.persist(secrets);
      if (generation !== this.generation) { await this.persist(null); throw new Error('Google sign-in cancelled.'); }
      this.secrets=secrets;
      this.access={token:tokens.access_token,expires:Date.now()+tokens.expires_in*1000};
      this.status.configured=true; this.status.connected=true;
      this.settings.set('calendar.id','');
      if (this.syncFlight) await this.syncFlight;
      await this.sync();
    } catch (error) { if (generation === this.generation) this.status.error=error instanceof Error?error.message:'Google Calendar connection failed.'; throw error; }
    finally { this.status.connecting=false; this.oauthAbort=null; this.changed(); }
    return this.getStatus();
  }
  async disconnect(): Promise<void> {
    await this.ready;
    if (this.disconnecting) return;
    this.disconnecting = true;
    this.invalidateConnection();
    this.oauthAbort?.abort();
    this.secrets=null; this.access=null;
    if (this.debounce) clearTimeout(this.debounce);
    this.status={configured:false,connected:false,connecting:false,syncing:false,lastSync:null,error:null};
    this.changed();
    try {
      await this.persist(null);
      this.settings.set('calendar.id','');
      this.settings.set('calendar.lastSync','');
    } finally {
      this.disconnecting = false;
      this.changed();
    }
  }
  private async ensureCalendar(client: GoogleCalendarClient, generation: number): Promise<string> {
    const calendars = await client.listCalendars();
    if (generation !== this.generation) throw new Error('Calendar connection changed.');
    const stored = this.settings.get('calendar.id');
    const usable = calendars.filter(calendar => !calendar.primary && ['owner','writer'].includes(calendar.accessRole || ''));
    const found = usable.find(calendar => calendar.id===stored);
    const id = found?.id || await client.createCalendar();
    if (generation !== this.generation) throw new Error('Calendar connection changed.');
    this.settings.set('calendar.id',id);
    return id;
  }
  async sync(): Promise<void> {
    await this.ready;
    if (!this.status.connected) return;
    if (this.syncFlight) return this.syncFlight;
    const generation=this.generation;
    const client = this.clientForConnection();
    this.status.syncing=true; this.changed();
    this.syncFlight=(async()=>{
      const events=this.source();
      const calendarId=await this.ensureCalendar(client, generation);
      await syncOwnedEvents(client,calendarId,events);
      if (generation!==this.generation) return;
      this.status.lastSync=new Date().toISOString(); this.status.error=null;
      this.settings.set('calendar.lastSync',this.status.lastSync);
    })().catch(error=>{
      if(generation===this.generation)this.status.error=error instanceof Error?error.message:'Calendar sync failed. Retry when online.';
    }).finally(()=>{this.syncFlight=null;this.status.syncing=false;this.changed();});
    return this.syncFlight;
  }
  async week(startDay: string): Promise<CalendarEvent[]> {
    await this.ready;
    if (!this.status.connected) return [];
    const generation = this.generation;
    const events = await this.clientForConnection().listEvents('primary',{timeMin:zoneMidnight(startDay),timeMax:zoneMidnight(addDays(startDay,7))}).catch(error => {
      if (generation !== this.generation) return [];
      throw error;
    });
    if (generation !== this.generation) return [];
    return events.map(fromGoogleEvent).filter((event):event is CalendarEvent=>event!==null);
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    void this.ready.then(() => {
      if (this.running && generation === this.generation) return this.sync();
    });
    this.poll=setInterval(()=>{
      if(!this.status.connected)return;
      let next: string;
      try { next=JSON.stringify(this.source()); } catch { return; }
      if(next===this.fingerprint)return;
      this.fingerprint=next;
      if(this.debounce)clearTimeout(this.debounce);
      this.debounce=setTimeout(()=>{void this.sync();},10000);
    },3000);
    this.interval=setInterval(()=>{void this.sync();},10*60*1000);
    this.poll.unref?.();this.interval.unref?.();
  }
  stop(): void {
    this.running = false;
    this.invalidateConnection();
    this.oauthAbort?.abort();
    if(this.poll)clearInterval(this.poll);
    if(this.interval)clearInterval(this.interval);
    if(this.debounce)clearTimeout(this.debounce);
    this.poll=null;this.interval=null;
  }
}
