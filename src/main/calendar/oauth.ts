import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServer } from 'http';
export const CALENDAR_SCOPES = ['calendar.events','calendar.readonly','calendar.app.created'].map(scope => `https://www.googleapis.com/auth/${scope}`);
export interface CalendarCredentials { clientId: string; clientSecret: string }
export interface CalendarTokens { access_token: string; refresh_token?: string; expires_in: number }
export function buildAuthorizationUrl(clientId: string, redirect: string, state: string, challenge: string): string {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id:clientId,redirect_uri:redirect,response_type:'code',scope:CALENDAR_SCOPES.join(' '),
    state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent',
  })}`;
}
export function readOAuthCallback(url: URL, expectedState: string): string {
  const received = Buffer.from(url.searchParams.get('state') || '');
  const expected = Buffer.from(expectedState);
  if (received.length !== expected.length || !timingSafeEqual(received,expected)) throw new Error('Google sign-in state did not match. Start Connect again.');
  if (url.searchParams.has('error')) throw new Error('Google sign-in was declined. You can connect again when ready.');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Google did not return an authorization code. Start Connect again.');
  return code;
}
export async function requestTokens(values: Record<string,string>, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<CalendarTokens> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(values),signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
  } catch { throw new Error('Google sign-in could not reach the server. Check your connection.'); }
  signal?.throwIfAborted();
  if (!response.ok) throw new Error('Google access could not be renewed. Check your OAuth credentials, then Connect again.');
  const tokens = await response.json() as CalendarTokens;
  if (!tokens.access_token) throw new Error('Google returned no access token. Connect again.');
  return tokens;
}

export async function authorizeDesktop(credentials: CalendarCredentials, openExternal: (url:string)=>Promise<unknown>, fetcher: typeof fetch = fetch, timeoutMs = 120000, signal?: AbortSignal): Promise<CalendarTokens> {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let redirect = '';
  const code = await new Promise<string>((resolve,reject) => {
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',cancel);
      server.close();
      server.closeAllConnections();
      if (error) reject(error); else resolve(value!);
    };
    const cancel = () => finish(new Error('Google sign-in cancelled.'));
    const server = createServer((request,response) => {
      const url = new URL(request.url || '/',redirect || 'http://127.0.0.1');
      if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
      try {
        const code = readOAuthCallback(url,state);
        response.writeHead(200,{'Content-Type':'text/plain'}).end('Connected. You can return to Aplyd.');
        finish(undefined,code);
      } catch (error) {
        response.writeHead(400,{'Content-Type':'text/plain'}).end('Sign-in failed. Return to Aplyd and try Connect again.');
        finish(error as Error);
      }
    });
    const timer = setTimeout(() => finish(new Error('Google sign-in timed out. Click Connect to try again.')),timeoutMs);
    signal?.addEventListener('abort',cancel,{once:true});
    server.on('error',() => finish(new Error('Could not open the local Google sign-in callback. Retry Connect.')));
    if (signal?.aborted) { cancel(); return; }
    server.listen(0,'127.0.0.1',() => {
      const address = server.address();
      if (!address || typeof address === 'string') { finish(new Error('Could not start Google sign-in.')); return; }
      redirect = `http://127.0.0.1:${address.port}/callback`;
      void openExternal(buildAuthorizationUrl(credentials.clientId,redirect,state,challenge)).catch(() => finish(new Error('Could not open Google sign-in in your browser.')));
    });
  });
  return requestTokens({client_id:credentials.clientId,client_secret:credentials.clientSecret,code,
    code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'},fetcher,signal);
}
