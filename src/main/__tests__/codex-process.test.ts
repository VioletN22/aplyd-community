import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn: state.spawn }));
import { runCodexProcess } from '../codex-provider';
function child() {
  const proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  state.spawn.mockReturnValue(proc); return proc;
}
beforeEach(() => state.spawn.mockReset());
describe('Codex process safety', () => {
  it('never invokes a shell and carries shell metacharacters only via stdin', async () => {
    const proc = child(), controller = new AbortController();
    let input=''; proc.stdin.on('data', chunk=>input+=chunk);
    const prompt='private & $(touch file) " %PATH%';
    const promise=runCodexProcess('C:\\Program Files\\Codex\\codex.exe',['exec','-'],prompt,'/tmp/isolated',controller.signal,{});
    expect(state.spawn.mock.calls[0][2]).toMatchObject({shell:false,windowsHide:true});
    expect(state.spawn.mock.calls[0][1]).not.toContain(prompt); expect(input).toBe(prompt);
    proc.stdout.write('ok'); proc.emit('close',0); await expect(promise).resolves.toBe('ok');
  });
  it('kills and rejects cancellation, spawn failures, and excessive output', async () => {
    for (const mode of ['abort','spawn','limit']) {
      const proc=child(), controller=new AbortController();
      const promise=runCodexProcess('codex',[],'prompt','/tmp',controller.signal,{});
      if(mode==='abort') controller.abort();
      if(mode==='spawn') proc.emit('error',new Error('secret environment'));
      if(mode==='limit') proc.stdout.write('x'.repeat(2*1024*1024+1));
      await expect(promise).rejects.toThrow(); expect(proc.kill).toHaveBeenCalledOnce();
    }
  });
  it('redacts raw stderr on authentication failures', async () => {
    const proc=child();
    const promise=runCodexProcess('codex',[],'prompt','/tmp',new AbortController().signal,{});
    proc.stderr.write('401 login expired PRIVATE_TOKEN'); proc.emit('close',1);
    await expect(promise).rejects.toThrow('Codex login expired; run codex login');
  });
});
