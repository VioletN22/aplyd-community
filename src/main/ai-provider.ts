/** Provider-neutral inference. No login files, ambient tools, or shell commands. */
import { DEFAULT_ANTHROPIC_MODEL } from '../shared/ai-types';
export type AIProvider = 'none' | 'anthropic' | 'codex';
export interface AIConfig { provider: AIProvider; model: string }
export interface AIOptions {
  timeoutMs?: number; model?: string; systemPrompt?: string; schema?: object;
  fallbackModel?: string; signal?: AbortSignal;
}
export interface AIMeta { model: string; inputTokens?: number; outputTokens?: number; durationMs?: number }
export interface AIResult { text: string; data?: unknown; meta: AIMeta }
interface Dependencies {
  getConfig(): AIConfig;
  getApiKey(): Promise<string | null>;
  fetch: typeof fetch;
  codex?: (prompt: string, opts: AIOptions, onDelta?: (text: string) => void) => Promise<AIResult>;
}
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_BYTES = 1024 * 1024;
const controllers = new Set<AbortController>();
export function cancelAllAI(): void { for (const controller of controllers) controller.abort(); }
export function codexIsolationError(): string {
  return 'Codex inference requires a verified isolation boundary for this CLI version. Use Anthropic API or the user-run Codex / Claude Code skills.';
}

/** Validates the JSON Schema vocabulary used by application schemas. Unknown keywords fail closed. */
export function validateSchema(value: unknown, schema: any, depth = 0): void {
  const fail = () => { throw new Error('AI returned invalid structured output'); };
  if (depth > 40 || !schema || typeof schema !== 'object') fail();
  const known = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'title']);
  if (Object.keys(schema).some(key => !known.has(key))) throw new Error('Unsupported AI output schema');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const isType = (t: string) => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ? typeof value === 'number' && Number.isInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t;
  if (types.length && !types.some(isType)) fail();
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) fail();
  if (typeof value === 'number' && ((schema.minimum != null && value < schema.minimum) || (schema.maximum != null && value > schema.maximum))) fail();
  if (typeof value === 'string' && ((schema.minLength != null && value.length < schema.minLength) || (schema.maxLength != null && value.length > schema.maxLength))) fail();
  if (Array.isArray(value)) {
    if ((schema.minItems != null && value.length < schema.minItems) || (schema.maxItems != null && value.length > schema.maxItems)) fail();
    if (schema.items) value.forEach(item => validateSchema(item, schema.items, depth + 1));
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ((schema.required || []).some((key: string) => !Object.prototype.hasOwnProperty.call(record, key))) fail();
    for (const [key, item] of Object.entries(record)) {
      if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) validateSchema(item, schema.properties[key], depth + 1);
      else if (schema.additionalProperties === false) fail();
    }
  }
}

/** Anthropic accepts a subset of JSON Schema; full constraints remain enforced locally. */
export function anthropicSchema(schema: object): object {
  const node = schema as Record<string, any>;
  const result: Record<string, any> = { ...node };
  const constraints: string[] = [];
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (key in result) { constraints.push(`${key}: ${result[key]}`); delete result[key]; }
  }
  if (constraints.length) result.description = [node.description, `Required constraints: ${constraints.join(', ')}.`].filter(Boolean).join(' ');
  if (node.properties) result.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, anthropicSchema(value as object)]));
  if (node.items) result.items = anthropicSchema(node.items);
  return result;
}

async function readBody(response: Response, signal: AbortSignal, onText?: (chunk: string) => void): Promise<string> {
  if (!response.body) throw new Error('AI returned an empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  const abort = () => { void reader.cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('AI response exceeded the output limit');
      const chunk = decoder.decode(part.value, { stream: true });
      if (onText) onText(chunk); else text += chunk;
    }
    const tail = decoder.decode();
    if (onText) onText(tail); else text += tail;
    return text;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}

/** Two requests active, 20 waiting; deadline covers queue and all provider work. */
export function createAIRunner(deps: Dependencies) {
  let active = 0;
  const waiting: Array<() => void> = [];
  async function acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (active < 2) { active++; return; }
    if (waiting.length >= 20) throw new Error('AI queue is full. Wait for a running task to finish.');
    await new Promise<void>((resolve, reject) => {
      const next = () => { signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { const i = waiting.indexOf(next); if (i >= 0) waiting.splice(i, 1); reject(new Error('AI request cancelled')); };
      waiting.push(next); signal.addEventListener('abort', abort, { once: true });
    });
  }
  function release() { const next = waiting.shift(); if (next) next(); else active--; }
  return async (prompt: string, opts: AIOptions = {}, onDelta?: (text: string) => void): Promise<AIResult> => {
    const config = deps.getConfig();
    if (config.provider === 'none') throw new Error('AI is optional. Choose a provider in Settings to use this feature; manual tracking remains available.');
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error('AI input exceeded the input limit');
    const controller = new AbortController(); controllers.add(controller);
    const started = Date.now();
    let timedOut = false, acquired = false;
    const cancel = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    opts.signal?.addEventListener('abort', cancel, { once: true });
    const duration = Math.max(1, Math.min(opts.timeoutMs ?? 60000, 300000));
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
    try {
      await acquire(controller.signal); acquired = true;
      controller.signal.throwIfAborted();
      if (config.provider === 'codex') {
        if (!deps.codex) throw new Error(codexIsolationError());
        return await deps.codex(prompt, { ...opts, signal: controller.signal, model: config.model }, onDelta);
      }
      const key = await deps.getApiKey();
      controller.signal.throwIfAborted();
      if (!key) throw new Error('Add an Anthropic API key in Settings. Claude Code login is separate.');
      const model = (config.model || '').trim() || DEFAULT_ANTHROPIC_MODEL;
      // Older call sites use CLI family aliases. The explicit provider model is authoritative.
      const body = { model, max_tokens: 8192, messages: [{ role: 'user', content: prompt }],
        ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
        ...(opts.schema ? { output_config: { format: { type: 'json_schema', schema: anthropicSchema(opts.schema) } } } : {}),
        stream: Boolean(onDelta) };
      const response = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
        body: JSON.stringify(body), signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        const reasons: Record<number, string> = { 401: 'authentication failed; update the API key in Settings', 403: 'access denied; check account permissions', 404: 'model not found; check the model ID in Settings', 429: 'rate or credit limit reached; try later or check billing' };
        throw new Error(`Anthropic ${reasons[response.status] || `request failed (HTTP ${response.status})`}`);
      }
      let text = '', inputTokens: number | undefined, outputTokens: number | undefined;
      let stopReason = '', actualModel = model;
      if (onDelta) {
        let pending = '', complete = false;
        const event = (block: string) => {
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (!data) return;
          let item: any;
          try { item = JSON.parse(data); } catch { throw new Error('AI returned a malformed stream'); }
          if (item.type === 'error') throw new Error('Anthropic stream failed; retry or check your provider account');
          if (item.type === 'message_start') { inputTokens = item.message?.usage?.input_tokens; actualModel = item.message?.model || model; }
          if (item.type === 'content_block_delta' && item.delta?.type === 'text_delta') {
            text += item.delta.text;
            try { onDelta(item.delta.text); } catch { /* renderer listener cannot break cleanup */ }
          }
          if (item.type === 'message_delta') { outputTokens = item.usage?.output_tokens; stopReason = item.delta?.stop_reason || ''; }
          if (item.type === 'message_stop') complete = true;
        };
        await readBody(response, controller.signal, chunk => {
          pending = (pending + chunk).replace(/\r\n/g, '\n');
          let end: number;
          while ((end = pending.indexOf('\n\n')) !== -1) { event(pending.slice(0, end)); pending = pending.slice(end + 2); }
        });
        if (pending.trim()) event(pending);
        if (!complete) throw new Error('AI stream ended before completion');
      } else {
        let message: any;
        try { message = JSON.parse(await readBody(response, controller.signal)); } catch (error) {
          if (error instanceof SyntaxError) throw new Error('AI returned a malformed response');
          throw error;
        }
        text = (message.content || []).filter((item: any) => item.type === 'text').map((item: any) => item.text).join('');
        inputTokens = message.usage?.input_tokens; outputTokens = message.usage?.output_tokens;
        stopReason = message.stop_reason; actualModel = message.model || model;
      }
      if (stopReason !== 'end_turn') throw new Error(stopReason === 'max_tokens' ? 'AI output was truncated; narrow the request and retry' : 'AI did not complete the request');
      if (!text.trim()) throw new Error('AI returned an empty response');
      let data: unknown;
      if (opts.schema) {
        try { data = JSON.parse(text); } catch { throw new Error('AI returned invalid structured output'); }
        validateSchema(data, opts.schema);
      }
      return { text: text.trim(), data, meta: { model: actualModel, inputTokens, outputTokens, durationMs: Date.now() - started } };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(timedOut ? 'AI request timed out' : 'AI request cancelled');
      if (error instanceof TypeError) throw new Error('AI connection failed. Check your network and provider settings.');
      throw error;
    } finally {
      clearTimeout(timer); opts.signal?.removeEventListener('abort', cancel); controllers.delete(controller);
      if (acquired) release();
    }
  };
}
