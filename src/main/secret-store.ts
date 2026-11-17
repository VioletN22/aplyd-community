import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SecretStore {
  getSecret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
}
export interface SecretEncryption {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend?(): string;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{result: string; shouldReEncrypt: boolean}>;
}
const unavailable = 'Secure credential storage is unavailable. On Linux, unlock or enable a desktop keyring (Secret Service or KWallet), then restart Aplyd. Credentials were not saved.';

export class SecretStorageUnavailableError extends Error {
  constructor(message = unavailable, public readonly code: 'SECRET_STORAGE_UNAVAILABLE' | 'SECRET_STORAGE_TIMEOUT' = 'SECRET_STORAGE_UNAVAILABLE') { super(message); this.name = 'SecretStorageUnavailableError'; }
}

/** Encrypted, app-isolated files. Electron protects encryption keys through the OS. */
export function createSecretStore(directory: () => string, encryption: () => SecretEncryption, platform: NodeJS.Platform = process.platform, timeoutMs = 5000): SecretStore {
  const pending = new Map<string, Promise<unknown>>();
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_,reject) => {
        timer = setTimeout(() => reject(new SecretStorageUnavailableError('Secure credential storage did not respond within five seconds. Unlock or authorize your operating system keyring, then retry. Credentials were not saved.', 'SECRET_STORAGE_TIMEOUT')),timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const pathFor = (name: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) throw new Error('Invalid credential name.');
    return join(directory(), `${name}.enc`);
  };
  const secure = async () => {
    const backend = encryption();
    if (backend.getSelectedStorageBackend?.() === 'basic_text') throw new SecretStorageUnavailableError();
    let available: boolean;
    try { available = await bounded(() => backend.isAsyncEncryptionAvailable()); }
    catch(error) { if (error instanceof SecretStorageUnavailableError) throw error; throw new SecretStorageUnavailableError(); }
    if (!available) throw new SecretStorageUnavailableError();
    return backend;
  };
  const serialize = <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const next = (pending.get(name) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(name, next);
    void next.finally(() => { if (pending.get(name) === next) pending.delete(name); }).catch(() => {});
    return next;
  };
  return {
    getSecret(name) {
      const path = pathFor(name);
      return serialize(name, async () => {
        let encrypted: Buffer;
        try { encrypted = await fs.readFile(path); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Could not read protected credentials.'); }
        const backend = await secure();
        if (platform === 'linux' && encrypted.subarray(0,3).toString() === 'v10') throw new SecretStorageUnavailableError();
        try { return (await bounded(() => backend.decryptStringAsync(encrypted))).result; }
        catch (error) { if (error instanceof SecretStorageUnavailableError) throw error; throw new Error('Could not unlock this credential. Reconnect the integration in Settings.'); }
      });
    },
    setSecret(name, value) {
      const path = pathFor(name);
      return serialize(name, async () => {
        if (!value) throw new Error('No credential supplied.');
        const backend = await secure();
        let encrypted: Buffer;
        try { encrypted = await bounded(() => backend.encryptStringAsync(value)); }
        catch (error) { if (error instanceof SecretStorageUnavailableError) throw error; throw new Error('Could not encrypt credentials. Nothing was saved.'); }
        // Chromium's asynchronous POSIX provider can fall back to the public v10
        // key even when availability reports true. This is never protected storage.
        if (encrypted.equals(Buffer.from(value)) || (platform === 'linux' && encrypted.subarray(0,3).toString() === 'v10')) throw new SecretStorageUnavailableError();
        const temp = `${path}.${randomUUID()}.tmp`;
        try {
          await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
          const file = await fs.open(temp, 'wx', 0o600);
          try { await file.writeFile(encrypted); await file.sync(); } finally { await file.close(); }
          await fs.rename(temp, path);
        } catch { throw new Error('Could not save protected credentials.'); }
        finally { await fs.rm(temp, { force: true }).catch(() => {}); }
      });
    },
    deleteSecret(name) {
      const path = pathFor(name);
      return serialize(name, async () => {
        try { await fs.rm(path, { force: true }); }
        catch { throw new Error('Could not remove protected credentials.'); }
      });
    },
  };
}
// Resolve Electron only when a real credential operation needs it; injected unit stores stay portable.
const store = createSecretStore(() => join((require('electron') as typeof import('electron')).app.getPath('userData'), 'secrets'), () => (require('electron') as typeof import('electron')).safeStorage);
export const getSecret = (name: string) => store.getSecret(name);
export const setSecret = (name: string, value: string) => store.setSecret(name, value);
export const deleteSecret = (name: string) => store.deleteSecret(name);
