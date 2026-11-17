import { describe, expect, it } from 'vitest';
import path from 'path';
import { buildCodexArgs, assertCodexSupport, parseCodexEvents, resolveCodexExecutable, sortVersionDirsNewestFirst, nodeManagerBins, withCommandDirFirst } from '../codex-provider';

describe('restricted Codex invocation', () => {
  it('keeps untrusted text out of argv and isolates configuration and filesystem', () => {
    const args = buildCodexArgs('/tmp/test isolated', undefined, '/tmp/schema.json');
    expect(args).toContain('--ignore-user-config'); expect(args).toContain('--ignore-rules');
    expect(args).toContain('--ephemeral'); expect(args).toContain('--strict-config');
    expect(args).toContain('mcp_servers={}'); expect(args).toContain('features.hooks=false');
    expect(args).toContain('features.shell_tool=false');
    expect(args).toContain('permissions.aplyd.filesystem={":root"="deny",":minimal"="read",":workspace_roots"="read"}');
    expect(args).toContain('permissions.aplyd.network.enabled=false');
    expect(args).not.toContain('--sandbox'); expect(args.at(-1)).toBe('-');
  });
  it('fails closed on unreviewed versions or missing isolation flags', () => {
    const help = '--ignore-user-config --ignore-rules --ephemeral --strict-config --output-schema --json';
    expect(() => assertCodexSupport('codex-cli 0.169.0-alpha.11.1', help)).not.toThrow();
    expect(() => assertCodexSupport('codex-cli 0.120.0', help)).toThrow(/reviewed/);
    expect(() => assertCodexSupport('codex-cli 0.169.0', '--json')).toThrow(/isolation/);
  });
  it('accepts only a complete successful turn and rejects malformed or tool events', () => {
    const good = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })+'\n'+JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } });
    expect(parseCodexEvents(good).text).toBe('ok');
    expect(() => parseCodexEvents('{broken')).toThrow(/malformed/);
    expect(() => parseCodexEvents('{"type":"turn.failed","error":{"message":"private"}}')).toThrow(/failed/);
    expect(() => parseCodexEvents('{"type":"item.completed","item":{"type":"command_execution"}}')).toThrow(/tool/);
    expect(() => parseCodexEvents('{"type":"thread.started"}')).toThrow(/completion/);
  });
});


describe('Windows Codex discovery', () => {
  it('finds the npm optional native dependency without executing a .cmd wrapper', async () => {
    const prefix='C:\\Users\\Test User\\AppData\\Roaming\\npm';
    const expected=prefix+'\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';
    const seen:string[]=[];
    const found=await resolveCodexExecutable({APPDATA:'C:\\Users\\Test User\\AppData\\Roaming',PATH:'C:\\Windows\\System32'},'win32','x64',async candidate=>{seen.push(candidate);return candidate===expected;});
    expect(found).toBe(expected); expect(seen.some(candidate=>candidate.endsWith('.cmd'))).toBe(false);
  });
  it('finds a hoisted arm64 native package in a PATH prefix containing spaces', async () => {
    const prefix='C:\\Program Files\\nodejs';
    const expected=prefix+'\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe';
    expect(await resolveCodexExecutable({PATH:prefix},'win32','arm64',async candidate=>candidate===expected)).toBe(expected);
  });
});

describe('Node version directories', () => {
  it('sorts versions newest first by number, not by name', () => {
    expect(sortVersionDirsNewestFirst(['v9.11.2', 'v22.3.0', 'v18.20.4', 'v22.12.0', 'v10.0.0']))
      .toEqual(['v22.12.0', 'v22.3.0', 'v18.20.4', 'v10.0.0', 'v9.11.2']);
  });
  it('puts names that are not versions last', () => {
    expect(sortVersionDirsNewestFirst(['default', 'v20.1.0', 'system'])).toEqual(['v20.1.0', 'system', 'default']);
  });
  it('lists nvm bins newest first from a fake directory listing', () => {
    const base = path.join('/h', '.nvm', 'versions', 'node');
    const listing: Record<string, string[]> = { [base]: ['v8.17.0', 'v20.18.1', 'v16.20.2'] };
    const bins = nodeManagerBins('/h', (dir) => {
      if (!listing[dir]) throw new Error('ENOENT');
      return listing[dir];
    }).filter((d) => d.includes('.nvm'));
    expect(bins).toEqual([
      path.join(base, 'v20.18.1', 'bin'),
      path.join(base, 'v16.20.2', 'bin'),
      path.join(base, 'v8.17.0', 'bin'),
    ]);
  });
});

describe('withCommandDirFirst', () => {
  it('puts the Codex folder first and drops its later copy', () => {
    const env = withCommandDirFirst({ PATH: '/usr/bin:/h/.nvm/versions/node/v8.17.0/bin:/h/.nvm/versions/node/v20.18.1/bin' },
      '/h/.nvm/versions/node/v20.18.1/bin/codex', 'darwin');
    expect(env.PATH).toBe('/h/.nvm/versions/node/v20.18.1/bin:/usr/bin:/h/.nvm/versions/node/v8.17.0/bin');
  });
  it('uses Windows separators on Windows', () => {
    const env = withCommandDirFirst({ PATH: 'C:\\Windows;C:\\Program Files\\nodejs' }, 'C:\\Users\\a\\AppData\\Roaming\\npm\\codex.exe', 'win32');
    expect(env.PATH).toBe('C:\\Users\\a\\AppData\\Roaming\\npm;C:\\Windows;C:\\Program Files\\nodejs');
  });
});
