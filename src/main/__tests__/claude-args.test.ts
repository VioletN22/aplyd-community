import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, jsonStringPrefix, cliFailureMessage } from '../claude';

describe('buildClaudeArgs', () => {
  it('mac: hermetic + toolless + no session persistence', () => {
    const a = buildClaudeArgs({ model: 'sonnet' }, false);
    expect(a).toContain('--strict-mcp-config');
    expect(a).toContain('--tools');
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a).toContain('--no-session-persistence');
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('');
  });
  it('adds system prompt and json schema when given', () => {
    const a = buildClaudeArgs({ model: 'fable', systemPrompt: 'x', schema: { type: 'object' }, fallbackModel: 'sonnet' }, false);
    expect(a[a.indexOf('--system-prompt') + 1]).toBe('x');
    expect(a[a.indexOf('--output-format') + 1]).toBe('json');
    expect(JSON.parse(a[a.indexOf('--json-schema') + 1])).toEqual({ type: 'object' });
    expect(a[a.indexOf('--fallback-model') + 1]).toBe('sonnet');
  });
  it('windows: plain args only (shell quoting unsafe)', () => {
    const a = buildClaudeArgs({ model: 'sonnet' }, true);
    expect(a).toEqual(['-p', '--model', 'sonnet', '--output-format', 'text']);
  });
  it('unknown model falls back to sonnet', () => {
    expect(buildClaudeArgs({ model: 'gpt9' } as any, false)).toContain('sonnet');
  });
  // Verified live against claude 2.1.233: stream-json under --print refuses to
  // start without --verbose, and drops the schema flag (mutually exclusive).
  it('stream mode: stream-json plus the flags the CLI insists on, no schema', () => {
    const a = buildClaudeArgs({ model: 'fable', stream: true, schema: { type: 'object' }, systemPrompt: 'x' }, false);
    expect(a[a.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(a).toContain('--include-partial-messages');
    expect(a).toContain('--verbose');
    expect(a).not.toContain('--json-schema');
    expect(a).toContain('--no-session-persistence');
  });
  it('stream mode on windows stays on the plain text path', () => {
    expect(buildClaudeArgs({ model: 'sonnet', stream: true }, true))
      .toEqual(['-p', '--model', 'sonnet', '--output-format', 'text']);
  });
});

describe('jsonStringPrefix', () => {
  it('decodes as far as a half-written JSON document allows', () => {
    expect(jsonStringPrefix('{"letter": "Dear Hiring Manager,\\n\\nI have', 'letter'))
      .toBe('Dear Hiring Manager,\n\nI have');
  });
  it('stops before an escape that has not fully arrived', () => {
    expect(jsonStringPrefix('{"letter": "one\\', 'letter')).toBe('one');
    expect(jsonStringPrefix('{"letter": "one\\u00', 'letter')).toBe('one');
  });
  it('ends the value at the closing quote', () => {
    expect(jsonStringPrefix('{"letter": "done", "note": "later"}', 'letter')).toBe('done');
  });
  it('grows monotonically as the buffer fills', () => {
    const full = '{"letter": "Dear Hiring Manager,\\n\\nQuote \\"here\\" ok.", "note": ""}';
    let previous = '';
    for (let i = 1; i <= full.length; i++) {
      const shown = jsonStringPrefix(full.slice(0, i), 'letter');
      expect(shown.startsWith(previous)).toBe(true);
      previous = shown;
    }
    expect(previous).toBe('Dear Hiring Manager,\n\nQuote "here" ok.');
  });
  it('waits while the opening key is still arriving', () => {
    expect(jsonStringPrefix('{"let', 'letter')).toBe('');
    expect(jsonStringPrefix('```', 'letter')).toBe('');
    expect(jsonStringPrefix('```js', 'letter')).toBe('');
  });
  it('passes plain prose through untouched', () => {
    expect(jsonStringPrefix('Dear Hiring Manager,', 'letter')).toBe('Dear Hiring Manager,');
  });
  // What the live CLI actually returns: the JSON wrapped in a markdown fence.
  it('grows monotonically through a fenced document, fence included', () => {
    const full = '```json\n{\n  "letter": "Dear Hiring Manager,\\n\\nI write.",\n  "note": ""\n}\n```';
    let previous = '';
    for (let i = 1; i <= full.length; i++) {
      const shown = jsonStringPrefix(full.slice(0, i), 'letter');
      expect(shown.startsWith(previous)).toBe(true);
      previous = shown;
    }
    expect(previous).toBe('Dear Hiring Manager,\n\nI write.');
  });
});

describe('cliFailureMessage', () => {
  // claude 2.1.283, subscription login lapsed (10 Oct 2026): exit 1, nothing on
  // stderr, and the reason only inside the JSON envelope on stdout.
  it('takes the reason from the stdout envelope when stderr is empty', () => {
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' });
    expect(cliFailureMessage(1, stdout, '')).toBe('claude CLI exited 1: Failed to authenticate: OAuth session expired and could not be refreshed');
  });
  it('keeps stderr when there is one, and copes with non-JSON stdout', () => {
    expect(cliFailureMessage(2, '{"result":"x"}', 'boom')).toBe('claude CLI exited 2: boom');
    expect(cliFailureMessage(1, 'Please run /login', '')).toBe('claude CLI exited 1: Please run /login');
    expect(cliFailureMessage(1, '', '')).toBe('claude CLI exited 1: ');
  });
});
