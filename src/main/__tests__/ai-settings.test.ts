import { beforeEach, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ values: {} as Record<string, string>, key: '', setSecret: vi.fn(), deleteSecret: vi.fn() }));
vi.mock('../database', () => ({ getSetting: (key: string) => store.values[key] || null, setSetting: (key: string, value: string) => { store.values[key] = value; } }));
vi.mock('../secret-store', () => ({ getSecret: async () => store.key || null, setSecret: store.setSecret, deleteSecret: store.deleteSecret }));
vi.mock('../codex-provider', () => ({ codexStatus: async () => ({ready:false,message:'Not installed'}), runCodex: vi.fn() }));
import { aiStatus, configureAI, getAIConfig } from '../ai-settings';
beforeEach(() => { store.values = {}; store.key = ''; store.setSecret.mockReset(); store.deleteSecret.mockReset(); });
it('starts with manual mode and does not infer login from environment keys', async () => {
  expect(getAIConfig()).toEqual({provider:'none',model:''});
  expect(await aiStatus()).toMatchObject({provider:'none',ready:false});
});
it('saves credentials only to secure storage and never returns them', async () => {
  store.key = 'secret-key';
  const result=await configureAI({provider:'anthropic',apiKey:'secret-key',model:'claude-sonnet-4-6'});
  expect(store.setSecret).toHaveBeenCalledWith('anthropic-api-key','secret-key');
  expect(JSON.stringify(store.values)).not.toContain('secret-key');
  expect(JSON.stringify(result)).not.toContain('secret-key');
  expect(result.hasApiKey).toBe(true);
});
it('preserves configuration if encrypted key storage fails', async () => {
  store.setSecret.mockRejectedValue(new Error('Secure storage unavailable'));
  await expect(configureAI({provider:'anthropic',apiKey:'key'})).rejects.toThrow('Secure storage');
  expect(getAIConfig().provider).toBe('none');
});
it('rejects unsupported providers, malformed model IDs and key newlines', async () => {
  for (const input of [{provider:'unknown'}, {provider:'codex',model:'x; bad'}, {provider:'anthropic',apiKey:'x\ny'}]) {
    await expect(configureAI(input as any)).rejects.toThrow();
  }
  expect(store.setSecret).not.toHaveBeenCalled();
});
