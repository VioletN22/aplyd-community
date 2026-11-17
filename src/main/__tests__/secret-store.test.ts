import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
vi.mock('electron', () => ({app:{getPath:()=>'/unused'},safeStorage:{}}));
import { createSecretStore, SecretStorageUnavailableError, type SecretEncryption } from '../secret-store';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir,{recursive:true,force:true}))); });
async function fixture(overrides: Partial<SecretEncryption> = {}, platform: NodeJS.Platform = process.platform) {
  const dir = await mkdtemp(join(tmpdir(),'aplyd-secrets-test-')); directories.push(dir);
  const key = randomBytes(32);
  const encryption: SecretEncryption = {
    isAsyncEncryptionAvailable:async()=>true, getSelectedStorageBackend:()=> 'gnome_libsecret',
    async encryptStringAsync(value) {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',key,iv);
      const data = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),data]);
    },
    async decryptStringAsync(value) {
      const decipher = createDecipheriv('aes-256-gcm',key,value.subarray(0,12),{authTagLength:16}); decipher.setAuthTag(value.subarray(12,28));
      return {result:Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8'),shouldReEncrypt:false};
    }, ...overrides,
  };
  return {dir,store:createSecretStore(()=>dir,()=>encryption,platform),encryption};
}
describe('portable protected credential store', () => {
  it('round-trips arbitrary secrets as ciphertext, replaces atomically and removes idempotently',async () => {
    const {dir,store} = await fixture(); const secret = 'private " value \\ with\nUnicode 🔑';
    expect(await store.getSecret('mail')).toBe(null);
    await store.setSecret('mail',secret);
    expect(await store.getSecret('mail')).toBe(secret);
    expect((await readFile(join(dir,'mail.enc'))).includes(Buffer.from(secret))).toBe(false);
    if(process.platform !== 'win32') expect((await stat(join(dir,'mail.enc'))).mode & 0o777).toBe(0o600);
    await Promise.all([store.setSecret('mail','first'),store.setSecret('mail','last')]);
    expect(await store.getSecret('mail')).toBe('last');
    expect(await readdir(dir)).toEqual(['mail.enc']);
    await store.deleteSecret('mail'); await store.deleteSecret('mail');
    expect(await store.getSecret('mail')).toBe(null);
  });
  it.each([{isAsyncEncryptionAvailable:async()=>false},{getSelectedStorageBackend:()=> 'basic_text'}])('refuses unavailable or plaintext Linux encryption',async overrides => {
    const {dir,store} = await fixture(overrides);
    await expect(store.setSecret('mail','secret')).rejects.toThrow('Secure credential storage is unavailable');
    expect(await readdir(dir)).toEqual([]);
    expect(await store.getSecret('mail')).toBeNull();
  });
  it.each(['macOS Keychain','Windows DPAPI','Linux Secret Service'])('supports protected %s adapters without shell commands',async platform => {
    const {store} = await fixture(platform === 'Linux Secret Service' ? {} : {getSelectedStorageBackend:undefined});
    await store.setSecret('provider-key','fixture-secret');
    expect(await store.getSecret('provider-key')).toBe('fixture-secret');
  });
  it('preserves prior encrypted data on encryption failure and never echoes a secret',async () => {
    const {store,encryption} = await fixture(); await store.setSecret('mail','old');
    encryption.encryptStringAsync = async () => { throw new Error('new-secret'); };
    const error = await store.setSecret('mail','new-secret').catch(error => error);
    expect(error.message).not.toContain('new-secret');
    expect(await store.getSecret('mail')).toBe('old');
  });
  it('rejects tampering without interpreting a credential file as plaintext',async () => {
    const {dir,store} = await fixture(); await writeFile(join(dir,'mail.enc'),'plaintext-secret');
    await expect(store.getSecret('mail')).rejects.toThrow('Could not unlock');
  });
  it('validates names to prevent escaping the isolated credential directory',async () => {
    const {store} = await fixture();
    for(const name of ['../personal','/tmp/key','','x/y']) expect(()=>store.setSecret(name,'secret')).toThrow('Invalid credential name');
  });
});

it('rejects the asynchronous Linux v10 fallback even when availability reports true',async () => {
  const {dir,store} = await fixture({encryptStringAsync:async()=>Buffer.from('v10fake-ciphertext')},'linux');
  await expect(store.setSecret('mail','secret')).rejects.toThrow('Secure credential storage is unavailable');
  expect(await readdir(dir)).toEqual([]);
  await writeFile(join(dir,'mail.enc'),'v10fake-ciphertext');
  await expect(store.getSecret('mail')).rejects.toThrow('Secure credential storage is unavailable');
});
it('rejects a plaintext asynchronous encryption response',async () => {
  const {dir,store} = await fixture({encryptStringAsync:async value=>Buffer.from(value)});
  await expect(store.setSecret('mail','secret')).rejects.toThrow('Secure credential storage is unavailable');
  expect(await readdir(dir)).toEqual([]);
});
it('waits for asynchronous encryption and unwraps the asynchronous decrypt result',async () => {
  const {store,encryption} = await fixture();
  const original = encryption.encryptStringAsync;
  let release!:()=>void;
  encryption.encryptStringAsync = async value => {await new Promise<void>(resolve=>{release=resolve;});return original(value);};
  const save = store.setSecret('mail','secret');
  while(!release) await new Promise(resolve=>setTimeout(resolve,0));
  release(); await save;
  expect(await store.getSecret('mail')).toBe('secret');
});

it('bounds pending keyring availability without ever starting encryption',async () => {
  const {dir,encryption} = await fixture({isAsyncEncryptionAvailable:()=>new Promise(()=>{})});
  const encrypt = vi.spyOn(encryption,'encryptStringAsync');
  const store = createSecretStore(()=>dir,()=>encryption,process.platform,20);
  const error = await store.setSecret('mail','private-secret').catch(error=>error);
  expect(error).toBeInstanceOf(SecretStorageUnavailableError);
  expect(error.code).toBe('SECRET_STORAGE_TIMEOUT');
  expect(encrypt).not.toHaveBeenCalled();
  expect(await readdir(dir)).toEqual([]);
});
it('never writes a late encryption result after timing out',async () => {
  let release!: (value:Buffer)=>void;
  const {dir,encryption} = await fixture({encryptStringAsync:()=>new Promise(resolve=>{release=resolve;})});
  const store = createSecretStore(()=>dir,()=>encryption,process.platform,20);
  await expect(store.setSecret('mail','secret')).rejects.toMatchObject({code:'SECRET_STORAGE_TIMEOUT'});
  release(Buffer.from('late ciphertext'));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(await readdir(dir)).toEqual([]);
});
it('bounds decryption without deleting the existing protected credential',async () => {
  const {dir,encryption,store:original} = await fixture(); await original.setSecret('mail','secret');
  const previous = await readFile(join(dir,'mail.enc'));
  encryption.decryptStringAsync=()=>new Promise(()=>{});
  const store = createSecretStore(()=>dir,()=>encryption,process.platform,20);
  await expect(store.getSecret('mail')).rejects.toMatchObject({code:'SECRET_STORAGE_TIMEOUT'});
  expect(await readFile(join(dir,'mail.enc'))).toEqual(previous);
});
