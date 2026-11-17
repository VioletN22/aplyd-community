import * as store from '../secret-store';
import type { SecretStore } from '../secret-store';
import type { CalendarCredentials } from './oauth';
export interface CalendarSecrets extends CalendarCredentials { refreshToken?: string }
const NAME = 'google-calendar';
export class CalendarKeychain {
  constructor(private secrets: SecretStore = store) {}
  async read(): Promise<CalendarSecrets | null> {
    const encoded = await this.secrets.getSecret(NAME);
    if (encoded === null) return null;
    try {
      const parsed = JSON.parse(encoded);
      if (!parsed || typeof parsed.clientId !== 'string' || typeof parsed.clientSecret !== 'string' ||
          (parsed.refreshToken !== undefined && typeof parsed.refreshToken !== 'string')) throw new Error();
      return parsed as CalendarSecrets;
    } catch { throw new Error('Calendar credentials could not be read. Save them again in Settings.'); }
  }
  write(secrets: CalendarSecrets): Promise<void> { return this.secrets.setSecret(NAME, JSON.stringify(secrets)); }
  clear(): Promise<void> { return this.secrets.deleteSecret(NAME); }
}
