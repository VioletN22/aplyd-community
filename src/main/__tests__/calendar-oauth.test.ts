import { expect, it } from 'vitest';
import { readOAuthCallback, buildAuthorizationUrl } from '../calendar/oauth';
it('rejects invalid state, provider refusal and missing authorization code', () => {
  expect(() => readOAuthCallback(new URL('http://127.0.0.1/callback?state=wrong&code=x'), 'right')).toThrow(/state/);
  expect(() => readOAuthCallback(new URL('http://127.0.0.1/callback?state=right&error=access_denied'), 'right')).toThrow(/declined/);
  expect(() => readOAuthCallback(new URL('http://127.0.0.1/callback?state=right'), 'right')).toThrow(/code/);
});
it('requests offline PKCE desktop consent and narrow calendar creation scope', () => {
  const url = new URL(buildAuthorizationUrl('client', 'http://127.0.0.1:1234/callback', 'state', 'challenge'));
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('scope')).toContain('calendar.app.created');
});

import { authorizeDesktop } from '../calendar/oauth';
it('closes the loopback listener when the browser cannot open', async () => {
  await expect(authorizeDesktop({clientId:'id',clientSecret:'secret'},async()=>{throw Error('No browser');},fetch,100))
    .rejects.toThrow(/browser/);
});
it('bounds an abandoned sign-in with a timeout', async () => {
  await expect(authorizeDesktop({clientId:'id',clientSecret:'secret'},async()=>{},fetch,15)).rejects.toThrow(/timed out/);
});
it('exchanges a valid loopback callback with PKCE and returns a readable completion page', async () => {
  let browserResponse: Promise<string> | undefined;
  let tokenBody='';
  const tokens=await authorizeDesktop({clientId:'id',clientSecret:'secret'},async authorization=>{
    const url=new URL(authorization);
    const callback=new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state',url.searchParams.get('state')!);
    callback.searchParams.set('code','code');
    browserResponse=fetch(callback).then(response=>response.text());
    await browserResponse;
  },async(_url,init)=>{tokenBody=String(init?.body);return new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',expires_in:3600}));},1000);
  expect(tokens.refresh_token).toBe('refresh');
  expect(await browserResponse).toContain('return to Aplyd');
  expect(new URLSearchParams(tokenBody).get('code_verifier')).toBeTruthy();
});
