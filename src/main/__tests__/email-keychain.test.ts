import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { SecretStore } from '../secret-store';
import { Keychain, KEYCHAIN_SERVICE } from '../email/keychain';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import { EmailStore } from '../email/store';

const SECRET = 'abcdefghijklmnop';

function fakeStore(): SecretStore {
  const values = new Map<string,string>();
  return {getSecret:async name=>values.get(name)??null,setSecret:async(name,value)=>{values.set(name,value);},deleteSecret:async name=>{values.delete(name);}};
}
describe('mail protected credentials adapter', () => {
  it('isolates accounts and handles arbitrary characters without a subprocess', async () => {
    const store = fakeStore(); const set = vi.spyOn(store,'setSecret'); const kc = new Keychain(store);
    const secret = 'password " \\ $() ` quoted 🔑';
    await kc.setPassword('person@example.com', secret);
    expect(set.mock.calls[0][0]).toMatch(new RegExp(`^${KEYCHAIN_SERVICE}-[a-f0-9]{64}$`));
    expect(await kc.getPassword('Person@EXAMPLE.com')).toBe(secret);
    expect(await kc.getPassword('other@example.com')).toBeNull();
    await kc.deletePassword('person@example.com');
    expect(await kc.getPassword('person@example.com')).toBeNull();
  });
  it('propagates secure store failure without fallback',async () => {
    const store = fakeStore(); store.setSecret=async()=>{throw new Error('Secure storage unavailable');};
    await expect(new Keychain(store).setPassword('person@example.com',SECRET)).rejects.toThrow('Secure storage unavailable');
  });
  it('never writes the password into sqlite', async () => {
    const db = new DatabaseSync(':memory:') as unknown as MigrationDb;
    createSchema(db);
    runMigrationLadder(db);
    const f = fakeStore();
    await new Keychain(f).setPassword('me@gmail.com', SECRET);
    new EmailStore(db).addAccount('me@gmail.com');

    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r: any) => String(r.name));
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => String(r.name));
      expect(cols.some((c) => /pass|secret|token/i.test(c)), `${t} has a password-like column`).toBe(false);
      for (const row of db.prepare(`SELECT * FROM ${t}`).all()) {
        expect(JSON.stringify(row)).not.toContain(SECRET);
      }
    }
  });
});
