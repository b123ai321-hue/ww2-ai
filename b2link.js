/* b2link.js — Ink & Iron <-> Grok Bot "B2" world-AI bridge. Drop-in, no secrets inside.
 * All credentials (webhook sender key, GitHub fine-grained token) are pasted by the user
 * into the settings panel and stored ONLY in this browser's localStorage ("b2link.cfg").
 * Protocol: see PROTOCOL.md.  Works in browser (window.B2Link) and Node (module.exports). */
(function(root){
'use strict';
const V = 1, CFG_KEY = 'b2link.cfg';
// Default wake = PR comment: the webhook endpoint's CORS only allows Cursor's own origins, so browsers can't POST to it.
const DEF = { enabled:false, wake:'ghcomment', hookUrl:'', hookKey:'', repo:'b123ai321-hue/ink-iron-turns', token:'', prToken:'', pr:1,
              timeoutMs:150000, pollMs:10000, firstPollMs:45000 };
let store = (typeof localStorage!=='undefined') ? localStorage : null;
let fetchFn = (typeof fetch!=='undefined') ? (...a)=>fetch(...a) : null;
let now = () => Date.now(), sleep = ms => new Promise(r=>setTimeout(r,ms));

const SV = 2;   // settings version: v2 = PR-comment wake default (webhook is CORS-blocked in browsers)
/* Strip whitespace, zero-width chars, smart quotes and any non-ASCII (they break fetch headers). Returns [clean, removedCount]. */
function clean(v){ const s=String(v==null?'':v); const c=s.replace(/[^\x21-\x7E]/g,'').replace(/["'`]/g,''); return [c, s.length-c.length]; }
const SAN = ['token','prToken','hookKey','hookUrl','repo'];
function sanitize(c){ const notes=[]; SAN.forEach(k=>{ if(typeof c[k]!=='string') return; const [v,n]=clean(c[k]); if(n){ c[k]=v; if(c[k]||n) notes.push(`Removed ${n} hidden/invalid character${n>1?'s':''} from ${k==='token'?'token':k}`); } }); return notes; }
function tokenIssue(t){ if(!t) return ''; if(/^github_pat_[A-Za-z0-9_]{20,}$/.test(t)||/^gh[pousr]_[A-Za-z0-9]{20,}$/.test(t)) return ''; return "Token doesn't look like a GitHub token (should start with github_pat_)"; }
function repoIssue(r){ return !r||/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(r) ? '' : 'Turns repo should look like owner/name'; }
function mask(t){ return t ? `${t.slice(0,11)}… (${t.length} chars)` : '—'; }
let lastNotes=[];
function cfg(){ let raw={}; try{ raw=JSON.parse((store&&store.getItem(CFG_KEY))||'{}')||{}; }catch(e){ raw={}; }
  const c=Object.assign({}, DEF, raw), notes=sanitize(c); let dirty=notes.length>0;
  if(Object.keys(raw).length && (raw.sv||0)<SV){ if(c.wake==='webhook'){ notes.push('Switched wake to PR comment (the webhook is blocked by browsers)'); } c.wake='ghcomment'; c.sv=SV; dirty=true; }
  if(!c.sv) c.sv=SV;
  if(dirty&&store){ store.setItem(CFG_KEY, JSON.stringify(c)); lastNotes=lastNotes.concat(notes); }
  return c; }
function saveCfg(patch){ const c=Object.assign(cfg(), patch||{}, {sv:SV}); lastNotes=lastNotes.concat(sanitize(c)); store&&store.setItem(CFG_KEY, JSON.stringify(c)); return c; }
function takeNotes(){ const n=lastNotes; lastNotes=[]; return [...new Set(n)]; }
function check(c=cfg()){ return [tokenIssue(c.token), c.prToken?tokenIssue(c.prToken):'', repoIssue(c.repo)].filter(Boolean); }
/* fetch wrapper: header errors (non-ISO-8859-1) become a friendly message, never echoing the token */
async function gfetch(u,o){ try{ return await fetchFn(u,o); }catch(e){ if(/ISO-8859-1|header/i.test(e.message)) throw new Error('token contains an invalid character — re-paste it'); throw e; } }
function forget(){ store&&store.removeItem(CFG_KEY); }   // "Forget credentials" button
function ready(c=cfg()){ return !!(c.enabled && !tokenIssue(c.token) && !repoIssue(c.repo) && c.repo && c.token && (c.wake==='ghcomment' ? c.pr : (c.hookUrl && c.hookKey))); }

/* Random, anonymous game id (no user info). Persisted per browser. */
function gameId(){ let g=store&&store.getItem('b2link.gid'); if(!g){ g=Math.random().toString(36).slice(2,10); store&&store.setItem('b2link.gid',g); } return g; }
function newGame(){ store&&store.removeItem('b2link.gid'); }

/* ---- compact state digest (target < 1.5 KB) ----
 * W = game internals: {S, ADJ, REG, NAT}.  act = {kind,target,text} or null for a world tick. */
function digest(W, act){
  const {S, ADJ, REG, NAT} = W, P=S.player, T=act&&act.target;
  const alive = c => S.nat[c] && S.nat[c].alive;
  const rk=(a,b)=>a<b?a+'|'+b:b+'|'+a, rel=(a,b)=>S.rel[rk(a,b)]??0;
  const owned = c => Object.keys(S.owner).filter(r=>S.owner[r]===c);
  const nbrs = c => { const s=new Set(); owned(c).forEach(r=>ADJ[r].forEach(x=>{ const o=S.owner[x]; if(o!==c&&alive(o)) s.add(o); })); return s; };
  const near = new Set([P]); if(T&&T!==P) near.add(T);
  ['GER','UK','FRA','SOV','ITA'].forEach(x=>alive(x)&&near.add(x));          // great powers always visible
  nbrs(P).forEach(x=>near.add(x)); if(T) nbrs(T).forEach(x=>near.add(x));
  const list=[...near].slice(0,16);
  const st={}; list.forEach(c=>{ const n=S.nat[c]; st[c]=[n.army,n.industry,n.stability]; });
  const rl={}; list.filter(c=>c!==P).forEach(c=>rl[c]=rel(P,c)); if(T&&T!==P) list.filter(c=>c!==P&&c!==T).slice(0,8).forEach(c=>rl[T+'-'+c]=rel(T,c));
  const front = (T&&T!==P) ? owned(T).filter(r=>[...ADJ[r]].some(x=>S.owner[x]===P)).slice(0,8) : [];
  const occ={}; Object.keys(S.owner).forEach(r=>{ if(REG[r].home!==S.owner[r]) occ[r]=S.owner[r]; });
  const tgtReg = T ? owned(T).slice(0,12) : [];
  return { p:P, d:`${S.y}-${String(S.m+1).padStart(2,'0')}`,
    st, rl, war:S.wars.map(w=>w.a+'-'+w.b), tr:S.treaties.map(t=>t.type[0]+':'+t.a+'-'+t.b),
    front, treg:tgtReg, occ };
}

function buildRequest(W, act, worldOnly){
  const S=W.S, gid=gameId();
  const req = { v:V, id:`${gid}.${S.turn}.${worldOnly?'w':'p'}`, n:S.player, d:`${S.y}-${String(S.m+1).padStart(2,'0')}`,
    mv: worldOnly ? {k:'tick'} : {k:act.kind, t:act.target, ...(act.text?{x:String(act.text).slice(0,280)}:{})},
    s: digest(W, worldOnly?null:act) };
  delete req.s.p; delete req.s.d;               // already in n/d
  return req;
}

/* ---- transport ---- */
async function wake(c, req){
  const body = JSON.stringify(req);
  if(c.wake==='ghcomment'){   // wake via a GitHub pr-comment listener: the comment body IS the request (private repo)
    const r = await gfetch(`https://api.github.com/repos/${c.repo}/issues/${c.pr}/comments`, {method:'POST',
      headers:{'Authorization':'Bearer '+(c.prToken||c.token),'Accept':'application/vnd.github+json','Content-Type':'application/json'},
      body: JSON.stringify({body:'b2turn '+body})});
    if(r.status!==201) throw new Error('comment API HTTP '+r.status); return r.status;
  }
  let r; try{ r = await fetchFn(c.hookUrl, {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.hookKey}, body}); }
  catch(e){ throw new Error('webhook blocked by browser (CORS) — switch to PR-comment wake'); }
  if(!r.ok) throw new Error('wake HTTP '+r.status); return r.status;
}
async function readResult(c, id){
  const r = await gfetch(`https://api.github.com/repos/${c.repo}/contents/r/${encodeURIComponent(id)}.json`, {cache:'no-store',
    headers:{'Authorization':'Bearer '+c.token,'Accept':'application/vnd.github.raw+json'}});
  if(r.status===404) return null;
  if(!r.ok) throw new Error('read HTTP '+r.status);
  return JSON.parse(await r.text());
}

/* Shallow schema gate (the game's own validate() does the strict pass). */
const KEYS=['narrative','border_changes','relation_changes','reactions','events','wars','treaties','stat_changes'];
function shapeOk(o){ return o && typeof o.narrative==='string' && KEYS.slice(1).every(k=>o[k]===undefined||Array.isArray(o[k])); }
function normalize(o){ const out={narrative:o.narrative}; KEYS.slice(1).forEach(k=>out[k]=Array.isArray(o[k])?o[k]:[]); return out; }

/* Main entry. Returns a result object (same schema as the LLM path) or null -> caller uses rules engine.
 * opts: {onStatus(text), validate(obj)} */
async function resolve(W, act, worldOnly, opts={}){
  const c=cfg(); if(!ready(c)) return null;
  const say = t => { try{ opts.onStatus&&opts.onStatus(t); }catch(e){} };
  const req = buildRequest(W, act, worldOnly), t0=now();
  try{
    const early = await readResult(c, req.id).catch(()=>null);   // idempotent: already resolved (e.g. reload)
    if(early && early.id===req.id && shapeOk(early.r)) return finish(early.r);
    say('The world is thinking… (usually 1–2 min)'); await wake(c, req);
  }catch(e){ api.lastError=e.message; say('B2 unreachable ('+e.message+') — rules engine used'); return null; }
  await sleep(Math.min(c.firstPollMs, c.timeoutMs));
  while(now()-t0 < c.timeoutMs){
    try{ const j = await readResult(c, req.id);
      if(j && j.id===req.id){ if(j.err||!shapeOk(j.r)){ say('B2 declined turn — rules engine used'); return null; } return finish(j.r); } }
    catch(e){ if(/40[13]/.test(e.message)){ say('GitHub token rejected — rules engine used'); return null; } }
    say(`The world is thinking… ${Math.round((now()-t0)/1000)}s`);
    await sleep(c.pollMs);
  }
  api.lastError='timeout'; say('B2 timed out — rules engine used'); return null;   // a late result for this id is simply ignored
  function finish(r){ r=normalize(r); if(opts.validate){ try{ r=opts.validate(r); }catch(e){ say('B2 reply invalid — rules engine used'); return null; } } say('online · B2'); return r; }
}

/* Settings "Test B2": one probe request. Routine answers probes with a tiny fixed reply,
 * so this checks wake (comment API must return 201) AND the reply path. */
async function probe(opts={}){
  const c=cfg(), say=t=>{ try{ opts.onStatus&&opts.onStatus(t); }catch(e){} };
  const id=`${gameId()}.probe${Math.random().toString(36).slice(2,6)}.p`, req={v:V,id,n:'TEST',d:'1935-12',mv:{k:'probe'},s:{}};
  let st; try{ st=await wake(c, req); }catch(e){ return {ok:false, stage:'wake', msg:e.message}; }
  say(`Wake sent (HTTP ${st}). Waiting for B2's reply… (usually 1–2 min)`);
  const t0=now(); await sleep(Math.min(c.firstPollMs,c.timeoutMs));
  while(now()-t0<c.timeoutMs){ try{ const j=await readResult(c,id); if(j&&j.id===id) return {ok:true, stage:'reply', msg:(j.r&&j.r.narrative)||'B2 online.'}; }
    catch(e){ if(/40[13]/.test(e.message)) return {ok:false, stage:'read', msg:e.message}; }
    say(`Wake sent (HTTP ${st}). Waiting for B2's reply… ${Math.round((now()-t0)/1000)}s`); await sleep(c.pollMs); }
  return {ok:false, stage:'reply', msg:`wake accepted (HTTP ${st}) but no reply within ${Math.round(c.timeoutMs/1000)}s — is B2's routine on?`};
}

const api = { probe, lastError:null, clean, sanitize, tokenIssue, repoIssue, mask, takeNotes, check, gfetch, SV, V, cfg, saveCfg, forget, ready, gameId, newGame, digest, buildRequest, resolve,
  _inject(o){ if(o.store) store=o.store; if(o.fetch) fetchFn=o.fetch; if(o.now) now=o.now; if(o.sleep) sleep=o.sleep; } };
if(typeof module!=='undefined' && module.exports) module.exports=api; else root.B2Link=api;
})(typeof window!=='undefined'?window:globalThis);
