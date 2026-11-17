import { createHash } from 'node:crypto';
import * as secrets from '../secret-store';
import type { SecretStore } from '../secret-store';

export const KEYCHAIN_SERVICE = 'aplyd-community-imap';
/** Preserve the mailbox adapter API while using OS-protected storage on every platform. */
export class Keychain {
  constructor(private store: SecretStore = secrets) {}
  private name(email: string): string { return `${KEYCHAIN_SERVICE}-${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`; }
  async setPassword(email: string, password: string): Promise<void> {
    if (!password) throw new Error('No password given.');
    await this.store.setSecret(this.name(email), password);
  }
  getPassword(email: string): Promise<string | null> { return this.store.getSecret(this.name(email)); }
  deletePassword(email: string): Promise<void> { return this.store.deleteSecret(this.name(email)); }
}
