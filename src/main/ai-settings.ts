import { getSetting, setSetting } from './database';
import { getSecret, setSecret, deleteSecret } from './secret-store';
import { createAIRunner, type AIConfig } from './ai-provider';
import { codexStatus, runCodex } from './codex-provider';
import type { AIConfigure, AIStatus } from '../shared/ai-types';

export function getAIConfig(): AIConfig {
  const provider = getSetting('ai_provider');
  return { provider: provider === 'anthropic' || provider === 'codex' ? provider : 'none', model: getSetting('ai_model') || '' };
}
export const runAI = createAIRunner({ getConfig: getAIConfig, getApiKey: () => getSecret('anthropic-api-key'), fetch: (...args) => fetch(...args), codex: runCodex });
export async function aiStatus(): Promise<AIStatus> {
  const config = getAIConfig();
  if (config.provider === 'none') return { ...config, ready: false, message: 'Manual mode. AI is optional.' };
  if (config.provider === 'codex') return { ...config, ...await codexStatus() };
  try {
    const saved = Boolean(await getSecret('anthropic-api-key'));
    return { ...config, ready: saved, hasApiKey: saved, message: saved ? 'API key saved securely. Use Test connection to verify it.' : 'Add an Anthropic API key.' };
  } catch (e) { return { ...config, ready: false, message: e instanceof Error ? e.message : 'Secure storage is unavailable.' }; }
}
export async function configureAI(input: AIConfigure): Promise<AIStatus> {
  if (!input || !['none', 'anthropic', 'codex'].includes(input.provider)) throw new Error('Choose a supported AI provider');
  const model = (input.model || '').trim();
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) throw new Error('Enter a valid provider model ID');
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 1000 || /[\r\n]/.test(input.apiKey))) throw new Error('Invalid API key');
  if (input.removeApiKey) await deleteSecret('anthropic-api-key');
  else if (input.apiKey?.trim()) await setSecret('anthropic-api-key', input.apiKey.trim());
  setSetting('ai_provider', input.provider); setSetting('ai_model', model);
  return aiStatus();
}
export async function testAI(): Promise<AIStatus> {
  const config = getAIConfig();
  if (config.provider === 'none') return aiStatus();
  const result = await runAI('Reply with exactly: ok', { timeoutMs: 30000 });
  if (!result.text.trim()) throw new Error('Provider returned no response');
  return { ...config, ready: true, message: 'Connection verified with a small AI request.' };
}
