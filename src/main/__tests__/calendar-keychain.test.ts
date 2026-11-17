import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({app:{getPath:()=>'/unused'},safeStorage:{}}));
import { CalendarKeychain } from '../calendar/keychain';
it('round-trips calendar credentials through protected storage and clears them', async () => {
  let value: string | null = null;
  const keychain = new CalendarKeychain({getSecret:async()=>value,setSecret:async(_name,next)=>{value=next;},deleteSecret:async()=>{value=null;}});
  expect(await keychain.read()).toBeNull();
  const secrets={clientId:'client',clientSecret:'private-client-secret',refreshToken:'private-refresh'};
  await keychain.write(secrets); expect(await keychain.read()).toEqual(secrets);
  await keychain.clear(); expect(await keychain.read()).toBeNull();
  value='{"clientId":42}'; await expect(keychain.read()).rejects.toThrow('could not be read');
});
