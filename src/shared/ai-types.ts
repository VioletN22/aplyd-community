/** The Anthropic model used when the model field in Settings is left blank. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export type AIProviderName = 'none' | 'anthropic' | 'codex';
export interface AIConfigure { provider: AIProviderName; model?: string; apiKey?: string; removeApiKey?: boolean }
export interface AIStatus { provider: AIProviderName; model: string; ready: boolean; hasApiKey?: boolean; message: string }
export interface AIReply { ok: boolean; data?: AIStatus; error?: string }
