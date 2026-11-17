// Company research for cover letters. The file name is historical: this is all
// that remains of the old board-harvesting module.
import { openJob, evalInTab, closeTab, ensureBrowser, BridgeMsg } from './driver';

const noBridge = async (_m: BridgeMsg) => ({ ok: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

// LIVE company research for cover letters, using the in-app browser (a real
// fingerprint, so search engines render results instead of a bot-challenge). We
// Bing-search the company (grounded by the listing's LOCATION so we don't grab a
// same-named company in another country) + read a couple of their OWN pages, and
// return the text + the exact source URLs (so the user can verify the match).
// Best-effort; empty result on failure. Caller still cross-checks vs the posting.
export async function researchCompany(company: string, jobUrl = '', location = '', slot = 2): Promise<{ text: string; sources: string[] }> {
  const name = (company || '').trim();
  if (!name) return { text: '', sources: [] };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const year = new Date().getFullYear();
  // boards/aggregators are NOT the company's own site; never treat as a source.
  const boardHost = /linkedin\.|seek\.|indeed\.|glassdoor\.|ziprecruiter\.|adzuna\.|jora\.|weworkremotely\.|wellfound\.|gradconnection\.|prosple\.|hatch\./i;
  const junk = /bing\.|microsoft\.|msn\.|go\.microsoft|duckduckgo|google\.|facebook\.|twitter\.|x\.com|instagram\.|youtube\.|tiktok\.|wikipedia\.|crunchbase\.|zoominfo|reddit\.|\.gov\b/i;
  const linksExpr =
    '(function(){var out=[];var seen={};' +
    'document.querySelectorAll(\'#b_results li.b_algo a[href^="http"], #b_results h2 a[href^="http"], main a[href^="http"]\').forEach(function(a){' +
    'var h=a.href;if(!h||seen[h])return;seen[h]=1;out.push(h);});return out.slice(0,12);})()';
  const textExpr = '(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,2200)';
  const collected: string[] = [];
  const usedSources: string[] = [];
  let tab: any = null;
  try {
    await ensureBrowser();
    // 1) search → candidate links. Add the listing's locale (city/country) so a
    // same-named company elsewhere doesn't outrank the real one.
    const locHint = (location || '').split(/[,/]/)[0].trim();
    const q = enc(name + ' company official site about values mission ' + (locHint ? locHint + ' ' : '') + year);
    tab = await openJob('https://www.bing.com/search?q=' + q, noBridge, slot);
    await sleep(1200);
    let links: string[] = [];
    try { links = await evalInTab(tab, linksExpr); } catch { links = []; }
    // If the LISTING itself is hosted on the company's own site/ATS (not a board),
    // that's the highest-confidence source, so use it directly.
    if (jobUrl) { try { const o = new URL(jobUrl); if (!boardHost.test(o.host)) links.unshift(o.origin); } catch { /* ignore */ } }
    const score = (u: string) => {
      let s = 0;
      try { if (new URL(u).host.toLowerCase().replace(/[^a-z0-9]/g, '').includes(slug.slice(0, 8))) s += 5; } catch { /* ignore */ }
      if (/about|values|mission|culture|who-we-are|company|careers|annual|investor|impact|sustainab|strateg/i.test(u)) s += 2;
      return s;
    };
    const ranked = Array.from(new Set(links.filter((u) => /^https?:/.test(u) && !junk.test(u) && !boardHost.test(u))))
      .sort((a, b) => score(b) - score(a)).slice(0, 4);
    // 2) read the top couple of their own pages
    for (const u of ranked) {
      if (collected.length >= 2) break;
      try {
        const t2 = await openJob(u, noBridge, slot);
        await sleep(900);
        const txt = await evalInTab(t2, textExpr).catch(() => '');
        if (txt && String(txt).length > 200) { collected.push('SOURCE ' + u + ':\n' + String(txt)); usedSources.push(u); }
      } catch { /* skip this page */ }
    }
  } catch { /* research is best-effort */ }
  finally { if (tab) { try { await closeTab(tab); } catch { /* ignore */ } } }
  return { text: collected.join('\n\n').slice(0, 3500), sources: usedSources };
}
