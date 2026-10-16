/* WW2-AI : Ink & Iron — alternate-history grand strategy, AI game master via local LLM. */
(function(){
'use strict';
const D = window.WW2DATA;
const $ = s => document.querySelector(s);
const NAT = Object.keys(D.N);
const REG = {}; D.R.forEach(r => REG[r[0]] = {id:r[0], name:r[1], home:r[2], lon:r[3], lat:r[4]});
const RIDS = Object.keys(REG);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SAVE_KEY = 'ww2ai.autosave', CFG_KEY = 'ww2ai.settings';
let S = null;               // game state
let CFG = loadCfg();
let busy = false;

/* ---------------- RNG (seeded, saved with state) ---------------- */
function rnd(){ S.seed = (S.seed * 1664525 + 1013904223) >>> 0; return S.seed / 4294967296; }
function pick(a){ return a[Math.floor(rnd()*a.length)]; }
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

/* ---------------- Map grid (Voronoi of region seeds inside land) ---------------- */
const LON0=-11, LON1=45.5, LAT0=29.5, LAT1=71.8, KX=Math.cos(52*Math.PI/180), STEP=0.3, CS=8;
const COLS = Math.ceil((LON1-LON0)*KX/STEP), ROWS = Math.ceil((LAT1-LAT0)/STEP);
function pip(x,y,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if((yi>y)!=(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
function landOf(lon,lat){ for(const k in D.SEA) if(pip(lon,lat,D.SEA[k])) return null; for(const k in D.LAND) if(pip(lon,lat,D.LAND[k])) return k; return null; }
const GRID = new Array(COLS*ROWS).fill(-1);  // index into RIDS
const toPx = (lon,lat) => [ (lon-LON0)*KX/STEP*CS, (LAT1-lat)/STEP*CS ];
(function buildGrid(){
  const seeds = RIDS.map((id,i)=>({i, poly:landOf(REG[id].lon,REG[id].lat), x:REG[id].lon*KX, y:REG[id].lat}));
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const lon = LON0 + (c+0.5)*STEP/KX, lat = LAT1 - (r+0.5)*STEP;
    const poly = landOf(lon,lat); if(!poly) continue;
    let best=-1, bd=1e9; const x=lon*KX;
    for(const s of seeds){ if(s.poly!==poly) continue; const d=(s.x-x)**2+(s.y-lat)**2; if(d<bd){bd=d;best=s.i;} }
    if(best<0) for(const s of seeds){ const d=(s.x-x)**2+(s.y-lat)**2; if(d<bd){bd=d;best=s.i;} }
    GRID[r*COLS+c]=best;
  }
})();
const ADJ = {}; RIDS.forEach(id=>ADJ[id]=new Set());
(function buildAdj(){
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const a=GRID[r*COLS+c]; if(a<0) continue;
    for(const [dr,dc] of [[0,1],[1,0]]){ if(r+dr>=ROWS||c+dc>=COLS) continue; const b=GRID[(r+dr)*COLS+c+dc];
      if(b>=0&&b!==a){ ADJ[RIDS[a]].add(RIDS[b]); ADJ[RIDS[b]].add(RIDS[a]); } } }
  D.SEALINKS.forEach(([a,b])=>{ ADJ[a].add(b); ADJ[b].add(a); });
})();

/* ---------------- State ---------------- */
const rk = (a,b) => a<b ? a+'|'+b : b+'|'+a;
function ideoAffinity(a,b){ const ia=D.N[a][3], ib=D.N[b][3]; if(ia===ib) return 20; if((ia==='communist')!==(ib==='communist')) return -25; if(ia==='fascist'&&ib==='democratic'||ib==='fascist'&&ia==='democratic') return -15; return 0; }
function newGame(player){
  S = { v:1, seed:(Date.now()>>>0)||7, player, y:1935, m:11, turn:0, owner:{}, rel:{}, wars:[], treaties:[], nat:{}, log:[], aiStats:{llm:0,fallback:0} };
  RIDS.forEach(id=>S.owner[id]=REG[id].home);
  NAT.forEach(c=>{ const n=D.N[c]; S.nat[c]={army:n[4], industry:n[5], stability:60, fort:0, alive:true}; });
  for(let i=0;i<NAT.length;i++) for(let j=i+1;j<NAT.length;j++) S.rel[rk(NAT[i],NAT[j])] = clamp(ideoAffinity(NAT[i],NAT[j]) + 10, -100, 100);
  const set=(a,b,v)=>S.rel[rk(a,b)]=v;
  set('UK','FRA',60); set('GER','ITA',25); set('GER','POL',5); set('GER','SOV',-45); set('FRA','CZE',55); set('SOV','CZE',30); set('FRA','POL',40); set('ITA','UK',-5); set('GER','AUT',15); set('HUN','ROM',-30); set('HUN','CZE',-30); set('BUL','ROM',-15); set('GRE','TUR',20); set('ITA','YUG',-25); set('ITA','ALB',45); set('LIT','POL',-40);
  S.treaties.push({type:'alliance',a:'FRA',b:'CZE'}, {type:'alliance',a:'FRA',b:'POL'}, {type:'non_aggression',a:'GER',b:'POL'}, {type:'alliance',a:'SOV',b:'CZE'});
  addLog('event', `1 December 1935. Europe holds its breath. You lead ${nm(player)}.`);
  autosave(); renderAll();
}
const nm = c => (D.N[c]||[c])[0];
const rel = (a,b) => a===b ? 100 : (S.rel[rk(a,b)] ?? 0);
const dateStr = () => `1 ${MONTHS[S.m]} ${S.y}`;
const regionsOf = c => RIDS.filter(id=>S.owner[id]===c);
const atWar = (a,b) => S.wars.some(w=>(w.a===a&&w.b===b)||(w.a===b&&w.b===a));
const hasTreaty = (t,a,b) => S.treaties.some(x=>x.type===t&&((x.a===a&&x.b===b)||(x.a===b&&x.b===a)));
const alliesOf = c => S.treaties.filter(t=>t.type==='alliance'&&(t.a===c||t.b===c)).map(t=>t.a===c?t.b:t.a).filter(x=>S.nat[x].alive);
const strength = c => { const n=S.nat[c]; return n.army*1.5 + n.industry + regionsOf(c).length*0.4 + n.fort; };
function borders(a,b){ return regionsOf(b).filter(r=>[...ADJ[r]].some(x=>S.owner[x]===a)); }
function addLog(kind, text){ S.log.unshift({d:dateStr(), kind, text}); if(S.log.length>300) S.log.length=300; }

/* ---------------- Result application (shared by LLM + fallback) ---------------- */
function applyResult(res){
  addLog('narr', res.narrative);
  for(const b of res.border_changes){ const from=S.owner[b.region]; if(from===b.to) continue; S.owner[b.region]=b.to;
    addLog('border', `${REG[b.region].name} passes from ${nm(from)} to ${nm(b.to)}.`); flash.add(b.region);
    if(regionsOf(from).length===0){ S.nat[from].alive=false; S.wars=S.wars.filter(w=>w.a!==from&&w.b!==from); S.treaties=S.treaties.filter(t=>t.a!==from&&t.b!==from); addLog('border', `${nm(from)} has ceased to exist.`); } }
  for(const r of res.relation_changes){ S.rel[rk(r.a,r.b)] = clamp(rel(r.a,r.b)+r.delta,-100,100); }
  for(const w of res.wars){ if(w.action==='declare' && !atWar(w.a,w.b) && S.nat[w.a].alive && S.nat[w.b].alive){ S.wars.push({a:w.a,b:w.b,since:dateStr()}); S.treaties=S.treaties.filter(t=>!((t.a===w.a&&t.b===w.b)||(t.a===w.b&&t.b===w.a))); addLog('war', `${nm(w.a)} declares war on ${nm(w.b)}!`); S.rel[rk(w.a,w.b)]=clamp(rel(w.a,w.b)-40,-100,100); }
    if(w.action==='peace' && atWar(w.a,w.b)){ S.wars=S.wars.filter(x=>!((x.a===w.a&&x.b===w.b)||(x.a===w.b&&x.b===w.a))); addLog('peace', `${nm(w.a)} and ${nm(w.b)} sign an armistice.`); } }
  for(const t of res.treaties){ if(!hasTreaty(t.type,t.a,t.b) && !atWar(t.a,t.b)){ S.treaties.push(t); addLog('treaty', `${nm(t.a)} and ${nm(t.b)} sign a ${t.type.replace('_','-')} pact.`); } }
  for(const s of res.stat_changes){ const n=S.nat[s.nation]; n.army=clamp(n.army+(s.army||0),0,20); n.industry=clamp(n.industry+(s.industry||0),0,20); n.stability=clamp(n.stability+(s.stability||0),0,100); }
  for(const r of res.reactions) addLog('react', `${nm(r.nation)}: ${r.text}`);
  for(const e of res.events) addLog('event', e.text);
}

/* ---------------- Validation of AI JSON ---------------- */
const SCHEMA = { type:'object', required:['narrative','border_changes','relation_changes','reactions','events','wars','treaties','stat_changes'], properties:{
  narrative:{type:'string'},
  border_changes:{type:'array',items:{type:'object',properties:{region:{type:'string'},to:{type:'string'}},required:['region','to']}},
  relation_changes:{type:'array',items:{type:'object',properties:{a:{type:'string'},b:{type:'string'},delta:{type:'integer'}},required:['a','b','delta']}},
  reactions:{type:'array',items:{type:'object',properties:{nation:{type:'string'},text:{type:'string'}},required:['nation','text']}},
  events:{type:'array',items:{type:'object',properties:{text:{type:'string'}},required:['text']}},
  wars:{type:'array',items:{type:'object',properties:{action:{type:'string',enum:['declare','peace']},a:{type:'string'},b:{type:'string'}},required:['action','a','b']}},
  treaties:{type:'array',items:{type:'object',properties:{type:{type:'string',enum:['alliance','non_aggression','guarantee','trade']},a:{type:'string'},b:{type:'string'}},required:['type','a','b']}},
  stat_changes:{type:'array',items:{type:'object',properties:{nation:{type:'string'},army:{type:'integer'},industry:{type:'integer'},stability:{type:'integer'}},required:['nation']}}
}};
function validate(raw, ctx){
  let o = raw;
  if(typeof raw==='string'){ let t=raw.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim(); const i=t.indexOf('{'), j=t.lastIndexOf('}'); if(i<0||j<i) throw new Error('no JSON object'); o=JSON.parse(t.slice(i,j+1)); }
  if(!o || typeof o!=='object' || typeof o.narrative!=='string' || o.narrative.trim().length<3) throw new Error('missing narrative');
  const arr = k => Array.isArray(o[k]) ? o[k].filter(x=>x&&typeof x==='object') : [];
  const isN = c => typeof c==='string' && D.N[c.toUpperCase()] && S.nat[c.toUpperCase()].alive;
  const N_ = c => c.toUpperCase();
  const regFix = r => { if(typeof r!=='string') return null; if(REG[r]) return r; const l=r.toLowerCase(); return RIDS.find(id=>REG[id].name.toLowerCase()===l) || null; };
  const out = { narrative:o.narrative.trim().slice(0,1200), border_changes:[], relation_changes:[], reactions:[], events:[], wars:[], treaties:[], stat_changes:[] };
  let moved=0;
  for(const b of arr('border_changes')){ const r=regFix(b.region); if(!r||!isN(b.to)) continue; const to=N_(b.to), from=S.owner[r];
    if(from===to) continue;
    // plausibility: new owner must touch region, and either be at war with owner or the move be the player's diplomatic demand on that owner
    const touches=[...ADJ[r]].some(x=>S.owner[x]===to);
    const ok = touches && (atWar(to,from) || (ctx && ctx.allowCession && ctx.target===from) || arr('wars').some(w=>w.action==='declare'&&[N_(w.a||''),N_(w.b||'')].includes(to)&&[N_(w.a||''),N_(w.b||'')].includes(from)));
    if(ok && moved<3){ out.border_changes.push({region:r,to}); moved++; } }
  for(const r of arr('relation_changes')) if(isN(r.a)&&isN(r.b)&&N_(r.a)!==N_(r.b)&&Number.isFinite(+r.delta)) out.relation_changes.push({a:N_(r.a),b:N_(r.b),delta:clamp(Math.round(+r.delta),-40,40)});
  for(const r of arr('reactions')) if(isN(r.nation)&&typeof r.text==='string') out.reactions.push({nation:N_(r.nation),text:r.text.slice(0,240)});
  for(const e of arr('events')) if(typeof e.text==='string') out.events.push({text:e.text.slice(0,240)});
  for(const w of arr('wars')) if(['declare','peace'].includes(w.action)&&isN(w.a)&&isN(w.b)&&N_(w.a)!==N_(w.b)) out.wars.push({action:w.action,a:N_(w.a),b:N_(w.b)});
  for(const t of arr('treaties')) if(['alliance','non_aggression','guarantee','trade'].includes(t.type)&&isN(t.a)&&isN(t.b)&&N_(t.a)!==N_(t.b)) out.treaties.push({type:t.type,a:N_(t.a),b:N_(t.b)});
  for(const s of arr('stat_changes')) if(isN(s.nation)) out.stat_changes.push({nation:N_(s.nation),army:clamp(Math.round(+s.army||0),-3,3),industry:clamp(Math.round(+s.industry||0),-2,2),stability:clamp(Math.round(+s.stability||0),-20,20)});
  out.reactions=out.reactions.slice(0,6); out.events=out.events.slice(0,4);
  return out;
}

/* ---------------- Rules-based fallback engine ---------------- */
const blank = n => ({narrative:n, border_changes:[], relation_changes:[], reactions:[], events:[], wars:[], treaties:[], stat_changes:[]});
function battle(att, def, res, label){
  const fr = borders(att, def); if(!fr.length){ res.events.push({text:`${nm(att)} cannot reach ${nm(def)}'s lines; the front stays quiet.`}); return false; }
  const a = strength(att)*(0.6+rnd()*0.8), d = strength(def)*(0.7+rnd()*0.8)*(1+S.nat[def].fort*0.08) + alliesOf(def).filter(x=>atWar(x,att)).reduce((s,x)=>s+strength(x)*0.3,0);
  if(a > d){ const cap=D.N[def][6]; const opts=fr.sort((x,y)=>(x===cap)-(y===cap)); const r=opts[0]; res.border_changes.push({region:r,to:att});
    res.stat_changes.push({nation:def,army:-1,stability:-8},{nation:att,stability:+3}); res.events.push({text:`${label||'Ink-black columns'} — ${nm(att)} breaks through and seizes ${REG[r].name}.`}); return true; }
  res.stat_changes.push({nation:att,army:rnd()<0.5?-1:0,stability:-4}); res.events.push({text:`${nm(def)} holds the line against ${nm(att)}. The mud swallows another month.`}); return false;
}
function fallbackResolve(act){
  const P=S.player, T=act.target, tn=nm(T), r0=rel(P,T);
  let kind = act.kind, text=(act.text||'').toLowerCase();
  if(kind==='free'){
    if(/(attack|invade|war|strike|bomb|conquer|march on)/.test(text)) kind='attack';
    else if(/(demand|annex|cede|give us|hand over)/.test(text)) kind='demand';
    else if(/(ally|alliance|pact|treaty|friend|talk|negotiat|peace|join)/.test(text)) kind= /peace/.test(text)?'peace':'talk';
    else if(/(fortif|defend|guarantee|protect|build|army|rearm|mobili)/.test(text)) kind='defend';
    else kind='act';
  }
  const res = blank('');
  if(kind==='talk'){
    const gain = Math.round(4 + rnd()*10 + ideoAffinity(P,T)/5);
    res.relation_changes.push({a:P,b:T,delta:gain});
    const nr = r0+gain; let n = `Your envoys sit across a smoke-filled table in ${REG[D.N[T][6]].name}. Relations with ${tn} ${gain>=0?'warm':'cool'} (${gain>=0?'+':''}${gain}).`;
    if(atWar(P,T)){ if(rnd()<0.25+ (S.nat[T].stability<35?0.3:0)){ res.wars.push({action:'peace',a:P,b:T}); n+=` Exhausted, ${tn} accepts an armistice.`; } else n+=` ${tn} refuses to stop the guns.`; }
    else if(nr>70 && !hasTreaty('alliance',P,T) && rnd()<0.6){ res.treaties.push({type:'alliance',a:P,b:T}); n+=` A secret alliance is signed in fountain-pen ink.`; }
    else if(nr>35 && !hasTreaty('non_aggression',P,T) && rnd()<0.5){ res.treaties.push({type:'non_aggression',a:P,b:T}); n+=` Both sides sign a non-aggression pact.`; }
    res.reactions.push({nation:T, text: nr>40?'"We are pleased to find a reasonable partner."':'"Words are cheap. We will watch your deeds."'});
    res.narrative=n;
  } else if(kind==='peace'){
    if(atWar(P,T) && rnd()<0.45){ res.wars.push({action:'peace',a:P,b:T}); res.narrative=`White flags over the trenches. ${tn} agrees to an armistice.`; }
    else res.narrative = atWar(P,T) ? `${tn} rejects your peace feelers outright.` : `You are not at war with ${tn}; your offer of eternal peace is noted with puzzlement.`;
    res.relation_changes.push({a:P,b:T,delta:5});
  } else if(kind==='act'){
    const roll=rnd(); const sel = /spy|espion|sabot/.test(text)?0.1: /trade|aid|loan|econom/.test(text)?0.5: /propag|radio|subvert/.test(text)?0.85: roll;
    if(T===P){ res.stat_changes.push({nation:P,industry:1,stability:3}); res.narrative='Five-year plans, new factories, posters on every wall. Industry grows.'; }
    else if(sel<0.33){ const caught=rnd()<0.35; res.stat_changes.push({nation:T,stability:-6}); res.narrative=`Your agents slip into ${tn} under a moonless sky. Sabotage cripples a rail junction.`; if(caught){ res.relation_changes.push({a:P,b:T,delta:-20}); res.narrative+=' But one spy is caught — and talks.'; res.reactions.push({nation:T,text:'"This act of espionage will not be forgotten."'}); } }
    else if(sel<0.7){ res.stat_changes.push({nation:P,industry:1},{nation:T,industry:1}); res.relation_changes.push({a:P,b:T,delta:8}); res.treaties.push({type:'trade',a:P,b:T}); res.narrative=`Freight trains of coal and steel roll between your nation and ${tn}. A trade deal is struck.`; }
    else { res.stat_changes.push({nation:T,stability:-5}); res.relation_changes.push({a:P,b:T,delta:-6}); res.narrative=`Your radio towers beam propaganda deep into ${tn}. Unrest stirs in the cafés.`; }
  } else if(kind==='defend'){
    if(T===P){ S.nat[P].fort=clamp(S.nat[P].fort+1,0,6); res.stat_changes.push({nation:P,army:1,stability:2}); res.narrative='Concrete bunkers rise along your frontier. Conscription swells the ranks.'; }
    else { res.treaties.push({type:'guarantee',a:P,b:T}); res.relation_changes.push({a:P,b:T,delta:12}); res.narrative=`You publicly guarantee the independence of ${tn}. Any aggressor will answer to you.`;
      NAT.filter(x=>x!==P&&x!==T&&S.nat[x].alive&&rel(x,T)<-20).slice(0,2).forEach(x=>{ res.relation_changes.push({a:P,b:x,delta:-8}); res.reactions.push({nation:x,text:'"Meddling in affairs that do not concern you."'}); }); }
  } else if(kind==='demand'){
    const fr=borders(P,T); const ratio=strength(P)/Math.max(1,strength(T)+alliesOf(T).reduce((s,x)=>s+strength(x)*0.5,0));
    if(!fr.length) res.narrative=`${tn} shares no border with you. Your demand is laughed out of the chancellery.`;
    else if(ratio>1.4 && rnd()<0.6){ res.border_changes.push({region:fr[0],to:P}); res.relation_changes.push({a:P,b:T,delta:-30}); res.narrative=`Faced with your armies, ${tn} buckles and cedes ${REG[fr[0]].name}. Appeasement has a price.`;
      ['UK','FRA','SOV'].filter(x=>x!==P&&x!==T).forEach(x=>res.relation_changes.push({a:P,b:x,delta:-10})); }
    else { res.relation_changes.push({a:P,b:T,delta:-20}); res.narrative=`${tn} rejects your ultimatum. The newspapers print it in thick black letters.`; res.reactions.push({nation:T,text:'"Not one inch."'}); }
  } else if(kind==='attack'){
    if(T===P){ res.narrative='Your generals stare at you. Attack... yourself? They quietly cancel the order.'; return res; }
    let n='';
    if(!atWar(P,T)){ res.wars.push({action:'declare',a:P,b:T}); n=`Sirens wail. ${nm(P)} declares war on ${tn}. `;
      alliesOf(T).concat(S.treaties.filter(t=>t.type==='guarantee'&&t.b===T).map(t=>t.a)).filter(x=>x!==P&&S.nat[x].alive).forEach(x=>{ if(rnd()<0.75){ res.wars.push({action:'declare',a:x,b:P}); res.reactions.push({nation:x,text:`"We stand with ${tn}."`}); } });
      NAT.filter(x=>![P,T].includes(x)&&D.N[x][7]&&S.nat[x].alive).forEach(x=>res.relation_changes.push({a:P,b:x,delta:-Math.round(5+rnd()*10)})); }
    const won = battle(P,T,res,'Columns of ink and steel');
    res.narrative = n + (won?'The first offensive succeeds.':'The first offensive stalls.');
  }
  return res;
}
function advisorText(T){
  const P=S.player; const threats=NAT.filter(x=>x!==P&&S.nat[x].alive).sort((a,b)=>(rel(P,a)-strength(a)*3)-(rel(P,b)-strength(b)*3));
  const friends=NAT.filter(x=>x!==P&&S.nat[x].alive).sort((a,b)=>rel(P,b)-rel(P,a));
  let t=`Chief of Staff: "Our greatest danger is ${nm(threats[0])} (relations ${rel(P,threats[0])}). Our firmest friend is ${nm(friends[0])} (${rel(P,friends[0])}).`;
  if(T&&T!==P){ const ratio=(strength(P)/Math.max(1,strength(T))).toFixed(1); t+=` Against ${nm(T)} our strength ratio is ${ratio}:1${borders(P,T).length?'' :' and we share no front'}. ${ratio>1.5&&borders(P,T).length?'A demand might succeed.':ratio<0.8?'Do not provoke them.':'Diplomacy first.'}`; }
  if(S.wars.some(w=>w.a===P||w.b===P)) t+=' We are at war — fortify, or sue for peace before stability collapses.';
  return t+'"';
}
// AI nations act on their own each month
function worldTick(){
  const res=blank(''); const P=S.player; const ym=S.y*12+S.m;
  const script=[ [1936*12+6,'ESP', 'Civil war tears Spain apart. Foreign volunteers pour across the Pyrenees.', r=>r.stat_changes.push({nation:'ESP',stability:-30,army:-1})],
    [1936*12+2,'GER','German troops march into the demilitarized Rhineland.', r=>r.relation_changes.push({a:'GER',b:'FRA',delta:-15})],
    [1938*12+2,'GER','ANSCHLUSS', r=>{ if(S.owner.vie==='AUT'&&P!=='AUT'&&P!=='GER'&&rnd()<0.8) ['vie','tyr'].forEach(x=>r.border_changes.push({region:x,to:'GER'})); }],
    [1938*12+8,'GER','MUNICH', r=>{ if(S.owner.sud==='CZE'&&S.owner.bav==='GER'&&P!=='CZE'&&P!=='GER'&&rnd()<0.6) r.border_changes.push({region:'sud',to:'GER'}); }],
    [1939*12+3,'ITA','ALB', r=>{ if(S.owner.alb==='ALB'&&P!=='ALB'&&P!=='ITA'&&rnd()<0.7) r.border_changes.push({region:'alb',to:'ITA'}); }] ];
  const cession = new Set();
  for(const [when,who,txt,fn] of script){ if(ym===when && S.nat[who].alive && who!==P){ const before=res.border_changes.length; fn(res); if(res.border_changes.length>before){ res.events.push({text: txt==='ANSCHLUSS'?'Austria is absorbed into the Reich without a shot.':txt==='MUNICH'?'At Munich the powers hand the Sudetenland to Germany.':'Italian troops land at Durazzo; Albania falls.'}); res.border_changes.slice(before).forEach(b=>cession.add(b.region)); } else if(!/^[A-Z]+$/.test(txt)) res.events.push({text:txt}); fn===null; } }
  // ongoing wars between AI nations (player's wars resolve only partly: enemy counterattacks)
  for(const w of S.wars.slice()){ const [att,def] = rnd()<0.5?[w.a,w.b]:[w.b,w.a]; if(att===P) continue; if(rnd()<0.6) battle(att,def,res); }
  // random AI diplomacy / aggression
  const ais=NAT.filter(x=>x!==P&&S.nat[x].alive);
  for(let k=0;k<2;k++){ const a=pick(ais), b=pick(ais.filter(x=>x!==a)); if(!b) break; const r=rel(a,b);
    if(D.N[a][3]!=='democratic' && r<-35 && strength(a)>strength(b)*1.6 && borders(a,b).length && !atWar(a,b) && !hasTreaty('non_aggression',a,b) && S.y>=1937 && rnd()<0.35){ res.wars.push({action:'declare',a,b}); res.events.push({text:`${nm(a)} launches a surprise invasion of ${nm(b)}!`}); }
    else { const d=Math.round((rnd()-0.5)*12 + ideoAffinity(a,b)/8); res.relation_changes.push({a,b,delta:d}); if(Math.abs(d)>=6) res.events.push({text:`${nm(a)} ${d>0?'courts':'snubs'} ${nm(b)}.`}); } }
  // AI opinion of the player drifts
  ais.forEach(x=>{ if(rnd()<0.15) res.relation_changes.push({a:P,b:x,delta:Math.round((rnd()-0.5)*6)}); });
  // war weariness
  for(const w of S.wars) for(const c of [w.a,w.b]) res.stat_changes.push({nation:c,stability:-2});
  for(const w of S.wars) if(w.a!==P&&w.b!==P&&(S.nat[w.a].stability<20||S.nat[w.b].stability<20)&&rnd()<0.4) res.wars.push({action:'peace',a:w.a,b:w.b});
  ais.forEach(x=>{ if(!S.wars.some(w=>w.a===x||w.b===x)) res.stat_changes.push({nation:x,stability:1}); if(rnd()<0.08) res.stat_changes.push({nation:x,army:1}); });
  // enforce plausibility: only scripted cessions or war gains
  res.border_changes=res.border_changes.filter(b=>cession.has(b.region)||atWar(b.to,S.owner[b.region])||res.wars.some(w=>w.action==='declare'));
  res.narrative = res.events.length ? 'Elsewhere in Europe:' : 'A quiet month. Too quiet.';
  return res;
}

/* ---------------- LLM client ---------------- */
function loadCfg(){ const d={enabled:true, kind:'auto', base:'http://127.0.0.1:11434', model:'', timeout:90, temperature:0.7, worldByAI:false}; try{ return Object.assign(d, JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){ return d; } }
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); }
let PROXY = null;
const HOSTED = location.protocol==='https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if(HOSTED){ CFG.enabled=false; } // set if served by server.py
async function detectProxy(){ if(location.protocol==='file:'||HOSTED) return PROXY=false; try{ const r=await fetch('/api/ping',{cache:'no-store'}); const j=await r.json(); PROXY = !!(j&&j.server==='ww2-ai'); }catch(e){ PROXY=false; } return PROXY; }
async function xfetch(url, opts={}, timeoutMs=8000){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(), timeoutMs);
  try{ const u = PROXY ? '/llm?url='+encodeURIComponent(url) : url; return await fetch(u, Object.assign({signal:ctl.signal}, opts)); } finally { clearTimeout(t); }
}
async function autodetect(){
  const out=[]; let hints=[];
  if(PROXY){ try{ const h=await (await fetch('/api/hints')).json(); hints=h.candidates||[]; if(h.models) out.push(...h.models.map(m=>({hint:m}))); }catch(e){} }
  const bases=[...new Set([...hints, 'http://127.0.0.1:11434','http://127.0.0.1:1234','http://127.0.0.1:8080','http://127.0.0.1:8000','http://127.0.0.1:5001'])];
  const found=[];
  for(const b of bases){
    try{ const r=await xfetch(b.replace(/\/v1\/?$/,'')+'/api/tags',{},2500); if(r.ok){ const j=await r.json(); if(j.models){ found.push({kind:'ollama',base:b.replace(/\/v1\/?$/,''),models:j.models.map(m=>m.name)}); continue; } } }catch(e){}
    try{ const root=b.replace(/\/$/,''); const r=await xfetch((/\/v1$/.test(root)?root:root+'/v1')+'/models',{},2500); if(r.ok){ const j=await r.json(); if(j.data) found.push({kind:'openai',base:/\/v1$/.test(root)?root:root+'/v1',models:j.data.map(m=>m.id)}); } }catch(e){}
  }
  return {found, hintModels: out.map(o=>o.hint)};
}
function pickModel(models, hints){ const ok=models.filter(m=>!/embed|bge|nomic|minilm/i.test(m)); for(const h of hints||[]) { const f=ok.find(m=>m===h||m.endsWith('/'+h)||h.endsWith(m)); if(f) return f; } return ok[0]||models[0]||''; }
function buildPrompt(act, worldOnly){
  const P=S.player, T=act&&act.target;
  const near=new Set([P,T].filter(Boolean)); NAT.forEach(x=>{ if(S.nat[x].alive&&(T&&borders(x,T).length||borders(x,P).length)) near.add(x); });
  const regs=[...near].map(c=>`${c}(${nm(c)}): ${regionsOf(c).map(r=>r).join(',')}`).join('\n');
  const rels=NAT.filter(x=>x!==P&&S.nat[x].alive).map(x=>`${x}:${rel(P,x)}`).join(' ');
  const wars=S.wars.map(w=>`${w.a} vs ${w.b}`).join('; ')||'none';
  const tr=S.treaties.map(t=>`${t.type} ${t.a}-${t.b}`).join('; ')||'none';
  const st=[...near].map(c=>`${c} army ${S.nat[c].army} industry ${S.nat[c].industry} stability ${S.nat[c].stability}`).join('; ');
  const sys=`You are the gritty, impartial game master of an alternate-history WWII grand strategy game set in Europe. Reply with ONE JSON object ONLY, no prose outside JSON, matching exactly:
{"narrative":string (2-4 vivid sentences, second person "you" for the player),"border_changes":[{"region":regionId,"to":NATION}],"relation_changes":[{"a":NATION,"b":NATION,"delta":int -40..40}],"reactions":[{"nation":NATION,"text":short quote}],"events":[{"text":string}],"wars":[{"action":"declare"|"peace","a":NATION,"b":NATION}],"treaties":[{"type":"alliance"|"non_aggression"|"guarantee"|"trade","a":NATION,"b":NATION}],"stat_changes":[{"nation":NATION,"army":int -3..3,"industry":int -2..2,"stability":int -20..20}]}
Rules: NATION must be one of ${NAT.join(',')}. regionId must be from the lists given. Be realistic: weak nations rarely win, border changes only between neighbours and only through war or a credible ultimatum, at most 2 border changes. Other nations react plausibly to the player's move. Use empty arrays when nothing happens.`;
  const usr=`Date: ${dateStr()}. Player nation: ${P} (${nm(P)}).
Player relations: ${rels}
Wars: ${wars}
Treaties: ${tr}
Stats: ${st}
Regions owned:
${regs}
` + (worldOnly ? `TASK: Resolve one month of AI-nation activity across Europe (no player action).` :
 `PLAYER ACTION: ${act.kind.toUpperCase()} targeting ${T} (${nm(T)}).${act.text?` Player's words: "${act.text}"`:''}
Resolve this action and the reactions of other nations.`);
  return {sys, usr};
}
async function llmCall(msgs){
  const tmo=(+CFG.timeout||90)*1000;
  if(CFG.kind==='openai'){
    const body={model:CFG.model, messages:msgs, temperature:+CFG.temperature, response_format:{type:'json_object'}, stream:false};
    let r=await xfetch(CFG.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo);
    if(r.status===400){ delete body.response_format; r=await xfetch(CFG.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo); }
    if(!r.ok) throw new Error('HTTP '+r.status); const j=await r.json(); return j.choices[0].message.content;
  }
  const body={model:CFG.model, messages:msgs, stream:false, format:SCHEMA, options:{temperature:+CFG.temperature, num_ctx:4096}};
  let r=await xfetch(CFG.base.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo);
  if(r.status===400||r.status===500){ body.format='json'; r=await xfetch(CFG.base.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo); }
  if(!r.ok) throw new Error('HTTP '+r.status); const j=await r.json(); return j.message.content;
}
async function aiResolve(act, worldOnly){
  if(!CFG.enabled || !CFG.model || (CFG.kind!=='ollama'&&CFG.kind!=='openai')) return null;
  const {sys,usr}=buildPrompt(act, worldOnly); const msgs=[{role:'system',content:sys},{role:'user',content:usr}];
  const ctx={target:act&&act.target, allowCession: act && (act.kind==='free'||act.kind==='act'||act.kind==='talk')};
  for(let attempt=0; attempt<2; attempt++){
    let raw;
    try{ raw=await llmCall(msgs); }catch(e){ setAIStatus('offline: '+(e.name==='AbortError'?'timed out':e.message)); return null; }
    try{ const v=validate(raw, ctx); setAIStatus('online · '+CFG.model); return v; }
    catch(e){ msgs.push({role:'assistant',content:String(raw).slice(0,2000)},{role:'user',content:`That was invalid (${e.message}). Reply again with ONLY the JSON object in the required schema.`}); }
  }
  setAIStatus('model gave invalid JSON twice — rules engine used'); return null;
}

/* ---------------- Turn flow ---------------- */
async function doAction(act){
  if(busy) return; busy=true; hidePopup(); showBusy(true);
  try{
    if(act.kind==='advisor'){
      let txt=null;
      if(CFG.enabled&&CFG.model&&CFG.kind!=='auto'){ try{ const {sys,usr}=buildPrompt({kind:'advisor',target:act.target,text:act.text}); const raw=await llmCall([{role:'system',content:sys},{role:'user',content:usr+'\nThis is only a request for ADVICE from the player\'s chief advisor. Put the advice in "narrative" (in character, 3 sentences), leave all arrays empty.'}]); txt='Advisor: '+validate(raw).narrative; S.aiStats.llm++; }catch(e){ txt=null; } }
      if(!txt){ txt=advisorText(act.target); }
      addLog('advisor', txt); renderAll(); return;
    }
    let res = await aiResolve(act,false), src='ai';
    if(!res){ res=fallbackResolve(act); src='rules'; S.aiStats.fallback++; } else S.aiStats.llm++;
    res.narrative = (src==='rules'?'':'') + res.narrative;
    addLog('turn', `— ${nm(S.player)}: ${act.kind==='free'?'"'+act.text+'"':act.kind.toUpperCase()} → ${nm(act.target)} ${src==='ai'?'[AI]':'[rules]'}`);
    applyResult(res);
    await endMonth();
  } finally { busy=false; showBusy(false); renderAll(); }
}
async function endMonth(){
  let w=null; if(CFG.worldByAI) w=await aiResolve(null,true);
  applyResult(w||worldTick());
  S.m++; if(S.m>11){S.m=0;S.y++;} S.turn++;
  if(!S.nat[S.player].alive){ addLog('war', `${nm(S.player)} has fallen. History will be written by others. (Start a new game or load a save.)`); }
  autosave();
}
async function passTurn(){ if(busy) return; busy=true; showBusy(true); try{ addLog('turn','— You wait and watch.'); await endMonth(); } finally{ busy=false; showBusy(false); renderAll(); } }

/* ---------------- Save / load ---------------- */
function autosave(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){} }
function loadFrom(key){ const s=localStorage.getItem(key); if(!s) return false; S=JSON.parse(s); renderAll(); return true; }

/* ---------------- Rendering ---------------- */
const flash=new Set();
const canvas=$('#map'), ctx=canvas.getContext('2d');
canvas.width=COLS*CS; canvas.height=ROWS*CS;
let paper=null, patterns={};
function makePaper(){ const c=document.createElement('canvas'); c.width=canvas.width; c.height=canvas.height; const g=c.getContext('2d');
  g.fillStyle='#e9dfc7'; g.fillRect(0,0,c.width,c.height);
  let s=12345; const r=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let i=0;i<9000;i++){ g.fillStyle=`rgba(60,40,20,${r()*0.06})`; g.fillRect(r()*c.width,r()*c.height,1+r()*2,1+r()*2); }
  // sea hatching
  g.strokeStyle='rgba(30,30,40,0.18)'; g.lineWidth=1;
  for(let y=0;y<c.height;y+=6){ g.beginPath(); for(let x=0;x<c.width;x+=12){ g.lineTo(x, y+Math.sin(x*0.05+y)*1.2); } g.stroke(); }
  return c; }
function hatch(color, angle){ const k=color+angle; if(patterns[k]) return patterns[k]; const p=document.createElement('canvas'); p.width=p.height=12; const g=p.getContext('2d');
  g.fillStyle=color; g.fillRect(0,0,12,12); g.strokeStyle='rgba(15,10,5,0.35)'; g.lineWidth=1.2; g.translate(6,6); g.rotate(angle*Math.PI/180);
  for(let i=-18;i<=18;i+=5){ g.beginPath(); g.moveTo(-18,i); g.lineTo(18,i); g.stroke(); }
  return patterns[k]=ctx.createPattern(p,'repeat'); }
let hoverNat=null, selNat=null;
function drawMap(){
  if(!paper) paper=makePaper();
  ctx.drawImage(paper,0,0);
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const g=GRID[r*COLS+c]; if(g<0) continue; const id=RIDS[g], o=S.owner[id];
    ctx.fillStyle=hatch(D.N[o][1], D.N[o][2]); ctx.fillRect(c*CS,r*CS,CS,CS);
    if(o===hoverNat||o===selNat){ ctx.fillStyle='rgba(255,250,230,0.22)'; ctx.fillRect(c*CS,r*CS,CS,CS); }
    if(flash.has(id)){ ctx.fillStyle='rgba(200,20,10,0.35)'; ctx.fillRect(c*CS,r*CS,CS,CS); }
  }
  // borders: region (thin) and nation (thick ink); coast
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const g=GRID[r*COLS+c];
    for(const [dr,dc] of [[0,1],[1,0]]){ if(r+dr>=ROWS||c+dc>=COLS) continue; const h=GRID[(r+dr)*COLS+c+dc]; if(g===h) continue;
      const x=(c+dc)*CS, y=(r+dr)*CS; let w, col;
      if(g<0||h<0){ w=2.6; col='#15110c'; } else if(S.owner[RIDS[g]]!==S.owner[RIDS[h]]){ w=2.4; col='#0d0a07'; } else { w=0.6; col='rgba(20,15,10,0.45)'; }
      ctx.strokeStyle=col; ctx.lineWidth=w; ctx.beginPath();
      if(dc){ ctx.moveTo(x, y); ctx.lineTo(x, y+CS); } else { ctx.moveTo(x, y); ctx.lineTo(x+CS, y); } ctx.stroke(); } }
  // war fronts: red stitches
  ctx.strokeStyle='#b3140c'; ctx.lineWidth=3; 
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const g=GRID[r*COLS+c]; if(g<0) continue;
    for(const [dr,dc] of [[0,1],[1,0]]){ if(r+dr>=ROWS||c+dc>=COLS) continue; const h=GRID[(r+dr)*COLS+c+dc]; if(h<0) continue; const a=S.owner[RIDS[g]], b=S.owner[RIDS[h]];
      if(a!==b && atWar(a,b) && (r+c)%2===0){ const x=(c+dc)*CS, y=(r+dr)*CS; ctx.beginPath(); if(dc){ctx.moveTo(x-3,y+1);ctx.lineTo(x+3,y+CS-1);} else {ctx.moveTo(x+1,y-3);ctx.lineTo(x+CS-1,y+3);} ctx.stroke(); } } }
  // capitals & labels
  ctx.textAlign='center'; ctx.textBaseline='middle';
  NAT.forEach(n=>{ if(!S.nat[n].alive) return; const regs=regionsOf(n); if(!regs.length) return; const cap=S.owner[D.N[n][6]]===n?D.N[n][6]:regs[0];
    const [x,y]=toPx(REG[cap].lon,REG[cap].lat); ctx.fillStyle='#0d0a07'; ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fill(); ctx.strokeStyle='#efe6cf'; ctx.lineWidth=1.5; ctx.stroke();
    const size = regs.length>6?17: regs.length>2?13:10;
    ctx.font=`900 ${size}px "Impact","Oswald","Arial Narrow",sans-serif`; const label=(n==='UK'?'BRITAIN':n==='SOV'?'U.S.S.R.':nm(n).toUpperCase());
    ctx.lineWidth=4; ctx.strokeStyle='rgba(239,230,207,0.9)'; ctx.strokeText(label,x,y-12); ctx.fillStyle=n===S.player?'#7a0c06':'#0d0a07'; ctx.fillText(label,x,y-12); });
  // player marker
}
function renderAll(){ if(!S) return; drawMap(); renderHUD(); renderLog(); renderRelations(); }
function renderHUD(){ $('#date').textContent=dateStr(); $('#pname').textContent=nm(S.player); $('#pflag').style.background=D.N[S.player][1];
  const n=S.nat[S.player]; $('#pstats').textContent=`Army ${n.army} · Industry ${n.industry} · Stability ${n.stability} · Forts ${n.fort} · Regions ${regionsOf(S.player).length}`;
  $('#aistat').textContent = `AI turns: ${S.aiStats.llm} · rules turns: ${S.aiStats.fallback}`; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function renderLog(){ $('#log').innerHTML=S.log.slice(0,120).map(l=>`<div class="le ${l.kind}"><span class="ld">${l.d}</span> ${esc(l.text)}</div>`).join(''); }
function renderRelations(){ const P=S.player; const rows=NAT.filter(x=>x!==P&&S.nat[x].alive).sort((a,b)=>rel(P,b)-rel(P,a)).map(x=>{ const v=rel(P,x); const tags=[atWar(P,x)?'<b class="war">WAR</b>':'', hasTreaty('alliance',P,x)?'ally':'', hasTreaty('non_aggression',P,x)?'NAP':'', hasTreaty('guarantee',P,x)?'guar.':'', hasTreaty('trade',P,x)?'trade':''].filter(Boolean).join(' ');
  return `<div class="rr" data-n="${x}"><span class="sw" style="background:${D.N[x][1]}"></span><span class="rn">${nm(x)}</span><span class="bar"><i style="width:${Math.abs(v)/2}%;${v<0?'right:50%;background:#8e1b12':'left:50%;background:#2c2a26'}"></i></span><span class="rv">${v}</span><span class="tg">${tags}</span></div>`; }).join('');
  const wars=S.wars.map(w=>`${nm(w.a)} ⚔ ${nm(w.b)}`).join('<br>')||'Europe is at peace — for now.';
  $('#rels').innerHTML=`<div class="wars">${wars}</div>`+rows; }

/* ---------------- Interaction ---------------- */
function cellAt(ev){ const b=canvas.getBoundingClientRect(); const x=(ev.clientX-b.left)*canvas.width/b.width, y=(ev.clientY-b.top)*canvas.height/b.height; const c=Math.floor(x/CS), r=Math.floor(y/CS); if(c<0||r<0||c>=COLS||r>=ROWS) return null; const g=GRID[r*COLS+c]; return g<0?null:RIDS[g]; }
/* View: pinch-zoom / pan / tap via pointer events */
const wrap=$('#mapwrap'); const V={s:1,x:0,y:0,fit:1};
function applyView(){ canvas.style.transform=`translate(${V.x}px,${V.y}px) scale(${V.s})`; }
function fitView(){ const w=wrap.clientWidth, h=wrap.clientHeight-4; V.fit=Math.min(w/canvas.width, h/canvas.height); V.s=V.fit; V.x=(w-canvas.width*V.s)/2; V.y=Math.max(0,(h-canvas.height*V.s)/2); applyView(); }
function clampView(){ const w=wrap.clientWidth, h=wrap.clientHeight, cw=canvas.width*V.s, ch=canvas.height*V.s;
  V.x = cw<=w ? (w-cw)/2 : clamp(V.x, w-cw-40, 40); V.y = ch<=h ? (h-ch)/2 : clamp(V.y, h-ch-40, 40); applyView(); }
function zoomAt(px,py,f){ const ns=clamp(V.s*f, V.fit*0.9, V.fit*7); const k=ns/V.s; V.x=px-(px-V.x)*k; V.y=py-(py-V.y)*k; V.s=ns; clampView(); }
window.addEventListener('resize', ()=>{ const was=V.s<=V.fit*1.01; const old=V.fit; fitView(); });
const ptrs=new Map(); let gesture=null;
function wrapXY(e){ const b=wrap.getBoundingClientRect(); return [e.clientX-b.left, e.clientY-b.top]; }
canvas.addEventListener('pointerdown', e=>{ canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); 
  if(ptrs.size===1) gesture={type:'tap', sx:e.clientX, sy:e.clientY, vx:V.x, vy:V.y, t:Date.now()};
  else if(ptrs.size===2){ const [p,q]=[...ptrs.values()]; gesture={type:'pinch', d:Math.hypot(p.x-q.x,p.y-q.y), s:V.s, vx:V.x, vy:V.y, cx:(p.x+q.x)/2, cy:(p.y+q.y)/2}; } });
canvas.addEventListener('pointermove', e=>{
  if(e.pointerType==='mouse' && !ptrs.size){ if(!S) return; const id=cellAt(e); const n=id?S.owner[id]:null; const tip=$('#tip');
    if(id){ tip.style.display='block'; tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+10)+'px'; tip.textContent=`${REG[id].name} — ${nm(n)}`; } else tip.style.display='none';
    if(n!==hoverNat){ hoverNat=n; drawMap(); } return; }
  if(!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(!gesture) return;
  if(gesture.type!=='pinch' && ptrs.size===1){ const dx=e.clientX-gesture.sx, dy=e.clientY-gesture.sy;
    if(gesture.type==='tap' && Math.hypot(dx,dy)>8) gesture.type='pan';
    if(gesture.type==='pan'){ V.x=gesture.vx+dx; V.y=gesture.vy+dy; clampView(); } }
  else if(gesture.type==='pinch' && ptrs.size>=2){ const [p,q]=[...ptrs.values()]; const d=Math.hypot(p.x-q.x,p.y-q.y), cx=(p.x+q.x)/2, cy=(p.y+q.y)/2;
    const b=wrap.getBoundingClientRect(); const ns=clamp(gesture.s*d/gesture.d, V.fit*0.9, V.fit*7); const ox=gesture.cx-b.left, oy=gesture.cy-b.top;
    V.s=ns; V.x=ox-(ox-gesture.vx)*(ns/gesture.s)+(cx-gesture.cx); V.y=oy-(oy-gesture.vy)*(ns/gesture.s)+(cy-gesture.cy); clampView(); } });
function endPtr(e){ if(!ptrs.has(e.pointerId)) return; lastPtrType=e.pointerType; ptrs.delete(e.pointerId);
  if(gesture && gesture.type==='tap' && ptrs.size===0 && Date.now()-gesture.t<700){ if(S&&!busy){ const id=cellAt(e); if(!id) hidePopup(); else showPopup(S.owner[id], id, e.clientX, e.clientY); } }
  if(ptrs.size===0) gesture=null; else if(gesture&&gesture.type==='pinch'){ const [p]=[...ptrs.values()]; gesture={type:'pan', sx:p.x, sy:p.y, vx:V.x, vy:V.y}; } }
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('touchend', e=>e.preventDefault(), {passive:false}); // no ghost click onto the sheet
 canvas.addEventListener('pointercancel', e=>{ ptrs.delete(e.pointerId); if(!ptrs.size) gesture=null; });
canvas.addEventListener('pointerleave', e=>{ if(e.pointerType==='mouse'){ $('#tip').style.display='none'; hoverNat=null; if(S) drawMap(); } });
wrap.addEventListener('wheel', e=>{ e.preventDefault(); const [x,y]=wrapXY(e); zoomAt(x,y, e.deltaY<0?1.15:1/1.15); }, {passive:false});
['gesturestart','gesturechange'].forEach(t=>wrap.addEventListener(t, e=>e.preventDefault(), {passive:false}));
$('#zin').addEventListener('click',()=>zoomAt(wrap.clientWidth/2, wrap.clientHeight/2, 1.4));
$('#zout').addEventListener('click',()=>zoomAt(wrap.clientWidth/2, wrap.clientHeight/2, 1/1.4));
$('#zfit').addEventListener('click', fitView);
// Keep bottom sheet above the iOS keyboard
const MOBILE=()=>window.matchMedia('(max-width: 820px), (max-height: 500px)').matches;
if(window.visualViewport){ const vv=window.visualViewport; const f=()=>{ const kb=Math.max(0, window.innerHeight-vv.height-vv.offsetTop); document.documentElement.style.setProperty('--kb', kb+'px'); }; vv.addEventListener('resize',f); vv.addEventListener('scroll',f); }
let popTarget=null, popOpenedAt=0, lastPtrType='mouse';
function showPopup(n, rid, x, y){ popTarget=n; popOpenedAt=(lastPtrType==='mouse')?0:Date.now(); selNat=n; drawMap(); const P=S.player, p=$('#popup');
  $('#pp-title').textContent=nm(n)+(n===P?' (you)':''); $('#pp-flag').style.background=D.N[n][1];
  const st=S.nat[n]; $('#pp-info').innerHTML=`${esc(REG[rid].name)} · ${D.N[n][3]} · army ${st.army} · industry ${st.industry} · stability ${st.stability}<br>Relations with you: <b>${rel(P,n)}</b> ${atWar(P,n)?'<b class="war">AT WAR</b>':''}`;
  p.style.display='block'; if(MOBILE()){ p.classList.add('sheet'); p.style.left=''; p.style.top=''; $('#pp-text').value=''; return; } p.classList.remove('sheet'); const w=p.offsetWidth, h=p.offsetHeight; p.style.left=Math.min(window.innerWidth-w-8, x+10)+'px'; p.style.top=Math.min(window.innerHeight-h-8, Math.max(8,y-20))+'px';
  $('#pp-text').value=''; }
function hidePopup(){ $('#popup').style.display='none'; selNat=null; if(S) drawMap(); }
document.querySelectorAll('#popup [data-act]').forEach(b=>b.addEventListener('click',()=>{ if(Date.now()-popOpenedAt<350) return; const k=b.dataset.act; doAction({kind:k, target:popTarget}); }));
$('#pp-go').addEventListener('click',()=>{ const t=$('#pp-text').value.trim(); if(t) doAction({kind:'free', target:popTarget, text:t.slice(0,400)}); });
$('#pp-text').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); $('#pp-go').click(); } });
$('#pp-close').addEventListener('click', hidePopup);
$('#btn-pass').addEventListener('click', passTurn);
$('#btn-save').addEventListener('click',()=>{ const slot=$('#slot').value; localStorage.setItem('ww2ai.slot'+slot, JSON.stringify(S)); addLog('event',`Game saved to slot ${slot}.`); renderLog(); });
$('#btn-load').addEventListener('click',()=>{ const slot=$('#slot').value; if(!loadFrom('ww2ai.slot'+slot)) alert('Slot '+slot+' is empty.'); });
$('#btn-export').addEventListener('click',()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(S)],{type:'application/json'})); a.download=`ww2ai-${S.y}-${S.m+1}.json`; a.click(); });
$('#btn-import').addEventListener('click',()=>$('#importfile').click());
$('#importfile').addEventListener('change',async e=>{ const f=e.target.files[0]; if(!f) return; try{ S=JSON.parse(await f.text()); renderAll(); }catch(err){ alert('Bad save file'); } });
$('#btn-new').addEventListener('click',()=>{ if(confirm('Start a new game? (current autosave will be replaced)')) showStart(); });
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{ document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on')); t.classList.add('on'); document.querySelectorAll('.pane').forEach(p=>p.style.display= p.id===t.dataset.p?'block':'none'); }));
$('#rels').addEventListener('click',e=>{ const r=e.target.closest('.rr'); if(r){ const n=r.dataset.n; const id=D.N[n][6]; const cap=S.owner[id]===n?id:regionsOf(n)[0]; const [x,y]=toPx(REG[cap].lon,REG[cap].lat); const b=canvas.getBoundingClientRect(); showPopup(n,cap,b.left+x*b.width/canvas.width,b.top+y*b.height/canvas.height); } });
function showBusy(on){ $('#busy').style.display=on?'flex':'none'; }

/* Settings */
function setAIStatus(t){ const e=$('#ai-status'); if(e) e.textContent='AI: '+t; }
function fillSettings(){ $('#s-enabled').checked=CFG.enabled; $('#s-kind').value=CFG.kind; $('#s-base').value=CFG.base; $('#s-model').value=CFG.model; $('#s-timeout').value=CFG.timeout; $('#s-temp').value=CFG.temperature; $('#s-world').checked=CFG.worldByAI; }
function readSettings(){ if(HOSTED){ CFG.enabled=false; CFG.worldByAI=false; return; } CFG.enabled=$('#s-enabled').checked; CFG.kind=$('#s-kind').value; CFG.base=$('#s-base').value.trim(); CFG.model=$('#s-model').value.trim(); CFG.timeout=+$('#s-timeout').value||90; CFG.temperature=+$('#s-temp').value||0.7; CFG.worldByAI=$('#s-world').checked; saveCfg(); }
$('#btn-settings').addEventListener('click',()=>{ fillSettings(); $('#hosted-note').style.display=HOSTED?'block':'none'; document.querySelectorAll('#settings .llm input,#settings .llm select,#settings .llm button').forEach(x=>x.disabled=HOSTED); $('#settings').style.display='flex'; });
$('#s-close').addEventListener('click',()=>{ readSettings(); $('#settings').style.display='none'; setAIStatus(CFG.enabled&&CFG.model?`${CFG.kind} · ${CFG.model}`:'rules engine only'); });
async function runDetect(){ $('#s-detect-out').textContent='Scanning localhost…'; const {found,hintModels}=await autodetect();
  if(!found.length){ $('#s-detect-out').textContent='No local model server found (Ollama :11434, LM Studio :1234, llama.cpp :8080). The rules engine will run the world.'+(PROXY?'':' (Tip: start the game with launch.sh so the local proxy can reach the model.)'); setAIStatus('not found — rules engine'); return false; }
  const f=found[0]; CFG.kind=f.kind; CFG.base=f.base; CFG.model=pickModel(f.models, hintModels); saveCfg(); fillSettings();
  $('#s-detect-out').textContent=`Found ${f.kind} at ${f.base}: ${f.models.join(', ')||'(no models)'}${hintModels.length?' · OpenCode config mentions: '+hintModels.join(', '):''}`;
  $('#s-modellist').innerHTML=f.models.map(m=>`<option value="${esc(m)}">`).join(''); setAIStatus(`${f.kind} · ${CFG.model}`); return true; }
$('#s-detect').addEventListener('click', runDetect);
$('#s-test').addEventListener('click', async()=>{ readSettings(); $('#s-detect-out').textContent='Asking the model for a test reply…'; const t0=performance.now();
  try{ const raw=await llmCall([{role:'system',content:'Reply with JSON only.'},{role:'user',content:'Return {"narrative":"Ready, commander.","border_changes":[],"relation_changes":[],"reactions":[],"events":[],"wars":[],"treaties":[],"stat_changes":[]}'}]); const v=validate(raw); $('#s-detect-out').textContent=`OK in ${((performance.now()-t0)/1000).toFixed(1)}s: "${v.narrative}"`; }
  catch(e){ $('#s-detect-out').textContent='Test failed: '+e.message; } });

/* Start screen */
function showStart(){ const majors=NAT.filter(n=>D.N[n][7]), minors=NAT.filter(n=>!D.N[n][7]);
  const btn=n=>`<button class="nb" data-n="${n}"><span class="sw" style="background:${D.N[n][1]}"></span>${nm(n)}<small>${D.N[n][3]}</small></button>`;
  $('#start-majors').innerHTML=majors.map(btn).join(''); $('#start-minors').innerHTML=minors.map(btn).join('');
  $('#start').style.display='flex'; $('#start-continue').style.display=localStorage.getItem(SAVE_KEY)?'inline-block':'none';
  document.querySelectorAll('#start .nb').forEach(b=>b.onclick=()=>{ $('#start').style.display='none'; newGame(b.dataset.n); fitView(); }); }
$('#start-settings').addEventListener('click',()=>$('#btn-settings').click());
$('#start-continue').addEventListener('click',()=>{ if(loadFrom(SAVE_KEY)){ $('#start').style.display='none'; fitView(); } });

window.WW2 = { V, get hosted(){return HOSTED;}, get state(){return S;}, validate, fallbackResolve, worldTick, ADJ, REG, autodetect, get cfg(){return CFG;}, doAction, passTurn };
(async function init(){ await detectProxy(); showStart(); fitView();
  if(HOSTED){ setAIStatus('rules engine (web version — local AI runs on the PC build)'); }
  else if(CFG.enabled && (CFG.kind==='auto' || !CFG.model)) { fillSettings(); runDetect(); } else setAIStatus(CFG.enabled?`${CFG.kind} · ${CFG.model}`:'rules engine only');
})();
})();
