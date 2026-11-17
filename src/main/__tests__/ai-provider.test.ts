import { describe, expect, it, vi } from 'vitest';
import { createAIRunner, validateSchema, codexIsolationError, anthropicSchema } from '../ai-provider';
import { DEFAULT_ANTHROPIC_MODEL } from '../../shared/ai-types';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const answer = (text = '{"ok":true}') => new Response(JSON.stringify({ model: 'claude-sonnet-4-6', content: [{ type: 'text', text }], usage: { input_tokens: 3, output_tokens: 4 }, stop_reason: 'end_turn' }), { status: 200 });
function runner(fetcher = vi.fn(async () => answer()), provider = 'anthropic' as 'anthropic' | 'none' | 'codex') {
  return { fetcher, run: createAIRunner({ getConfig: () => ({ provider, model: 'claude-sonnet-4-6' }), getApiKey: async () => 'test-secret', fetch: fetcher as typeof fetch }) };
}
describe('optional AI providers', () => {
  it('keeps manual mode offline and gives actionable setup guidance', async () => {
    const { run, fetcher } = runner(undefined, 'none');
    await expect(run('private job')).rejects.toThrow(/Settings/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses a supported API key header, no tools, and validates structured output', async () => {
    const { run, fetcher } = runner();
    const result = await run('private job', { schema });
    expect(result.data).toEqual({ ok: true });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.headers).toMatchObject({ 'x-api-key': 'test-secret' });
    const body = JSON.parse(String(options.body));
    expect(body.tools).toBeUndefined();
    expect(body.output_config.format.schema).toEqual(schema);
    expect(result.meta.inputTokens).toBe(3);
  });
  it('rejects malformed or schema-invalid model output without echoing private output', async () => {
    for (const output of ['secret not json', '{"ok":"wrong"}', '{"ok":true,"extra":1}']) {
      const { run } = runner(vi.fn(async () => answer(output)));
      await expect(run('private', { schema })).rejects.toThrow(/structured output/);
    }
  });
  it('does not echo provider error bodies or secrets', async () => {
    const { run } = runner(vi.fn(async () => new Response('test-secret private job', { status: 401 })));
    await expect(run('private')).rejects.toThrow('Anthropic authentication failed');
  });
  it('fails closed for Codex versions without a supported no-tools boundary', async () => {
    const { run, fetcher } = runner(undefined, 'codex');
    await expect(run('private')).rejects.toThrow(/isolation/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(codexIsolationError()).toMatch(/Claude Code|Anthropic/);
  });
  it('cancels active requests and queued work without starting queued network calls', async () => {
    const fetcher = vi.fn((_url: unknown, opts: RequestInit) => new Promise<Response>((_resolve, reject) => {
      opts.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const { run } = runner(fetcher as any);
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const promises = controllers.map(c => run('job', { signal: c.signal }).catch(e => e.message));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(fetcher).toHaveBeenCalledTimes(2);
    controllers[2].abort(); controllers[0].abort(); controllers[1].abort();
    expect(await Promise.all(promises)).toEqual(['AI request cancelled', 'AI request cancelled', 'AI request cancelled']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('enforces a deadline including queued time', async () => {
    const { run } = runner(vi.fn((_url: unknown, opts: RequestInit) => new Promise<Response>((_resolve, reject) => {
      opts.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as any);
    await expect(run('private', { timeoutMs: 10 })).rejects.toThrow(/timed out/);
  });
  it('validates nested arrays, nullable values and enums', () => {
    expect(() => validateSchema({ xs: [null, 1] }, { type: 'object', properties: { xs: { type: 'array', items: { type: ['number', 'null'] } } } })).not.toThrow();
    expect(() => validateSchema('wrong', { enum: ['right'] })).toThrow();
  });
});


describe('Anthropic streaming and bounded output', () => {
  it('decodes fragmented SSE text and final usage', async () => {
    const events = [
      {type:'message_start',message:{model:'claude-sonnet-4-6',usage:{input_tokens:2}}},
      {type:'content_block_delta',delta:{type:'text_delta',text:'hello'}},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},
      {type:'message_stop'},
    ].map(event => 'data: '+JSON.stringify(event)+'\n\n').join('');
    const body = new ReadableStream({start(controller) {
      for (let i=0;i<events.length;i+=7) controller.enqueue(new TextEncoder().encode(events.slice(i,i+7)));
      controller.close();
    }});
    const {run}=runner(vi.fn(async()=>new Response(body)));
    const delta=vi.fn(); const result=await run('job',{},delta);
    expect(result.text).toBe('hello'); expect(delta).toHaveBeenCalledWith('hello');
    expect(result.meta.outputTokens).toBe(1);
  });
  it('rejects incomplete streams, truncated output and excessive responses', async () => {
    await expect(runner(vi.fn(async()=>new Response('data: {"type":"message_start"}\n\n'))).run('job',{},()=>{})).rejects.toThrow(/completion/);
    await expect(runner(vi.fn(async()=>new Response(JSON.stringify({content:[{type:'text',text:'partial'}],stop_reason:'max_tokens'})))).run('job')).rejects.toThrow(/truncated/);
    await expect(runner(vi.fn(async()=>new Response('a'.repeat(2*1024*1024+1)))).run('job')).rejects.toThrow(/output limit/);
  });
});


describe('Anthropic schema dialect', () => {
  it('sends supported schema keywords and retains bounds as instructions and local validation', () => {
    const original={type:'object',properties:{score:{type:'integer',minimum:0,maximum:10},questions:{type:'array',minItems:8,maxItems:10,items:{type:'string'}}},required:['score','questions'],additionalProperties:false};
    const wire=anthropicSchema(original) as any;
    expect(wire.properties.score.minimum).toBeUndefined();
    expect(wire.properties.score.description).toContain('minimum: 0');
    expect(wire.properties.questions.minItems).toBeUndefined();
    expect(wire.properties.questions.description).toContain('minItems: 8');
    expect(original.properties.score.minimum).toBe(0);
    expect(()=>validateSchema({score:11,questions:[]},original)).toThrow(/structured output/);
  });
});

describe('default Anthropic model', () => {
  it.each(['', '   '])('sends claude-sonnet-5-5 when the model field is %j', async (model) => {
    const fetcher = vi.fn(async () => answer());
    const run = createAIRunner({ getConfig: () => ({ provider: 'anthropic', model }), getApiKey: async () => 'test-secret', fetch: fetcher as typeof fetch });
    await run('hello');
    const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-5-5');
  });
  it('keeps a model the user chose', async () => {
    const fetcher = vi.fn(async () => answer());
    const run = createAIRunner({ getConfig: () => ({ provider: 'anthropic', model: 'claude-opus-5-5' }), getApiKey: async () => 'test-secret', fetch: fetcher as typeof fetch });
    await run('hello');
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe('claude-opus-5-5');
  });
});
