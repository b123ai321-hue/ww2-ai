/* INK & IRON v3 — world-scale alternate-history WWII. Rules engine + intent parser by default;
   optional local LLM (PC, via server.py proxy) or on-device WebLLM (phone, opt-in). */
(function(){
'use strict';
const D = window.WW2DATA;
const $ = s => document.querySelector(s);
const NAT = Object.keys(D.N);
const REG = {}; D.R.forEach(r => REG[r[0]] = {id:r[0], name:r[1], home:r[2], lon:r[3], lat:r[4], t:r[5][0], river:r[5].includes('r')});
const RIDS = Object.keys(REG);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SAVE_KEY='ww2ai.v3.autosave', CFG_KEY='ww2ai.settings';
const TERR = {p:['plains',1], f:['forest',1.3], m:['mountains',1.8], s:['marsh',1.4], d:['desert',1.15], j:['jungle',1.5], a:['arctic',1.5]};
let S=null, CFG=loadCfg(), busy=false;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rnd(){ S.seed=(S.seed*1664525+1013904223)>>>0; return S.seed/4294967296; }
const pick=a=>a[Math.floor(rnd()*a.length)];
const nm=c=>(D.N[c]||[c])[0];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ================= MAP GRID ================= */
const LON0=-180, LON1=180, LAT0=-56, LAT1=84, KX=0.8, STEP=0.25, CS=4;
const COLS=Math.ceil((LON1-LON0)*KX/STEP), ROWS=Math.ceil((LAT1-LAT0)/STEP);
const POLYS=[]; for(const k in D.LAND){ const p=D.LAND[k]; let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; p.forEach(([x,y])=>{x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}); POLYS.push({k,p,x0,x1,y0,y1}); }
const SEAS=Object.values(D.SEA);
function pip(x,y,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if((yi>y)!=(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
function landOf(lon,lat){ for(const s of SEAS) if(pip(lon,lat,s)) return null; for(const P of POLYS) if(lon>=P.x0&&lon<=P.x1&&lat>=P.y0&&lat<=P.y1&&pip(lon,lat,P.p)) return P.k; return null; }
const GRID=new Int16Array(COLS*ROWS).fill(-1);
const toPx=(lon,lat)=>[(lon-LON0)*KX/STEP*CS, (LAT1-lat)/STEP*CS];
(function buildGrid(){
  const by={}; RIDS.forEach((id,i)=>{ const k=landOf(REG[id].lon,REG[id].lat); (by[k]=by[k]||[]).push({i,x:REG[id].lon*KX,y:REG[id].lat}); });
  const all=[].concat(...Object.values(by));
  for(let r=0;r<ROWS;r++){ const lat=LAT1-(r+0.5)*STEP; for(let c=0;c<COLS;c++){ const lon=LON0+(c+0.5)*STEP/KX; const k=landOf(lon,lat); if(!k) continue;
    const seeds=by[k]||all; let best=-1,bd=1e9; const x=lon*KX; for(const s of seeds){ const d=(s.x-x)*(s.x-x)+(s.y-lat)*(s.y-lat); if(d<bd){bd=d;best=s.i;} } GRID[r*COLS+c]=best; } }
})();
const ADJ={}, LANDADJ={}; RIDS.forEach(id=>{ADJ[id]=new Set();LANDADJ[id]=new Set();});
for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const a=GRID[r*COLS+c]; if(a<0) continue; for(const [dr,dc] of [[0,1],[1,0]]){ if(r+dr>=ROWS||c+dc>=COLS) continue; const b=GRID[(r+dr)*COLS+c+dc]; if(b>=0&&b!==a){ ADJ[RIDS[a]].add(RIDS[b]); ADJ[RIDS[b]].add(RIDS[a]); LANDADJ[RIDS[a]].add(RIDS[b]); LANDADJ[RIDS[b]].add(RIDS[a]); } } }
D.SEALINKS.forEach(([a,b])=>{ ADJ[a].add(b); ADJ[b].add(a); });

/* ================= STATE ================= */
const rk=(a,b)=>a<b?a+'|'+b:b+'|'+a;
const IDEO=c=>D.N[c][3];
function ideoAff(a,b){ const ia=IDEO(a), ib=IDEO(b); if(ia===ib) return 20; if((ia==='communist')!==(ib==='communist')) return -25; if((ia==='fascist'&&ib==='democratic')||(ib==='fascist'&&ia==='democratic')) return -15; return 0; }
function newGame(player){
  S={v:3, seed:(Date.now()>>>0)||7, player, y:1935, m:11, turn:0, owner:{}, rel:{}, wars:[], treaties:[], nat:{}, fort:{}, fronts:[], tension:22, ev:{}, log:[], news:[], claims:{}, flash:[], lastCap:{}};
  RIDS.forEach(id=>S.owner[id]=REG[id].home);
  NAT.forEach(c=>{ const n=D.N[c]; const regs=RIDS.filter(r=>REG[r].home===c).length; S.nat[c]={army:n[4], ind:n[5], q:n[6], mp:n[4]*6+regs*8, gold:40+n[5]*3, bud:defaultBud(c), stab:60, alive:regs>0, start:regs}; });
  S.nat.CHI.stab=40; S.nat.ESP.stab=35; S.nat.FRA.stab=50;
  for(let i=0;i<NAT.length;i++) for(let j=i+1;j<NAT.length;j++) S.rel[rk(NAT[i],NAT[j])]=clamp(ideoAff(NAT[i],NAT[j])+5,-100,100);
  const set=(a,b,v)=>S.rel[rk(a,b)]=v;
  [['UK','FRA',60],['GER','ITA',20],['GER','POL',10],['GER','SOV',-50],['FRA','CZE',55],['SOV','CZE',30],['FRA','POL',40],['ITA','UK',-10],['ITA','FRA',-5],['GER','AUT',10],['HUN','ROM',-35],['HUN','CZE',-35],['BUL','ROM',-20],['ITA','YUG',-25],['ITA','ALB',30],['LIT','POL',-45],['JAP','CHI',-60],['JAP','SOV',-40],['JAP','USA',-15],['USA','UK',40],['USA','CHI',20],['CHI','CCP',-80],['ITA','ETH',-90],['GER','CZE',-25],['SOV','FIN',-20],['SOV','POL',-30],['GER','FRA',-30]].forEach(([a,b,v])=>set(a,b,v));
  ['CAN','AUS','NZL','SAF'].forEach(x=>{ set('UK',x,85); S.treaties.push({type:'alliance',a:'UK',b:x}); });
  [['FRA','CZE'],['FRA','POL'],['SOV','CZE'],['CZE','ROM'],['CZE','YUG'],['ROM','YUG'],['JAP','MAN'],['SOV','MON']].forEach(([a,b])=>{ S.treaties.push({type:'alliance',a,b}); set(a,b,Math.max(S.rel[rk(a,b)],60)); });
  S.treaties.push({type:'non_aggression',a:'GER',b:'POL'});
  S.wars.push({a:'ITA',b:'ETH',since:'Oct 1935',m:2},{a:'CHI',b:'CCP',since:'1927',m:90});
  S.fronts.push({a:'ITA',d:'ETH',r:'ogd',prog:30},{a:'ITA',d:'ETH',r:'eth',prog:10});
  Object.assign(S.fort,{als:3,bur:2,sud:2,boh:1,kar:2,bel:1,swi:2,rhi:0});
  for(const c in D.CLAIMS) S.claims[c]=D.CLAIMS[c].slice();
  log('event',`1 December 1935. Italy's columns grind into Abyssinia; China bleeds in civil war; Europe holds its breath. You lead ${nm(player)}.`);
  news(`Dec 1935: Italian troops advance in Abyssinia · Chinese civil war drags on`);
  S.lastReport=null; if(window.B2Link) B2Link.newGame(); autosave(); dirty=true; renderAll(); centerOn(player);
}
function defaultBud(c){ return {fascist:0.35,communist:0.35,authoritarian:0.22,democratic:0.12}[IDEO(c)]; }
const rel=(a,b)=>a===b?100:(S.rel[rk(a,b)]??0);
const addRel=(a,b,d)=>{ if(a!==b) S.rel[rk(a,b)]=clamp(rel(a,b)+d,-100,100); };
const dateStr=()=>`${MONTHS[S.m]} ${S.y}`; const YM=()=>S.y*12+S.m;
const alive=c=>S.nat[c]&&S.nat[c].alive;
const regionsOf=c=>RIDS.filter(id=>S.owner[id]===c);
const atWar=(a,b)=>S.wars.some(w=>(w.a===a&&w.b===b)||(w.a===b&&w.b===a));
const enemiesOf=c=>S.wars.filter(w=>w.a===c||w.b===c).map(w=>w.a===c?w.b:w.a);
const hasT=(t,a,b)=>S.treaties.some(x=>x.type===t&&((x.a===a&&x.b===b)||(x.a===b&&x.b===a)));
const alliesOf=c=>S.treaties.filter(t=>t.type==='alliance'&&(t.a===c||t.b===c)).map(t=>t.a===c?t.b:t.a).filter(alive);
const guarantorsOf=c=>S.treaties.filter(t=>t.type==='guarantee'&&t.b===c).map(t=>t.a).filter(alive);
const eff=c=>S.nat[c].army*S.nat[c].q*(0.7+S.nat[c].stab/200);
const capOf=c=>{ const cap=D.N[c][7]; return S.owner[cap]===c?cap:regionsOf(c)[0]; };
function borderRegs(a,b,landOnly){ const A=landOnly?LANDADJ:ADJ; return regionsOf(b).filter(r=>[...A[r]].some(x=>S.owner[x]===a)); }
const neighbours=c=>{ const s=new Set(); regionsOf(c).forEach(r=>ADJ[r].forEach(x=>{ const o=S.owner[x]; if(o!==c) s.add(o); })); return [...s].filter(alive); };
function log(kind,text){ S.log.unshift({d:dateStr(),kind,text}); if(S.log.length>400) S.log.length=400; }
function news(t){ S.news.unshift(t); if(S.news.length>14) S.news.length=14; }
function hops(c){ // BFS distance through own territory from capital (cached per turn)
  S._hops=S._hops||{}; const key=c+S.turn+':'+regionsOf(c).length; if(S._hops[c]&&S._hops[c].k===key) return S._hops[c].d;
  const d={}, cap=capOf(c); if(cap){ d[cap]=0; const q=[cap]; while(q.length){ const r=q.shift(); for(const x of LANDADJ[r]) if(S.owner[x]===c&&d[x]==null){ d[x]=d[r]+1; q.push(x);} } }
  S._hops[c]={k:key,d}; return d; }

/* ================= WAR & COMBAT ================= */
function declareWar(a,b,motive,silentJoin){
  if(a===b||atWar(a,b)||!alive(a)||!alive(b)) return;
  S.wars.push({a,b,since:dateStr(),m:0,motive});
  S.treaties=S.treaties.filter(t=>!((t.a===a&&t.b===b)||(t.a===b&&t.b===a)));
  addRel(a,b,-50); S.tension=clamp(S.tension+(D.N[a][8]||D.N[b][8]?8:4),0,100);
  log('war',`⚔ ${nm(a)} declares war on ${nm(b)}. Motive: ${motive}.`); news(`${dateStr()}: ${nm(a).toUpperCase()} DECLARES WAR ON ${nm(b).toUpperCase()}`);
  const joiners=[...new Set(alliesOf(b).concat(guarantorsOf(b)))].filter(x=>x!==a&&!atWar(x,a)&&!alliesOf(a).includes(x));
  for(const x of joiners){ const p=x===S.player?1:(alliesOf(b).includes(x)?0.85:0.75)*(rel(x,b)>20?1:0.5); if(rnd()<p){ S.wars.push({a:x,b:a,since:dateStr(),m:0,motive:`honouring its pact with ${nm(b)}`}); addRel(x,a,-40); log('war',`⚔ ${nm(x)} joins the war against ${nm(a)}, honouring its pact with ${nm(b)}.`); news(`${nm(x)} enters the war`); } }
  // puppets follow masters
  alliesOf(a).filter(x=>['MAN','MON'].includes(x)&&!atWar(x,b)).forEach(x=>S.wars.push({a:x,b,since:dateStr(),m:0,motive:`following ${nm(a)}`}));
}
function makePeace(a,b,why){ S.wars=S.wars.filter(w=>!((w.a===a&&w.b===b)||(w.a===b&&w.b===a))); S.fronts=S.fronts.filter(f=>!((f.a===a&&f.d===b)||(f.a===b&&f.d===a))); log('peace',`🕊 ${nm(a)} and ${nm(b)} make peace${why?' — '+why:''}.`); news(`Peace between ${nm(a)} and ${nm(b)}`); }
function pickTarget(a,d,prefer){
  if(prefer&&S.owner[prefer]===d&&[...ADJ[prefer]].some(x=>S.owner[x]===a)) return prefer;
  const cand=borderRegs(a,d,false); if(!cand.length) return null;
  const hd=hops(d), land=new Set(borderRegs(a,d,true));
  const score=x=>{ const T=TERR[REG[x].t][1]+(REG[x].river?0.25:0); return T*(1+0.2*(S.fort[x]||0))*(D.N[d][7]===x?1.4:1)*(land.has(x)?1:1.7)*10+(hd[x]??20)*0.5; };
  cand.sort((x,y)=>score(x)-score(y)); return cand[0]; }
function openFront(a,d,prefer){ const ex=S.fronts.find(f=>f.a===a&&f.d===d); if(ex){ if(prefer&&prefer!==ex.r){ const t=pickTarget(a,d,prefer); if(t&&t!==ex.r){ ex.r=t; ex.prog=Math.min(ex.prog,20);} } return ex; }
  const r=pickTarget(a,d,prefer); if(!r) return null; const f={a,d,r,prog:0}; S.fronts.push(f); return f; }
function frontCalc(f){
  const a=f.a, d=f.d, r=f.r, nA=S.fronts.filter(x=>x.a===a).length, nD=Math.max(1,enemiesOf(d).length);
  const landLink=[...LANDADJ[r]].some(x=>S.owner[x]===a); const hd=hops(a); const nearest=Math.min(...[...ADJ[r]].filter(x=>S.owner[x]===a).map(x=>hd[x]??12));
  const supply=clamp(1.1-nearest*0.035,0.45,1)*(landLink?1:0.6);
  const T=TERR[REG[r].t]; const terr=T[1]+(REG[r].river?0.25:0); const fort=1+0.2*(S.fort[r]||0); const cap=(D.N[d][7]===r)?1.4:1;
  const A=eff(a)*0.8/Math.max(1,nA)*supply;
  let Dd=eff(d)*0.5/nD*terr*fort*cap*1.25;
  let help=0; enemiesOf(a).filter(x=>x!==d&&[...LANDADJ[r]].some(y=>S.owner[y]===x)).forEach(x=>help+=eff(x)*0.25/Math.max(1,enemiesOf(x).length)); Dd+=help;
  return {A, D:Dd, ratio:A/Math.max(0.3,Dd), supply, terr:T[0]+(REG[r].river?' + river':''), fort:S.fort[r]||0, help};
}
function resolveFront(f){
  if(!atWar(f.a,f.d)||!alive(f.a)||!alive(f.d)) return 'drop';
  if(S.owner[f.r]!==f.d||![...ADJ[f.r]].some(x=>S.owner[x]===f.a)){ const t=pickTarget(f.a,f.d); if(!t) return 'drop'; f.r=t; f.prog=0; }
  const c=frontCalc(f); const delta=clamp(40*(c.ratio-0.8)*(0.75+rnd()*0.5),-15,45);
  f.prog=clamp(f.prog+delta,0,100);
  const la=Math.min(S.nat[f.a].army*0.06, 0.03*c.D*(1.2/Math.sqrt(Math.max(0.2,c.ratio)))), ld=Math.min(S.nat[f.d].army*0.06, 0.03*c.A*Math.sqrt(c.ratio));
  S.nat[f.a].army=Math.max(0.5,S.nat[f.a].army-la); S.nat[f.d].army=Math.max(0.5,S.nat[f.d].army-ld);
  f.last={delta:Math.round(delta), ratio:+c.ratio.toFixed(2), la:+la.toFixed(1), ld:+ld.toFixed(1), terr:c.terr, supply:+c.supply.toFixed(2), fort:c.fort};
  if(f.prog>=100){ capture(f.a,f.r,f.d); f.prog=0; const t=pickTarget(f.a,f.d); if(!t) return 'drop'; f.r=t; }
  return 'ok';
}
function capture(a,r,d){
  S.owner[r]=a; S.flash.push(r); S.fort[r]=Math.max(0,(S.fort[r]||0)-1); S.lastCap[r]=S.turn;
  const share=S.nat[d].ind/Math.max(1,regionsOf(d).length+1)*0.6; S.nat[d].ind=Math.max(0.5,S.nat[d].ind-share); S.nat[a].ind+=share*0.5;
  S.nat[d].stab=clamp(S.nat[d].stab-6,0,100); S.nat[a].stab=clamp(S.nat[a].stab+2,0,100);
  log('border',`🏴 ${nm(a)} captures ${REG[r].name} from ${nm(d)}.`); news(`${REG[r].name} falls to ${nm(a)}`);
  checkCapitulation(d,a);
}
function checkCapitulation(d,a){
  const regs=regionsOf(d); const lostCap=S.owner[D.N[d][7]]!==d;
  if(!regs.length || (lostCap && (regs.length<=S.nat[d].start*0.6 || S.nat[d].army<2 || S.nat[d].stab<20))){
    regs.forEach(r=>{ S.owner[r]=a; S.flash.push(r); });
    S.nat[d].alive=false; S.wars=S.wars.filter(w=>w.a!==d&&w.b!==d); S.fronts=S.fronts.filter(f=>f.a!==d&&f.d!==d); S.treaties=S.treaties.filter(t=>t.a!==d&&t.b!==d);
    S.tension=clamp(S.tension+6,0,100); log('war',`☠ ${nm(d)} capitulates. Its lands pass to ${nm(a)}.`); news(`${nm(d).toUpperCase()} CAPITULATES`);
    return true; } return false;
}
function transfer(r,to,why){ const from=S.owner[r]; if(from===to) return; S.owner[r]=to; S.flash.push(r); log('border',`🏴 ${REG[r].name} passes from ${nm(from)} to ${nm(to)}${why?' — '+why:''}.`); if(!regionsOf(from).length){ S.nat[from].alive=false; S.wars=S.wars.filter(w=>w.a!==from&&w.b!==from); S.fronts=S.fronts.filter(f=>f.a!==from&&f.d!==from); S.treaties=S.treaties.filter(t=>t.a!==from&&t.b!==from); log('border',`${nm(from)} ceases to exist.`);} }

/* ================= ECONOMY ================= */
function economyTick(){
  for(const c of NAT){ const n=S.nat[c]; if(!n.alive) continue; const regs=regionsOf(c).length; const war=enemiesOf(c).length>0;
    if(c!==S.player) n.bud=clamp(defaultBud(c)+S.tension/300+(war?0.2:0),0.1,0.7);
    n.gold=clamp(n.gold + n.ind*0.9 - n.army*0.04 - (war?n.ind*0.15:0), -50, 999);
    n.mp=Math.min(n.mp + 0.8 + regs*0.25 + n.ind*0.05, 60+regs*20);
    let g=n.ind*n.bud*0.09*(n.gold<0?0.4:1); const need=g*6; if(n.mp<need) g=n.mp/6; n.army+=g; n.mp-=g*6;
    const growth=(n.ind*(1-n.bud)*0.005+0.01)*(n.stab<35?0.5:1); n.ind+=growth;
    n.stab=clamp(n.stab+(war?-1.2:0)+(n.stab<60?0.6:-0.3)+(n.gold<0?-2:0),0,100);
    if(c==='GER'&&S.y>=1936) n.q=Math.min(1.3,n.q+0.002); }
}

/* ================= AI BEHAVIOUR ================= */
const WAR_START={GER:1938*12+8, ITA:1939*12+3, JAP:1937*12+6, SOV:1939*12+8, HUN:1939*12, BUL:1940*12};
function coalition(c,vs){ return [c,...alliesOf(c),...guarantorsOf(c)].filter((x,i,a)=>a.indexOf(x)===i&&alive(x)&&x!==vs&&!atWar(x,vs)); }
function aiWarCheck(){
  if(rnd()>0.6) return; // at most one deliberate AI war per month, not every month
  const ais=NAT.filter(c=>alive(c)&&c!==S.player&&IDEO(c)!=='democratic'&&YM()>=(WAR_START[c]??1941*12));
  const opts=[];
  for(const a of ais){ if(enemiesOf(a).length>=2) continue;
    for(const b of neighbours(a)){ if(atWar(a,b)||hasT('non_aggression',a,b)||hasT('alliance',a,b)) continue;
      const claimed=(S.claims[a]||[]).filter(r=>S.owner[r]===b);
      let motive=null, w=0;
      if(claimed.length){ motive=`claim on ${claimed.slice(0,2).map(r=>REG[r].name).join(' & ')}`; w=1; }
      else if(((IDEO(a)==='fascist'&&IDEO(b)==='communist')||(IDEO(a)==='communist'&&IDEO(b)==='fascist'))&&S.tension>=70){ motive='ideological crusade'; w=0.6; }
      else if(enemiesOf(b).length&&eff(a)>2.5*eff(b)&&S.tension>=55&&IDEO(a)==='fascist'){ motive=`opportunity: ${nm(b)} is already fighting ${nm(enemiesOf(b)[0])}`; w=0.5; }
      if(!motive) continue;
      const def=coalition(b,a).reduce((s,x)=>s+eff(x)*(x===b?1:0.45),0), att=eff(a)+alliesOf(a).filter(x=>!atWar(x,b)).reduce((s,x)=>s+eff(x)*0.3,0);
      const ratio=att/Math.max(0.5,def); const need=IDEO(a)==='fascist'?1.4:1.8;
      if(ratio<need||S.tension<40) continue;
      const p=w*(0.06+S.tension/500)*(D.N[a][8]?1:0.5);
      opts.push({a,b,motive:`${motive}; strength ratio ${ratio.toFixed(1)}:1`,p}); } }
  for(const o of opts){ if(rnd()<o.p){ declareWar(o.a,o.b,o.motive); return; } }
}
function aiFronts(){
  for(const w of S.wars) for(const [a,d] of [[w.a,w.b],[w.b,w.a]]){ if(a===S.player||!alive(a)||!alive(d)) continue;
    const max=1+Math.floor(S.nat[a].army/45); if(S.fronts.filter(f=>f.a===a).length>=max) continue; if(S.fronts.some(f=>f.a===a&&f.d===d)) continue;
    const t=pickTarget(a,d); if(!t) continue; const c=frontCalc({a,d,r:t}); if(c.ratio>0.85||IDEO(a)==='fascist') S.fronts.push({a,d,r:t,prog:0}); }
}
function aiDiplomacy(){
  for(let k=0;k<3;k++){ const a=pick(NAT.filter(alive)), b=pick(neighbours(a).length?neighbours(a):NAT.filter(alive)); if(!b||a===b) continue; addRel(a,b,Math.round((rnd()-0.5)*6+ideoAff(a,b)/10)); }
  for(const w of S.wars.slice()){ w.m++; if(w.a!==S.player&&w.b!==S.player&&w.m>14&&!S.fronts.some(f=>(f.a===w.a||f.a===w.b)&&f.prog>50)&&rnd()<0.08) makePeace(w.a,w.b,'exhaustion'); }
  NAT.filter(c=>alive(c)&&c!==S.player).forEach(c=>{ if(rnd()<0.1) addRel(S.player,c,Math.round((rnd()-0.5)*6+ideoAff(S.player,c)/12)); });
  S.tension=clamp(S.tension+(S.wars.length>2?0.6:-0.4),0,100);
}

/* ================= HISTORICAL EVENTS & DECISIONS ================= */
const ym=(y,m)=>y*12+m-1;
const borders=(a,b)=>borderRegs(a,b,false).length>0;
const EVENTS=[
 {id:'sanctions',at:ym(1935,12),who:'UK',title:'The Abyssinia Crisis',text:'Italy is gassing its way toward Addis Ababa. The League of Nations asks Britain to lead oil sanctions against Mussolini.',
  opts:[{t:'Impose oil sanctions',w:.3,fx:()=>{S.nat.ITA.ind-=1.5;addRel('UK','ITA',-25);addRel('FRA','ITA',-10);S.nat.ETH.army+=3;S.tension+=3;}},{t:'Hoare–Laval deal: let Italy have the Ogaden',w:.7,fx:()=>{addRel('UK','ITA',5);S.nat.UK.stab-=5;if(S.owner.ogd==='ETH')transfer('ogd','ITA','Hoare–Laval deal');}}]},
 {id:'rhine',at:ym(1936,3),who:'GER',cond:()=>S.owner.rhi==='GER',title:'The Rhineland',text:'The Rhineland is German soil but demilitarised by treaty. The generals are nervous; they would retreat if France moved.',
  opts:[{t:'March into the Rhineland',w:.85,fx:()=>{S.tension+=6;S.nat.GER.stab+=5;addRel('GER','FRA',-15);S.fort.rhi=(S.fort.rhi||0)+1;news('German troops enter the Rhineland');}},{t:'Not yet — keep the treaty',w:.15,fx:()=>{S.nat.GER.stab-=4;}}]},
 {id:'rhine_fr',at:ym(1936,3),after:['rhine',0],who:'FRA',title:'German Boots on the Rhine',text:'Three German battalions have crossed the Rhine bridges. Our army could throw them back — but Britain will not help, and an election looms.',
  opts:[{t:'Protest at the League, do nothing',w:.85,fx:()=>{S.nat.FRA.stab-=5;S.tension+=2;}},{t:'Mobilize and march!',w:.15,fx:()=>declareWar('FRA','GER','enforce the Versailles treaty')}]},
 {id:'scw',at:ym(1936,7),who:'ESP',cond:()=>alive('ESP')&&S.owner.and==='ESP',title:'The Generals Revolt',text:'Army garrisons in Morocco and the south rise against the Republic. Spain splits in two.',
  opts:[{t:'Arm the workers\' militias',w:.6,fx:()=>{spainSplit();S.nat.ESP.army+=5;S.nat.ESP.stab-=8;}},{t:'Appeal to France and the USSR',w:.4,fx:()=>{spainSplit();addRel('ESP','FRA',15);addRel('ESP','SOV',15);S.nat.ESP.army+=2;}}]},
 {id:'scw_aid',at:ym(1936,8),after:['scw',null],who:'PLAYERMAJOR',cond:()=>alive('NSP')&&atWar('NSP','ESP'),title:'Intervention in Spain?',text:'Both Spanish sides beg for guns, planes and volunteers. Spain is a rehearsal for the larger war.',
  opts:[{t:'Aid the Nationalists',w:0,fx:c=>{S.nat.NSP.army+=4;S.nat[c].gold-=20;addRel(c,'NSP',20);addRel(c,'ESP',-20);}},{t:'Aid the Republic',w:0,fx:c=>{S.nat.ESP.army+=4;S.nat[c].gold-=20;addRel(c,'ESP',20);addRel(c,'NSP',-20);}},{t:'Non-intervention',w:0,fx:()=>{}}],
  ai:()=>{ S.nat.NSP.army+=6; S.nat.ESP.army+=3; news('German & Italian planes fly for Franco; Soviet tanks reach Madrid'); }},
 {id:'axis',at:ym(1936,10),who:'ITA',cond:()=>alive('GER')&&alive('ITA')&&rel('GER','ITA')>0&&!atWar('GER','ITA'),title:'The Rome–Berlin Axis',text:'Berlin proposes an axis around which Europe will turn.',
  opts:[{t:'Join the Axis',w:.75,fx:()=>{S.treaties.push({type:'alliance',a:'GER',b:'ITA'});addRel('GER','ITA',25);S.tension+=4;news('Rome–Berlin Axis proclaimed');}},{t:'Stay independent',w:.25,fx:()=>addRel('GER','ITA',-10)}]},
 {id:'acp',at:ym(1936,11),who:'JAP',cond:()=>alive('GER')&&alive('JAP'),title:'The Anti-Comintern Pact',text:'Germany invites Japan to stand together against world communism.',
  opts:[{t:'Sign the pact',w:.8,fx:()=>{S.treaties.push({type:'non_aggression',a:'GER',b:'JAP'});addRel('GER','JAP',25);addRel('JAP','SOV',-15);addRel('GER','SOV',-10);S.tension+=3;}},{t:'Refuse',w:.2,fx:()=>{}}]},
 {id:'xian',at:ym(1936,12),who:'CHI',cond:()=>alive('CHI')&&alive('CCP')&&atWar('CHI','CCP'),title:'The Xi\'an Incident',text:'Your own generals have kidnapped you at Xi\'an. They demand a united front with the Communists against Japan.',
  opts:[{t:'Agree to the Second United Front',w:.8,fx:()=>{makePeace('CHI','CCP','united front against Japan');S.treaties.push({type:'alliance',a:'CHI',b:'CCP'});addRel('CHI','JAP',-15);}},{t:'Refuse — continue the purge',w:.2,fx:()=>{S.nat.CHI.stab-=10;}}]},
 {id:'mpb',at:ym(1937,7),who:'JAP',cond:()=>alive('JAP')&&alive('CHI')&&!atWar('JAP','CHI'),title:'Marco Polo Bridge',text:'Shots in the dark near Peiping. The Kwantung Army wants a full war; the cabinet hesitates.',
  opts:[{t:'Full-scale invasion of China',w:.85,fx:()=>declareWar('JAP','CHI','Marco Polo Bridge incident')},{t:'Local settlement',w:.15,fx:()=>{S.tension-=3;S.nat.JAP.stab-=5;}}]},
 {id:'anschluss',at:ym(1938,3),who:'GER',cond:()=>alive('AUT')&&alive('GER')&&borders('GER','AUT'),title:'Anschluss',text:'Austrian Nazis are ready. One telegram and the Wehrmacht crosses the Inn.',
  opts:[{t:'Demand union with Austria',w:.9,fx:()=>{}},{t:'Not yet',w:.1,fx:()=>{}}]},
 {id:'anschluss_aut',at:ym(1938,3),after:['anschluss',0],who:'AUT',title:'Berlin Demands Union',text:'Hitler demands Austria accept union with the Reich — or be invaded.',
  opts:[{t:'Accept union',w:.85,fx:()=>{regionsOf('AUT').forEach(r=>transfer(r,'GER','Anschluss'));S.tension+=8;addRel('GER','UK',-10);addRel('GER','FRA',-10);news('ANSCHLUSS: Austria absorbed into the Reich');}},{t:'Resist!',w:.15,fx:()=>declareWar('GER','AUT','Anschluss refused')}]},
 {id:'munich',at:ym(1938,9),who:'GER',cond:()=>alive('CZE')&&S.owner.sud==='CZE'&&[...ADJ.sud].some(x=>S.owner[x]==='GER'),title:'The Sudeten Crisis',text:'Three million Sudeten Germans; the Czech fortress line runs through their hills.',
  opts:[{t:'Demand the Sudetenland',w:.9,fx:()=>{S.tension+=5;}},{t:'Back down',w:.1,fx:()=>{}}]},
 {id:'munich_w',at:ym(1938,9),after:['munich',0],who:'UKFRA',title:'Munich',text:'Germany demands the Sudetenland. Czechoslovakia has an army of 35 divisions and a fortress line. Will you stand with Prague?',
  opts:[{t:'Appease — "peace for our time"',w:.75,fx:c=>{addRel(c,'CZE',-25);}},{t:'Stand firm: guarantee Czechoslovakia',w:.25,fx:c=>{['UK','FRA'].forEach(x=>{ if(alive(x)) S.treaties.push({type:'guarantee',a:x,b:'CZE'}); });addRel(c,'GER',-20);}}]},
 {id:'munich_cze',at:ym(1938,9),after:['munich',0],who:'CZE',title:'Prague Decides',text:()=>S.ev.munich_w===0?'London and Paris have sold you out at Munich. Cede the Sudetenland — or fight alone?':'The Western powers stand with you. Hitler demands the Sudetenland anyway.',
  opts:[{t:'Cede the Sudetenland',w:.8,fx:()=>{transfer('sud','GER','Munich Agreement');S.nat.CZE.stab-=15;news('MUNICH: Sudetenland handed to Germany');}},{t:'Refuse — man the fortress line',w:.2,fx:()=>declareWar('GER','CZE','Sudeten claim rejected')}]},
 {id:'albania',at:ym(1939,4),who:'ITA',cond:()=>alive('ALB')&&alive('ITA'),title:'Albania',text:'King Zog is weak and in debt to Rome. A landing at Durazzo would take days.',
  opts:[{t:'Invade Albania',w:.75,fx:()=>{regionsOf('ALB').forEach(r=>transfer(r,'ITA','Italian invasion'));S.tension+=4;}},{t:'Leave it',w:.25,fx:()=>{}}]},
 {id:'danzig',at:ym(1939,3),who:'GER',cond:()=>alive('POL')&&alive('GER')&&borders('GER','POL'),title:'Danzig and the Corridor',text:'Danzig is German in all but name. Poland\'s corridor cuts East Prussia off from the Reich.',
  opts:[{t:'Demand Danzig and an extraterritorial road',w:.9,fx:()=>{S.tension+=5;}},{t:'Leave Poland alone',w:.1,fx:()=>{S.claims.GER=(S.claims.GER||[]).filter(r=>!['dnz','poz','pom'].includes(r));}}]},
 {id:'danzig_pol',at:ym(1939,3),after:['danzig',0],who:'POL',title:'Berlin Demands Danzig',text:'Germany demands Danzig and a road across the Corridor. Britain and France hint at a guarantee.',
  opts:[{t:'Refuse — Poland will fight',w:.85,fx:()=>{['UK','FRA'].forEach(x=>{ if(alive(x)&&x!==S.player) S.treaties.push({type:'guarantee',a:x,b:'POL'}); });addRel('GER','POL',-30);news('Britain and France guarantee Poland');}},{t:'Cede Danzig',w:.15,fx:()=>{if(alive('DNZ'))regionsOf('DNZ').forEach(r=>transfer(r,'GER','Danzig ceded'));S.nat.POL.stab-=15;}}]},
 {id:'mr',at:ym(1939,8),who:'SOV',cond:()=>alive('GER')&&alive('SOV')&&!atWar('GER','SOV'),title:'Ribbentrop Flies to Moscow',text:'Germany offers a non-aggression pact — with a secret protocol dividing Eastern Europe.',
  opts:[{t:'Sign the Molotov–Ribbentrop Pact',w:.75,fx:()=>{S.treaties.push({type:'non_aggression',a:'GER',b:'SOV'});S.claims.SOV=[...new Set((S.claims.SOV||[]).concat(['est','lat','lit','wil','pol','lwo','bes','kar']))];S.claims.GER=[...new Set((S.claims.GER||[]).concat(['war','poz','kra','dnz']))];S.tension+=10;news('NAZI–SOVIET PACT STUNS THE WORLD');}},{t:'Refuse; court London and Paris',w:.25,fx:()=>{addRel('SOV','UK',25);addRel('SOV','FRA',25);}}]},
 {id:'weiss',at:ym(1939,9),after:['danzig_pol',0],who:'GER',cond:()=>alive('POL')&&borders('GER','POL')&&!atWar('GER','POL'),title:'Case White',text:'Poland refused. The army is ready on three sides of the Polish frontier.',
  opts:[{t:'Invade Poland',w:.85,fx:()=>declareWar('GER','POL','Danzig and the Polish Corridor')},{t:'Stand down',w:.15,fx:()=>{S.tension-=4;}}]},
 {id:'winter',at:ym(1939,11),who:'FIN',cond:()=>alive('FIN')&&alive('SOV')&&S.owner.kar==='FIN'&&!atWar('SOV','GER'),title:'Stalin Demands Karelia',text:'Moscow demands the Karelian Isthmus to protect Leningrad.',
  opts:[{t:'Refuse — man the Mannerheim Line',w:.85,fx:()=>declareWar('SOV','FIN','Karelian claim')},{t:'Cede Karelia',w:.15,fx:()=>transfer('kar','SOV','ceded under threat')}]},
 {id:'barbarossa',at:ym(1941,6),who:'GER',cond:()=>alive('GER')&&alive('SOV')&&borders('GER','SOV')&&!atWar('GER','SOV'),title:'Operation Barbarossa',text:'The pact with Stalin was only ever a pause. The generals say the Red Army is rotten.',
  opts:[{t:'Invade the Soviet Union',w:.7,fx:()=>declareWar('GER','SOV','living space in the East')},{t:'Keep the pact',w:.3,fx:()=>{}}]},
 {id:'pearl',at:ym(1941,12),who:'JAP',cond:()=>alive('JAP')&&alive('USA')&&atWar('JAP','CHI')&&!atWar('JAP','USA'),title:'Southern Operation',text:'The American oil embargo bites. The Navy proposes striking Pearl Harbor and seizing the oil of the Indies.',
  opts:[{t:'Strike the Americans and the colonies',w:.6,fx:()=>{declareWar('JAP','USA','oil embargo; Southern Operation');if(alive('NED'))declareWar('JAP','NED','oil of the Indies');}},{t:'Negotiate',w:.4,fx:()=>{S.nat.JAP.ind-=1;}}]},
];
function spainSplit(){ S.nat.NSP.alive=true; S.nat.NSP.army=10; S.nat.NSP.start=5; S.nat.NSP.stab=60; ['and','gal','smo2','rio'].forEach(r=>{ if(S.owner[r]==='ESP'){ S.owner[r]='NSP'; S.flash.push(r);} }); S.nat.NSP.start=regionsOf('NSP').length;
  NAT.forEach(c=>{ if(c!=='NSP') S.rel[rk(c,'NSP')]=clamp(ideoAff(c,'NSP'),-100,100); }); declareWar('NSP','ESP','Nationalist uprising'); news('CIVIL WAR IN SPAIN'); }
function chooserOf(e){ if(e.who==='PLAYERMAJOR') return D.N[S.player][8]?S.player:null; if(e.who==='UKFRA') return ['UK','FRA'].includes(S.player)?S.player:'UK'; return e.who; }
async function runEvents(){
  for(const e of EVENTS){ if(S.ev[e.id]!==undefined) continue; if(YM()<e.at||YM()>e.at+6) continue;
    if(e.after){ const v=S.ev[e.after[0]]; if(v===undefined||(e.after[1]!==null&&v!==e.after[1])) continue; }
    if(e.cond&&!e.cond()) continue; const who=chooserOf(e);
    if(who===null){ S.ev[e.id]=-1; if(e.ai) e.ai(); continue; }
    if(!alive(who)) { S.ev[e.id]=-1; continue; }
    let idx;
    if(who===S.player){ idx=await askDecision(e); }
    else { const tot=e.opts.reduce((s,o)=>s+o.w,0); let r=rnd()*tot; idx=e.opts.findIndex(o=>(r-=o.w)<0); if(idx<0) idx=0; }
    S.ev[e.id]=idx; const o=e.opts[idx]; o.fx(who); S.tension=clamp(S.tension,0,100);
    log('decision',`📜 ${e.title}: ${nm(who)} chooses "${o.t}".`); news(`${e.title}: ${nm(who)} — ${o.t}`);
  }
}

/* ================= INTENT PARSER ================= */
const NAT_ALIAS={GER:'germany german germans reich third reich nazi nazis hitler wehrmacht',UK:'britain british england english uk united kingdom brits chamberlain baldwin churchill',FRA:'france french frenchmen',ITA:'italy italian italians mussolini duce',
 SOV:'soviet soviets ussr russia russian russians stalin red army',JAP:'japan japanese nippon hirohito',USA:'america american americans usa united states roosevelt yanks',CHI:'china chinese chiang kuomintang kmt',CCP:'chinese communists ccp mao',
 POL:'poland polish poles',CZE:'czechoslovakia czech czechs slovak',AUT:'austria austrian austrians',ESP:'spain spanish spaniards spanish republic',NSP:'franco nationalist spain falangists',MAN:'manchukuo manchuria puyi',ETH:'ethiopia ethiopian abyssinia abyssinian haile selassie',
 HUN:'hungary hungarian hungarians',ROM:'romania romanian romanians rumania',YUG:'yugoslavia yugoslav yugoslavs serbs',BUL:'bulgaria bulgarian bulgarians',GRE:'greece greek greeks',TUR:'turkey turkish turks ataturk',FIN:'finland finnish finns',SWE:'sweden swedish swedes',NOR:'norway norwegian norwegians',DEN:'denmark danish danes',
 NED:'netherlands dutch holland',BEL:'belgium belgian belgians',SWI:'switzerland swiss',POR:'portugal portuguese',IRE:'ireland irish',LIT:'lithuania lithuanian',LAT:'latvia latvian',EST:'estonia estonian',ALB:'albania albanian',LUX:'luxembourg',DNZ:'free city',
 MEX:'mexico mexican',BRA:'brazil brazilian',ARG:'argentina argentine argentinian',CAN:'canada canadian canadians',AUS:'australia australian australians aussies',NZL:'new zealand kiwis',SAF:'south africa south african',EGY:'egypt egyptian',IRN:'iran iranian persia persian',
 IRQ:'iraq iraqi',SAU:'saudi arabia saudi saudis',AFG:'afghanistan afghan',SIA:'siam siamese thailand thai',MON:'mongolia mongolian',TIB:'tibet tibetan',CUB:'cuba cuban',CHL:'chile chilean',PRU:'peru peruvian',COL:'colombia colombian',VEN:'venezuela venezuelan',BOL:'bolivia bolivian',PAR:'paraguay paraguayan',URU:'uruguay uruguayan',ECU:'ecuador',
 SHX:'shanxi clique yan xishan',GXC:'guangxi clique',YUN:'yunnan clique',SZC:'sichuan clique',XIN:'xinjiang',NEP:'nepal',YEM:'yemen',LBR:'liberia',CAM:'central america guatemala',DOM:'hispaniola haiti dominican'};
const REG_ALIAS={dnz:'danzig gdansk',sud:'sudetenland sudeten',rhi:'rhineland',saa:'saar saarland',als:'alsace lorraine maginot',mem:'memel klaipeda',poz:'corridor polish corridor poznan posen',sil:'silesia',boh:'prague bohemia',vie:'vienna',war:'warsaw',ber:'berlin',bav:'munich bavaria',par:'paris',lon:'london',rom:'rome',pie:'milan turin',mos:'moscow',len:'leningrad',sta:'stalingrad',kie:'kiev ukraine',ode:'odessa',cri:'crimea sevastopol',cau:'caucasus',tra:'baku georgia transcaucasia',blr:'minsk belarus byelorussia',bes:'bessarabia',trn:'transylvania',kar:'karelia mannerheim',tok:'tokyo',kor:'korea seoul',tai:'taiwan formosa',sha:'shanghai',bjg:'peking peiping beijing',nan:'nanking nanjing',del:'india delhi',ben:'calcutta bengal',bom:'bombay',brm:'burma rangoon',mal:'malaya singapore',gdg:'canton hong kong guangdong',egy:'suez cairo',and:'gibraltar seville',tnk:'hanoi tonkin indochina',coc:'saigon',luz:'philippines manila luzon',jav:'java batavia',sum:'sumatra',lib:'libya tripoli',tun:'tunisia tunis',alg:'algeria algiers',mor:'morocco casablanca',syr:'syria damascus',pal:'palestine jerusalem',aes:'sudan khartoum',bcg:'congo',mkd:'mukden',hsk:'hsinking',eth:'addis ababa',ist:'istanbul constantinople bosphorus',ana:'ankara',ath:'athens',bud:'budapest',hun:'budapest',ser:'belgrade',bul:'sofia',wal2:'bucharest',hel:'helsinki',sto:'stockholm',osl:'oslo',dzl:'copenhagen',ned:'amsterdam',bel:'brussels',mad:'madrid',por:'lisbon',ire:'dublin',wdc:'washington',nyc:'new york',cal:'california hollywood',ala:'alaska',tex:'texas',que:'quebec montreal',ont:'ontario toronto ottawa',nsw:'sydney',grl:'greenland',ice:'iceland',nar:'narvik',kyu:'kyushu',hok:'hokkaido',kft:'sakhalin karafuto'};
const ALIAS=[]; // [regex, nation|null, region|null]
(function(){ const add=(words,n,r)=>words.split(/\s{1}(?=[a-z])/).length&&0; 
  const push=(phrase,n,r)=>{ if(phrase.length<3&&phrase!=='uk') return; ALIAS.push({re:new RegExp('\\b'+phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:s|\'s)?\\b','i'),n,r,len:phrase.length}); };
  for(const c of NAT){ push(nm(c).toLowerCase(),c,null); const a=NAT_ALIAS[c]; if(a){ const multi=['third reich','united kingdom','red army','united states','chinese communists','spanish republic','nationalist spain','haile selassie','new zealand','south africa','south african','saudi arabia','central america','free city','yan xishan','shanxi clique','guangxi clique','yunnan clique','sichuan clique'];
    let rest=a; multi.forEach(m=>{ if(rest.includes(m)){ push(m,c,null); rest=rest.replace(m,' '); } }); rest.split(/\s+/).filter(Boolean).forEach(w=>push(w,c,null)); } }
  for(const id of RIDS){ push(REG[id].name.toLowerCase().replace(/\s*\(.*\)/,''),null,id); }
  for(const id in REG_ALIAS){ const a=REG_ALIAS[id]; const multi=['polish corridor','hong kong','addis ababa','new york']; let rest=a; multi.forEach(m=>{ if(rest.includes(m)){ push(m,null,id); rest=rest.replace(m,' ');} }); rest.split(/\s+/).filter(Boolean).forEach(w=>push(w,null,id)); }
  ALIAS.sort((x,y)=>y.len-x.len);
})();
const INTENTS=[
 ['peace',/\b(peace|armistice|cease-?fire|truce|end (the|this|our) war|stop (the )?(war|fighting)|surrender)\b/],
 ['nap',/\b(non-?aggression|nap|neutrality pact|pact of neutrality)\b/],
 ['guarantee',/\b(guarantee|protect|safeguard|defend (them|their|its|the independence)|independence of)\b/],
 ['alliance',/\b(ally|allies|alliance|allied|join (us|our|forces|the war)|axis|coalition|military pact|defensive pact|faction|side with)\b/],
 ['embargo',/\b(embargo|sanction|sanctions|blockade|boycott|cut (off )?(trade|oil))\b/],
 ['demand',/\b(demand|ultimatum|annex|annexe|cede|hand over|give (us|me|back)|take back|reclaim|return .{0,20} to us|claim)\b/],
 ['attack',/\b(invade|invasion|attack|war (on|with|against)|declare war|conquer|strike|bomb|blitz|blitzkrieg|march (on|into|to)|occupy|assault|crush|destroy|seize|take|offensive|push into|liberate)\b/],
 ['spy',/\b(spy|spies|espionage|sabotage|infiltrat\w*|agents?|intel\w*|assassinat\w*|coup|subvert|steal (plans|secrets))\b/],
 ['propaganda',/\b(propaganda|radio|leaflets?|newspapers?|speech|rally|rallies|posters?|morale|inspire|nationalism)\b/],
 ['mobilize',/\b(mobili[sz]\w*|conscript\w*|draft|call up|total war)\b/],
 ['build_industry',/\b(factor(y|ies)|industr\w*|five-?year|econom\w*|infrastructure|railways?|steel mills?|build (roads|plants|refineries)|civilian)\b/],
 ['build_army',/\b(build (up )?(the |my |our )?(army|military|tanks|planes|divisions|navy|fleet|air ?force)|more (tanks|troops|soldiers|planes|divisions|ships)|recruit\w*|train (troops|soldiers|army)|rearm\w*|(grow|expand|strengthen) (the |my |our )?(army|military))\b/],
 ['fortify',/\b(fortif\w*|bunkers?|defen[cs]e lines?|wall|entrench\w*|dig in|forts?|defend (my|our|the) (border|frontier|country|homeland))\b/],
 ['trade',/\b(trade|commerce|exports?|imports?|buy|sell|deal|loan|oil|iron|coal|steel|rubber|economic (deal|ties))\b/],
 ['budget',/\b(budget|spending|spend more on|military spending|war economy)\b/],
 ['insult',/\b(insult|threaten|denounce|condemn|mock|humiliate)\b/],
 ['talk',/\b(talk|negotiat\w*|diplomac\w*|befriend|friend\w*|improve relations|envoy|ambassador|meet|visit|praise|gift|charm|court)\b/],
 ['advisor',/\b(advice|advise|advisor|what should|help me|suggest|recommend|briefing)\b/],
];
function detectTargets(text){ const found=[]; for(const a of ALIAS){ const m=a.re.exec(text); if(m&&!found.some(f=>m.index<f.end&&m.index+m[0].length>f.start)) found.push({start:m.index,end:m.index+m[0].length,n:a.n||S.owner[a.r],r:a.r,word:m[0]}); } return found.sort((x,y)=>x.start-y.start); }
function parseIntent(text, fallbackTarget){
  const t=' '+text.toLowerCase().replace(/[’']/g,"'")+' ';
  let intent=null; for(const [k,re] of INTENTS){ if(re.test(t)){ intent=k; break; } }
  if(intent==='attack'&&/\btake back\b|\breclaim\b/.test(t)) intent='demand';
  const tg=detectTargets(t); const foreign=tg.filter(x=>x.n&&x.n!==S.player&&alive(x.n));
  let target=null, region=null;
  const own=tg.find(x=>x.n===S.player&&x.r);
  if(foreign.length){ target=foreign[0].n; region=foreign.find(x=>x.r)?.r||null; if(region&&S.owner[region]!==target) target=S.owner[region]; }
  else if(['fortify','propaganda','mobilize','build_army','build_industry','budget'].includes(intent)) { target=S.player; region=own?own.r:null; }
  else target=fallbackTarget;
  const pct=(t.match(/(\d{1,2})\s*%/)||[])[1];
  return {intent, target, region, pct:pct?+pct:null, mentions:tg.map(x=>x.word)};
}

/* ================= PLAYER ACTIONS ================= */
const P=()=>S.player;
function cost(g){ const n=S.nat[P()]; if(n.gold<g) return `Treasury only has ${Math.floor(n.gold)} gold; this costs ${g}. Raise industry or cut the army budget.`; n.gold-=g; return null; }
const V=(...a)=>pick(a);
function act(kind,T,R,text){
  const p=P(), pn=nm(p), tn=T?nm(T):'', you=S.nat[p];
  const fail=(msg)=>({ok:false,narr:msg});
  if(T&&!alive(T)) return fail(`${tn} no longer exists.`);
  const selfOnly=['mobilize','build_army','build_industry','budget'];
  if(!selfOnly.includes(kind)&&kind!=='fortify'&&kind!=='propaganda'&&kind!=='advisor'&&T===p) return fail(`That order needs a foreign target. Tap another country, or name one, e.g. "${kind==='attack'?'Invade Poland':'Ally with Italy'}".`);
  switch(kind){
  case 'attack':{
    if(!T) return fail('Attack whom? Name a country, e.g. "Invade Poland".');
    if(hasT('alliance',p,T)) return fail(`${tn} is your ally. Break the alliance first (insult or denounce them).`);
    const reach=pickTarget(p,T,R);
    let narr='';
    if(!atWar(p,T)){ declareWar(p,T,text?`"${text.slice(0,60)}"`:'your direct order');
      narr=V(`Sirens wail across ${REG[capOf(p)].name}. ${pn} is at war with ${tn}.`,`The ultimatum expires at dawn. ${pn} declares war on ${tn}.`,`Your signature is still wet on the order: war with ${tn}.`)+' '; }
    if(!reach){ return {ok:true,narr:narr+`But there is no common border or sea lane — your armies cannot reach ${tn} yet. Conquer a neighbour of theirs, or ally with someone who borders them.`}; }
    const f=openFront(p,T,reach); const c=frontCalc(f);
    narr+=`Offensive ordered into ${REG[f.r].name} (${c.terr}${c.fort?`, forts ${c.fort}`:''}). Strength ratio ${c.ratio.toFixed(2)}:1, supply ${Math.round(c.supply*100)}%. `+(c.ratio<0.8?`Your generals warn this attack will likely fail.`:c.ratio<1.3?`Expect a grinding, multi-month fight.`:`The enemy line looks brittle.`);
    return {ok:true,narr}; }
  case 'peace':{
    if(!atWar(p,T)) return fail(`You are not at war with ${tn}.`);
    const mine=RIDS.filter(r=>S.owner[r]===p&&REG[r].home===T).length, theirs=RIDS.filter(r=>S.owner[r]===T&&REG[r].home===p).length;
    const score=(mine-theirs)/Math.max(1,S.nat[T].start)*100 + (eff(p)-eff(T))/Math.max(1,eff(T))*20 + (100-S.nat[T].stab)/3;
    if(score>15||rnd()<0.15){ makePeace(p,T,'negotiated'); return {ok:true,narr:`White flags over the trenches. ${tn} signs an armistice. You keep what you hold.`}; }
    addRel(p,T,3); return {ok:true,narr:`${tn} rejects your peace feelers — they think they are winning (war score ${Math.round(score)}).`}; }
  case 'alliance':{
    if(atWar(p,T)) return fail(`You are at war with ${tn}. Make peace first.`);
    if(hasT('alliance',p,T)) return fail(`You are already allied with ${tn}.`);
    const r0=rel(p,T); const enemyLink=enemiesOf(p).some(e=>hasT('alliance',T,e));
    if(r0>=55&&ideoAff(p,T)>-20&&!enemyLink){ S.treaties.push({type:'alliance',a:p,b:T}); addRel(p,T,10); S.tension+=2; return {ok:true,narr:`In a wood-panelled room, ${pn} and ${tn} sign a military alliance. An attack on one is an attack on both.`}; }
    addRel(p,T,4); return {ok:true,narr:`${tn} declines. ${r0<55?`Relations (${r0}) are not yet warm enough — they need 55+.`:''} ${ideoAff(p,T)<=-20?'Their regime distrusts yours on principle.':''} ${enemyLink?'They are allied with your enemy.':''} (+4 relations for trying)`}; }
  case 'nap':{
    if(atWar(p,T)) return fail(`You are at war with ${tn}.`);
    if(hasT('non_aggression',p,T)) return fail(`A non-aggression pact with ${tn} already exists.`);
    if(rel(p,T)>=5||eff(p)>eff(T)*1.5){ S.treaties.push({type:'non_aggression',a:p,b:T}); addRel(p,T,8); return {ok:true,narr:`${pn} and ${tn} sign a ten-year non-aggression pact. Neither believes it will last ten years.`}; }
    addRel(p,T,3); return {ok:true,narr:`${tn} refuses a pact (relations ${rel(p,T)}; they want at least 5).`}; }
  case 'guarantee':{
    if(hasT('guarantee',p,T)) return fail(`You already guarantee ${tn}.`);
    S.treaties.push({type:'guarantee',a:p,b:T}); addRel(p,T,15); const foes=NAT.filter(x=>alive(x)&&(S.claims[x]||[]).some(r=>S.owner[r]===T)); foes.forEach(x=>addRel(p,x,-12));
    return {ok:true,narr:`You publicly guarantee the independence of ${tn}. If anyone attacks them, you go to war.${foes.length?` ${foes.map(nm).join(', ')} take${foes.length>1?'':'s'} this as a provocation.`:''}`}; }
  case 'talk':{
    const e=cost(5); if(e) return fail(e);
    const g=Math.round(5+rnd()*9+ideoAff(p,T)/5); addRel(p,T,g);
    return {ok:true,narr:V(`Your ambassador shares brandy and maps with ${tn}'s foreign minister.`,`Envoys exchange gifts and veiled threats in ${REG[capOf(T)].name}.`,`A state visit: brass bands, cold smiles, warm toasts.`)+` Relations ${g>=0?'+':''}${g} → ${rel(p,T)}.`}; }
  case 'insult':{ addRel(p,T,-18); you.stab=clamp(you.stab+3,0,100); S.treaties=S.treaties.filter(t=>!(t.type==='alliance'&&((t.a===p&&t.b===T)||(t.a===T&&t.b===p))));
    return {ok:true,narr:`You denounce ${tn} on the radio. Crowds cheer at home (+3 stability); relations crash to ${rel(p,T)}.`}; }
  case 'trade':{
    if(atWar(p,T)) return fail(`You can't trade with an enemy.`);
    if(hasT('embargo',T,p)) return fail(`${tn} is under embargo.`);
    const gain=Math.round(5+S.nat[T].ind*0.6); you.gold+=gain; you.ind+=0.3; S.nat[T].ind+=0.2; addRel(p,T,6); if(!hasT('trade',p,T)) S.treaties.push({type:'trade',a:p,b:T});
    return {ok:true,narr:V(`Freight trains of coal and iron ore roll between ${pn} and ${tn}.`,`Tankers and freighters sail; ${tn}'s raw materials feed your furnaces.`)+` +${gain} gold, +0.3 industry, relations +6.`}; }
  case 'embargo':{
    const e=cost(5); if(e) return fail(e);
    S.nat[T].ind=Math.max(0.5,S.nat[T].ind-0.6); S.nat[T].stab-=3; addRel(p,T,-15); S.treaties=S.treaties.filter(t=>!(t.type==='trade'&&((t.a===p&&t.b===T)||(t.a===T&&t.b===p)))); S.treaties.push({type:'embargo',a:p,b:T});
    return {ok:true,narr:`Your ports close to ${tn}'s ships. Their factories starve for oil (−0.6 industry, −3 stability); relations −15.`}; }
  case 'spy':{
    const e=cost(15); if(e) return fail(e);
    const r=rnd(); let narr=V(`Agents slip into ${tn} on a moonless night.`,`A forged passport, a suitcase radio, a contact in ${REG[capOf(T)].name}.`)+' ';
    const intel=`Intel: army ${S.nat[T].army.toFixed(0)} div (quality ${S.nat[T].q.toFixed(2)}), industry ${S.nat[T].ind.toFixed(1)}, stability ${Math.round(S.nat[T].stab)}${(S.claims[T]||[]).filter(x=>S.owner[x]===p).length?`, and they covet your ${(S.claims[T]||[]).filter(x=>S.owner[x]===p).map(x=>REG[x].name).join(', ')}`:''}.`;
    if(r<0.6){ S.nat[T].ind=Math.max(0.5,S.nat[T].ind-0.4); S.nat[T].stab-=4; narr+=`Sabotage cripples a rail junction (−0.4 industry). ${intel}`; }
    else narr+=`They find little beyond rumours. ${intel}`;
    if(rnd()<0.25){ addRel(p,T,-20); narr+=` But one agent is caught — and talks. Relations −20.`; }
    return {ok:true,narr}; }
  case 'propaganda':{
    const e=cost(10); if(e) return fail(e);
    if(T===p||!T){ you.stab=clamp(you.stab+7,0,100); return {ok:true,narr:`Posters on every wall, marching bands, a stirring speech on the wireless. Stability +7 → ${Math.round(you.stab)}.`}; }
    S.nat[T].stab-=6; addRel(p,T,-5); return {ok:true,narr:`Your radio towers beam propaganda deep into ${tn}. Unrest stirs in the cafés (−6 stability).`}; }
  case 'mobilize':{
    if(you.mp<15) return fail(`Not enough manpower to mobilize (${Math.floor(you.mp)}). Wait for reserves to grow.`);
    const add=Math.min(you.mp/6, you.army*0.25+3); you.army+=add; you.mp-=add*6; you.stab-=8; you.bud=Math.max(you.bud,0.5); S.tension+=3;
    return {ok:true,narr:`Mobilization posters go up overnight. +${add.toFixed(1)} divisions, budget raised to ${Math.round(you.bud*100)}% military, stability −8. Neighbours are alarmed.`}; }
  case 'build_army':{
    const e=cost(30); if(e) return fail(e); if(you.mp<12){ you.gold+=30; return fail(`Not enough manpower (${Math.floor(you.mp)}/12).`); }
    const add=2+you.ind*0.08; you.army+=add; you.mp-=12; return {ok:true,narr:`New divisions drill on muddy fields. +${add.toFixed(1)} divisions (−30 gold, −12 manpower).`}; }
  case 'build_industry':{
    const e=cost(40); if(e) return fail(e); you.ind+=1.2; return {ok:true,narr:`Smokestacks rise over the river. +1.2 industry (more gold and faster army growth from next month). −40 gold.`}; }
  case 'fortify':{
    const e=cost(25); if(e) return fail(e);
    let r=R&&S.owner[R]===p?R:null; if(!r&&T&&T!==p){ r=regionsOf(p).filter(x=>[...LANDADJ[x]].some(y=>S.owner[y]===T)).sort((a,b)=>(S.fort[a]||0)-(S.fort[b]||0))[0]||null; } if(!r){ const threat=regionsOf(p).filter(x=>[...LANDADJ[x]].some(y=>S.owner[y]!==p&&(atWar(p,S.owner[y])||rel(p,S.owner[y])<0))); r=threat.sort((a,b)=>(S.fort[a]||0)-(S.fort[b]||0))[0]||capOf(p); }
    if((S.fort[r]||0)>=5){ you.gold+=25; return fail(`${REG[r].name} is already fortified to the maximum.`); }
    S.fort[r]=(S.fort[r]||0)+1; return {ok:true,narr:`Concrete pours along the frontier at ${REG[r].name}. Fort level ${S.fort[r]} (each level adds +20% defence).`}; }
  case 'budget':{
    let b=text&&/(\d{1,2})\s*%/.test(text)?(+text.match(/(\d{1,2})\s*%/)[1])/100:(/factor|civil|industr/.test(text||'')?you.bud-0.1:you.bud+0.1);
    you.bud=clamp(b,0.1,0.7); return {ok:true,narr:`Budget set: ${Math.round(you.bud*100)}% military, ${Math.round(100-you.bud*100)}% civilian.`}; }
  case 'demand':{
    if(atWar(p,T)) return fail(`You are already at war with ${tn} — take it by force (Attack).`);
    const cand=borderRegs(p,T,false); let r=R&&S.owner[R]===T?R:((S.claims[p]||[]).find(x=>S.owner[x]===T&&cand.includes(x))||cand[0]);
    if(!r) return fail(`${tn} has no territory bordering yours to demand.`);
    if(!cand.includes(r)) return fail(`${REG[r].name} doesn't border your territory, so ${tn} laughs at the demand.`);
    const def=coalition(T,p).reduce((s,x)=>s+eff(x)*(x===T?1:0.6),0), ratio=eff(p)/Math.max(0.5,def);
    const claimed=(S.claims[p]||[]).includes(r);
    const pr=clamp((ratio-1.6)*0.35+(claimed?0.15:0)-(T===S.player?1:0),0,0.85);
    if(rnd()<pr){ transfer(r,p,'ceded under ultimatum'); addRel(p,T,-30); S.tension+=5; ['UK','FRA','SOV','USA'].filter(x=>x!==p&&x!==T&&alive(x)).forEach(x=>addRel(p,x,-6));
      return {ok:true,narr:`Faced with your army (ratio ${ratio.toFixed(1)}:1), ${tn} buckles and cedes ${REG[r].name}. The great powers watch with growing alarm.`}; }
    addRel(p,T,-20); S.tension+=3; return {ok:true,narr:`${tn} rejects your ultimatum over ${REG[r].name} (your strength vs their coalition: ${ratio.toFixed(1)}:1 — you need about 2:1). Relations −20. You could now take it by force.`}; }
  case 'advisor': return {ok:true,narr:advisorText(T),noTime:true};
  }
  return fail('Unknown order.');
}
const EXAMPLES=['Invade Poland','Ally with Italy','Demand Danzig from Poland','Build factories','Spy on the Soviets','Trade oil with Romania','Fortify the border','Mobilize the army','Guarantee Belgium','Embargo Japan','Make peace with France','Propaganda'];

/* ================= ADVISOR & BRIEFING ================= */
function threatsTo(p){ return NAT.filter(x=>alive(x)&&x!==p).map(x=>{ const cl=(S.claims[x]||[]).filter(r=>S.owner[r]===p); const b=borders(x,p); const score=(cl.length?40:0)+(b?20:0)-rel(p,x)/3+eff(x)/Math.max(1,eff(p))*10+(atWar(p,x)?60:0); return {x,cl,b,score}; }).filter(t=>t.b||t.cl.length).sort((a,b)=>b.score-a.score); }
function advisorText(T){
  const p=P(), n=S.nat[p]; const th=threatsTo(p)[0]; const fr=S.fronts.filter(f=>f.a===p);
  let t=`Chief of Staff: "Treasury ${Math.floor(n.gold)} gold, ${n.army.toFixed(0)} divisions, industry ${n.ind.toFixed(1)}. `;
  if(th) t+=`Greatest danger: ${nm(th.x)} (${eff(th.x).toFixed(0)} effective strength vs our ${eff(p).toFixed(0)}${th.cl.length?`, they claim ${th.cl.map(r=>REG[r].name).join(', ')}`:''}). `;
  if(T&&T!==p){ const reach=pickTarget(p,T); if(reach){ const c=frontCalc({a:p,d:T,r:reach}); t+=`Against ${nm(T)}, an attack on ${REG[reach].name} would face ${c.terr}${c.fort?` and forts ${c.fort}`:''} at ${c.ratio.toFixed(2)}:1 — ${c.ratio<0.8?'suicide':c.ratio<1.3?'a long grind':'promising'}. `; } else t+=`We cannot reach ${nm(T)} by land or sea. `;
    t+=rel(p,T)>=55?`They might accept an alliance. `:rel(p,T)<-30?`They despise us. `:''; }
  if(fr.length) t+=`Fronts: ${fr.map(f=>`${REG[f.r].name} ${Math.round(f.prog)}%`).join(', ')}. `;
  if(n.gold<30) t+='We are nearly broke — build factories or trade. ';
  if(n.stab<35) t+='Unrest is dangerous; use propaganda at home. ';
  return t.trim()+'"';
}
function nextEventHint(){ const e=EVENTS.find(e=>S.ev[e.id]===undefined&&e.at>=YM()&&(!e.cond||e.cond())); return e?`${MONTHS[e.at%12]} ${Math.floor(e.at/12)}: ${e.title}`:'—'; }
function renderBriefing(){ const p=P(), n=S.nat[p];
  const fr=S.fronts.filter(f=>f.a===p||f.d===p);
  const goals=(S.claims[p]||[]).map(r=>`<li class="${S.owner[r]===p?'done':''}">${S.owner[r]===p?'✔':'☐'} ${esc(REG[r].name)} <small>(${esc(nm(S.owner[r]))})</small></li>`).join('');
  const th=threatsTo(p).slice(0,3).map(t=>`<li>${esc(nm(t.x))} <small>str ${eff(t.x).toFixed(0)} · rel ${rel(p,t.x)}${t.cl.length?' · claims '+t.cl.map(r=>esc(REG[r].name)).join(', '):''}${atWar(p,t.x)?' · <b class="war">AT WAR</b>':''}</small></li>`).join('');
  $('#brief').innerHTML=`<div class="adv">${esc(advisorText())}</div>
   <h4>Economy</h4><div class="econ">Gold <b>${Math.floor(n.gold)}</b> (+${(n.ind*0.9-n.army*0.04).toFixed(1)}/mo) · Industry <b>${n.ind.toFixed(1)}</b> · Manpower <b>${Math.floor(n.mp)}</b> · Army <b>${n.army.toFixed(1)}</b> div · Quality ${n.q.toFixed(2)} · Stability <b>${Math.round(n.stab)}</b></div>
   <label class="bud">Budget: <b id="budv">${Math.round(n.bud*100)}%</b> army / ${Math.round(100-n.bud*100)}% factories<input id="budr" type="range" min="10" max="70" value="${Math.round(n.bud*100)}"></label>
   <h4>Fronts</h4>${fr.length?fr.map(f=>`<div class="front"><span>${f.a===p?'▶ Attacking':'◀ Defending'} ${esc(REG[f.r].name)} <small>${esc(nm(f.a))} vs ${esc(nm(f.d))}${f.last?` · ratio ${f.last.ratio} · ${f.last.delta>=0?'+':''}${f.last.delta}%/mo · losses ${f.last.la}/${f.last.ld} div · ${esc(f.last.terr)}`:''}</small></span><i style="width:${Math.round(f.prog)}%"></i></div>`).join(''):'<small>No active fronts.</small>'}
   <h4>Threats</h4><ul>${th||'<li><small>None nearby.</small></li>'}</ul>
   <h4>War goals (claims)</h4><ul>${goals||'<li><small>No claims. Demand or conquer to expand.</small></li>'}</ul>
   <h4>Coming up</h4><small>${esc(nextEventHint())}</small>`;
  $('#budr').oninput=e=>{ n.bud=e.target.value/100; $('#budv').textContent=e.target.value+'%'; autosave(); };
}

/* ================= LLM: local (PC) + on-device (WebLLM) ================= */
function loadCfg(){ const d={enabled:true,kind:'auto',base:'http://127.0.0.1:11434',model:'',timeout:60,temperature:0.4}; try{ return Object.assign(d,JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){ return d; } }
function saveCfg(){ localStorage.setItem(CFG_KEY,JSON.stringify(CFG)); }
const HOSTED=location.protocol==='https:'&&!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if(HOSTED){ CFG.enabled=false; }
let PROXY=null, WEBLLM=null, WEBLLM_ID=null;
async function detectProxy(){ if(location.protocol==='file:'||HOSTED) return PROXY=false; try{ const j=await (await fetch('/api/ping',{cache:'no-store'})).json(); PROXY=!!(j&&j.server==='ww2-ai'); }catch(e){ PROXY=false; } return PROXY; }
async function xfetch(url,opts={},ms=8000){ const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),ms); try{ return await fetch(PROXY?'/llm?url='+encodeURIComponent(url):url,Object.assign({signal:ctl.signal},opts)); } finally{ clearTimeout(t); } }
async function autodetect(){ let hints=[], hm=[]; if(PROXY){ try{ const h=await (await fetch('/api/hints')).json(); hints=h.candidates||[]; hm=h.models||[]; }catch(e){} }
  const bases=[...new Set([...hints,'http://127.0.0.1:11434','http://127.0.0.1:1234','http://127.0.0.1:8080','http://127.0.0.1:8000','http://127.0.0.1:5001'])]; const found=[];
  for(const b of bases){ const root=b.replace(/\/v1\/?$/,'').replace(/\/$/,'');
    try{ const r=await xfetch(root+'/api/tags',{},2500); if(r.ok){ const j=await r.json(); if(j.models){ found.push({kind:'ollama',base:root,models:j.models.map(m=>m.name)}); continue; } } }catch(e){}
    try{ const r=await xfetch(root+'/v1/models',{},2500); if(r.ok){ const j=await r.json(); if(j.data) found.push({kind:'openai',base:root+'/v1',models:j.data.map(m=>m.id)}); } }catch(e){} }
  return {found,hintModels:hm}; }
function pickModel(models,hints){ const ok=models.filter(m=>!/embed|bge|nomic|minilm/i.test(m)); for(const h of hints||[]){ const f=ok.find(m=>m===h||m.endsWith('/'+h)||h.endsWith(m)); if(f) return f; } return ok[0]||models[0]||''; }
const INTENT_KEYS=INTENTS.map(i=>i[0]);
const ISCHEMA={type:'object',required:['intent','target','region','reply'],properties:{intent:{type:'string',enum:[...INTENT_KEYS,'unknown']},target:{type:['string','null']},region:{type:['string','null']},reply:{type:'string'}}};
function validateIntent(raw){
  let o=raw; if(typeof raw==='string'){ const t=raw.trim().replace(/^```(?:json)?/i,'').replace(/```$/,''); const i=t.indexOf('{'), j=t.lastIndexOf('}'); if(i<0||j<i) throw new Error('no JSON object'); o=JSON.parse(t.slice(i,j+1)); }
  if(!o||typeof o!=='object') throw new Error('not an object');
  const intent=String(o.intent||'').toLowerCase(); if(![...INTENT_KEYS,'unknown'].includes(intent)) throw new Error('bad intent '+intent);
  let target=o.target?String(o.target).toUpperCase():null; if(target&&!D.N[target]){ const hit=detectTargets(' '+String(o.target).toLowerCase()+' ')[0]; target=hit?hit.n:null; }
  let region=o.region?String(o.region):null; if(region&&!REG[region]){ const hit=detectTargets(' '+region.toLowerCase()+' ').find(h=>h.r); region=hit?hit.r:null; }
  return {intent, target:target&&alive(target)?target:null, region, reply:typeof o.reply==='string'?o.reply.slice(0,300):''};
}
function intentPrompt(text,popT){ return [{role:'system',content:`You turn a WWII strategy player's typed order into JSON. Player nation: ${P()} (${nm(P())}). Date: ${dateStr()}. Reply ONLY with JSON: {"intent": one of ${JSON.stringify([...INTENT_KEYS,'unknown'])}, "target": nation code like GER,UK,FRA,ITA,SOV,JAP,USA,CHI,POL or null, "region": region name or null, "reply": one short in-character sentence from your minister}. Nation codes: ${NAT.filter(alive).join(',')}.`},{role:'user',content:`Selected country on map: ${popT||'none'}. Order: "${text}"`}]; }
async function llmRaw(msgs){
  if(WEBLLM){ const r=await WEBLLM.chat.completions.create({messages:msgs,temperature:0.3,max_tokens:160,response_format:{type:'json_object'}}); return r.choices[0].message.content; }
  const tmo=(+CFG.timeout||60)*1000;
  if(CFG.kind==='openai'){ const body={model:CFG.model,messages:msgs,temperature:+CFG.temperature,response_format:{type:'json_object'},stream:false};
    let r=await xfetch(CFG.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo);
    if(r.status===400){ delete body.response_format; r=await xfetch(CFG.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo); }
    if(!r.ok) throw new Error('HTTP '+r.status); return (await r.json()).choices[0].message.content; }
  const body={model:CFG.model,messages:msgs,stream:false,format:ISCHEMA,options:{temperature:+CFG.temperature,num_ctx:2048}};
  let r=await xfetch(CFG.base.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo);
  if(r.status===400||r.status===500){ body.format='json'; r=await xfetch(CFG.base.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},tmo); }
  if(!r.ok) throw new Error('HTTP '+r.status); return (await r.json()).message.content;
}
const llmReady=()=>!!WEBLLM||(!HOSTED&&CFG.enabled&&CFG.model&&(CFG.kind==='ollama'||CFG.kind==='openai'));
async function llmInterpret(text,popT){
  if(!llmReady()) return null; const msgs=intentPrompt(text,popT);
  for(let i=0;i<2;i++){ let raw; try{ raw=await llmRaw(msgs); }catch(e){ setAIStatus('AI offline ('+(e.name==='AbortError'?'timeout':e.message)+') — parser used'); return null; }
    try{ const v=validateIntent(raw); setAIStatus((WEBLLM?'on-device · '+WEBLLM_ID:CFG.kind+' · '+CFG.model)); return v; }
    catch(e){ msgs.push({role:'assistant',content:String(raw).slice(0,800)},{role:'user',content:`Invalid (${e.message}). Reply with ONLY the JSON object.`}); } }
  setAIStatus('AI gave invalid JSON twice — parser used'); return null; }
async function loadWebLLM(modelId){
  if(!('gpu' in navigator)) throw new Error('This browser has no WebGPU (needs iOS/Safari 26+, or recent Chrome/Edge).');
  const ad=await navigator.gpu.requestAdapter(); if(!ad) throw new Error('No WebGPU adapter available.');
  if(/q4f16/.test(modelId)&&!ad.features.has('shader-f16')) modelId=modelId.replace('q4f16_1','q4f32_1');
  const webllm=await import('https://esm.run/@mlc-ai/web-llm');
  WEBLLM=await webllm.CreateMLCEngine(modelId,{initProgressCallback:p=>{ $('#wl-out').textContent=p.text; }}); WEBLLM_ID=modelId; setAIStatus('on-device · '+modelId); return modelId; }


/* ================= B2 world-AI bridge (optional) ================= */
function b2World(){ const nat={}; NAT.forEach(c=>{ const n=S.nat[c]; nat[c]={alive:n.alive,army:Math.round(n.army),industry:Math.round(n.ind),stability:Math.round(n.stab)}; }); return {S:Object.assign({},S,{nat}),ADJ,REG,NAT}; }
function validateResult(o,ctx){
  if(!o||typeof o.narrative!=='string'||o.narrative.trim().length<3) throw new Error('missing narrative');
  const arr=k=>Array.isArray(o[k])?o[k].filter(x=>x&&typeof x==='object'):[]; const isN=c=>typeof c==='string'&&D.N[c.toUpperCase()]&&alive(c.toUpperCase()); const U=c=>c.toUpperCase();
  const out={narrative:o.narrative.trim().slice(0,1200),border_changes:[],relation_changes:[],reactions:[],events:[],wars:[],treaties:[],stat_changes:[]};
  const decl=arr('wars').filter(w=>w.action==='declare').map(w=>[U(w.a||''),U(w.b||'')]);
  for(const b of arr('border_changes')){ const r=REG[b.region]?b.region:null; if(!r||!isN(b.to)||out.border_changes.length>=1) continue; const to=U(b.to), from=S.owner[r]; if(from===to) continue;
    const touches=[...ADJ[r]].some(x=>S.owner[x]===to); const fr=S.fronts.find(f=>f.a===to&&f.d===from&&f.r===r);
    // conquest must go through fronts (prog>=50); cessions only for a diplomatic demand on that owner
    if(touches&&((fr&&fr.prog>=50&&atWar(to,from))||(ctx.cession&&ctx.target===from&&!decl.length))) out.border_changes.push({region:r,to}); }
  for(const r of arr('relation_changes')) if(isN(r.a)&&isN(r.b)&&U(r.a)!==U(r.b)&&Number.isFinite(+r.delta)) out.relation_changes.push({a:U(r.a),b:U(r.b),delta:clamp(Math.round(+r.delta),-40,40)});
  for(const r of arr('reactions').slice(0,6)) if(isN(r.nation)&&typeof r.text==='string') out.reactions.push({nation:U(r.nation),text:r.text.slice(0,240)});
  for(const e of arr('events').slice(0,4)) if(typeof e.text==='string') out.events.push({text:e.text.slice(0,240)});
  for(const w of arr('wars')) if(['declare','peace'].includes(w.action)&&isN(w.a)&&isN(w.b)&&U(w.a)!==U(w.b)) out.wars.push({action:w.action,a:U(w.a),b:U(w.b)});
  for(const t of arr('treaties')) if(['alliance','non_aggression','guarantee','trade'].includes(t.type)&&isN(t.a)&&isN(t.b)&&U(t.a)!==U(t.b)) out.treaties.push({type:t.type,a:U(t.a),b:U(t.b)});
  for(const s of arr('stat_changes')) if(isN(s.nation)) out.stat_changes.push({nation:U(s.nation),army:clamp(Math.round(+s.army||0),-3,3),industry:clamp(Math.round(+s.industry||0),-2,2),stability:clamp(Math.round(+s.stability||0),-20,20)});
  return out; }
function applyResult(res){
  for(const w of res.wars){ if(w.action==='declare') declareWar(w.a,w.b,'B2 world AI'); else if(atWar(w.a,w.b)) makePeace(w.a,w.b,'negotiated'); }
  for(const b of res.border_changes) transfer(b.region,b.to,'per the world AI');
  for(const r of res.relation_changes) addRel(r.a,r.b,r.delta);
  for(const t of res.treaties) if(!hasT(t.type,t.a,t.b)&&!atWar(t.a,t.b)){ S.treaties.push(t); log('treaty',`📜 ${nm(t.a)} and ${nm(t.b)} sign a ${t.type.replace('_','-')} pact.`); }
  for(const s of res.stat_changes){ const n=S.nat[s.nation]; n.army=Math.max(0.5,n.army+s.army); n.ind=Math.max(0.5,n.ind+s.industry); n.stab=clamp(n.stab+s.stability,0,100); }
  for(const r of res.reactions) log('react',`${nm(r.nation)}: ${r.text}`);
  for(const e of res.events){ log('event',e.text); news(e.text.slice(0,90)); }
}
const b2Ready=()=>!!(window.B2Link&&B2Link.ready());

/* ================= TURN FLOW ================= */
function snap(){ const p=P(); return {own:{...S.owner}, nat:JSON.parse(JSON.stringify(S.nat[p])), rel:Object.fromEntries(NAT.map(x=>[x,rel(p,x)])), wars:S.wars.map(w=>w.a+'|'+w.b), tre:S.treaties.map(t=>t.type+'|'+t.a+'|'+t.b), tension:S.tension, fronts:Object.fromEntries(S.fronts.filter(f=>f.a===p||f.d===p).map(f=>[f.a+f.d+f.r,f.prog])), news:S.news.length, newsTop:S.news[0]}; }
function diff(b){ const p=P(), out=[], n=S.nat[p];
  RIDS.forEach(r=>{ if(b.own[r]!==S.owner[r]){ if(S.owner[r]===p) out.push(`<li class="good">＋ ${esc(REG[r].name)} is now yours (from ${esc(nm(b.own[r]))})</li>`); else if(b.own[r]===p) out.push(`<li class="bad">− Lost ${esc(REG[r].name)} to ${esc(nm(S.owner[r]))}</li>`); } });
  const world={}; RIDS.forEach(r=>{ if(b.own[r]!==S.owner[r]&&S.owner[r]!==p&&b.own[r]!==p){ const k=nm(S.owner[r])+' took '; (world[k]=world[k]||[]).push(REG[r].name);} }); Object.entries(world).slice(0,5).forEach(([k,v])=>out.push(`<li>🌍 ${esc(k+v.join(', '))}</li>`));
  const st=[['army','Army','div',1],['ind','Industry','',1],['gold','Gold','',0],['mp','Manpower','',0],['stab','Stability','',0]].map(([k,l,u,dp])=>{ const d=n[k]-b.nat[k]; return Math.abs(d)>=(dp?0.1:1)?`${l} ${d>0?'+':''}${d.toFixed(dp)}${u?' '+u:''}`:null; }).filter(Boolean);
  if(st.length) out.push(`<li>📊 ${st.join(' · ')}</li>`);
  NAT.forEach(x=>{ const d=rel(p,x)-b.rel[x]; if(Math.abs(d)>=3&&alive(x)) out.push(`<li class="${d>0?'good':'bad'}">🤝 ${esc(nm(x))} ${d>0?'+':''}${d} → ${rel(p,x)}</li>`); });
  S.wars.forEach(w=>{ if(!b.wars.includes(w.a+'|'+w.b)) out.push(`<li class="bad">⚔ War: ${esc(nm(w.a))} vs ${esc(nm(w.b))}${w.motive?` <small>(${esc(w.motive)})</small>`:''}</li>`); });
  b.wars.forEach(k=>{ if(!S.wars.some(w=>w.a+'|'+w.b===k)){ const [x,y]=k.split('|'); out.push(`<li class="good">🕊 Peace/ended: ${esc(nm(x))} – ${esc(nm(y))}</li>`);} });
  S.treaties.forEach(t=>{ if(!b.tre.includes(t.type+'|'+t.a+'|'+t.b)) out.push(`<li>📜 ${esc(t.type.replace('_','-'))}: ${esc(nm(t.a))} – ${esc(nm(t.b))}</li>`); });
  S.fronts.filter(f=>f.a===p||f.d===p).forEach(f=>{ const was=b.fronts[f.a+f.d+f.r]; out.push(`<li>🎯 Front ${esc(REG[f.r].name)} (${esc(nm(f.a))}→${esc(nm(f.d))}): ${Math.round(f.prog)}%${was!=null?` (${f.prog-was>=0?'+':''}${Math.round(f.prog-was)})`:' (new)'}${f.last?` · ratio ${f.last.ratio}, losses ${f.last.la}/${f.last.ld} div`:''}</li>`); });
  const dt=S.tension-b.tension; if(Math.abs(dt)>=1) out.push(`<li>🌡 World tension ${dt>0?'+':''}${Math.round(dt)} → ${Math.round(S.tension)}</li>`);
  return out; }
function headlinesSince(b){ const k=S.news.indexOf(b.newsTop); return (k<0?S.news.slice(0,6):S.news.slice(0,k)).slice(0,6); }
async function endMonth(){
  economyTick(); aiDiplomacy(); aiWarCheck(); aiFronts();
  const fs=S.fronts.slice().sort(()=>rnd()-0.5); for(const f of fs){ if(!S.fronts.includes(f)) continue; if(resolveFront(f)==='drop') S.fronts=S.fronts.filter(x=>x!==f); }
  await runEvents();
  S.m++; if(S.m>11){ S.m=0; S.y++; } S.turn++; S.tension=clamp(S.tension,0,100);
  if(!alive(P())) log('war',`${nm(P())} has fallen. Start a new game or load a save.`);
  autosave(); dirty=true;
}
async function submit(kind,target,region,text){
  if(busy||!S) return; busy=true; hidePopup(); showBusy(true); const before=snap(); S.flash=[]; dirty=true;
  let title='', narr='', reply='', parsedNote='';
  try{
    if(b2Ready()&&kind!=='advisor'){
      const mv={kind,target,text}; let r=null;
      try{ r=await B2Link.resolve(b2World(),mv,false,{onStatus:t=>{ $('#busy-t').textContent=t; setAIStatus(t); },validate:o=>validateResult(o,{target,cession:['free','demand','talk'].includes(kind)})}); }catch(e){ r=null; }
      if(r){ log('turn',`— ${nm(P())}: ${text?'"'+text+'"':kind.toUpperCase()}${target&&target!==P()?' → '+nm(target):''} [B2]`); log('narr',r.narrative); applyResult(r);
        if(kind==='attack'&&target&&atWar(P(),target)) openFront(P(),target,region);
        $('#busy-t').textContent='The month passes…'; await endMonth();
        showReport((text?`“${text}”`:kind.toUpperCase())+` — ${dateStr()}`,`<p>${esc(r.narrative)}</p><p><small>Resolved by B2 world AI</small></p>`,diff(before),headlinesSince(before)); return; }
      $('#busy-t').textContent='Rules engine takes over…';
    }
    if(kind==='free'){
      let it=null; if(llmReady()){ $('#busy-t').textContent='Your ministers confer…'; it=await llmInterpret(text,target); if(it&&it.intent==='unknown') { reply=it.reply; it=null; } }
      if(it){ reply=it.reply; parsedNote=`AI understood: ${it.intent}${it.target?' → '+nm(it.target):''}`; kind=it.intent; target=it.target||target; region=it.region||null; }
      else { const pz=parseIntent(text,target); if(!pz.intent){ showReport(`“${text}”`,`<p>Your ministers look at each other. Nobody is sure what you mean${pz.mentions.length?` regarding ${esc(pz.mentions.join(', '))}`:''}.</p><p>${reply?esc(reply)+' ':''}Try an order like: ${EXAMPLES.slice(0,8).map(e=>`<button class="ex">${e}</button>`).join(' ')}</p><p><small>No time has passed.</small></p>`,[],[]); return; }
        kind=pz.intent; target=pz.target||target; region=pz.region; parsedNote=`Understood: ${kind.replace('_',' ')}${target?' → '+nm(target):''}${region?' ('+REG[region].name+')':''}`; }
    }
    title=(text?`“${text}”`:kind.replace('_',' ').toUpperCase()+(target&&target!==P()?' → '+nm(target):''));
    const res=act(kind,target,region,text);
    if(!res.ok){ showReport(title,`<p>${reply?`<i>${esc(reply)}</i><br>`:''}${esc(res.narr)}</p><p><small>${esc(parsedNote)} · No time has passed.</small></p>`,[],[]); return; }
    if(res.noTime){ log('advisor',res.narr); showReport('Advisor',`<p>${esc(res.narr)}</p>`,[],[]); return; }
    log('turn',`— ${nm(P())}: ${text?'"'+text+'"':kind.toUpperCase()}${target&&target!==P()?' → '+nm(target):''}`); log('narr',res.narr);
    $('#busy-t').textContent='The month passes…';
    await endMonth();
    showReport(title+` — ${dateStr()}`,`${reply?`<p class="reply">${esc(reply)}</p>`:''}<p>${esc(res.narr)}</p>${parsedNote?`<p><small>${esc(parsedNote)}</small></p>`:''}`,diff(before),headlinesSince(before));
  } finally { busy=false; showBusy(false); renderAll(); }
}
async function passTurn(){ if(busy||!S) return; busy=true; showBusy(true); const before=snap(); S.flash=[]; try{ log('turn','— You wait and watch.'); await endMonth(); showReport(`Month report — ${dateStr()}`,'<p>You hold your hand and watch the world move.</p>',diff(before),headlinesSince(before)); } finally{ busy=false; showBusy(false); renderAll(); } }

/* ================= SAVE ================= */
function autosave(){ try{ const c={...S}; delete c._hops; localStorage.setItem(SAVE_KEY,JSON.stringify(c)); }catch(e){} }
function loadFrom(key){ const s=localStorage.getItem(key); if(!s) return false; try{ const o=JSON.parse(s); if(o.v!==3) return false; S=o; dirty=true; renderAll(); return true; }catch(e){ return false; } }

/* ================= RENDERING (cached layer) ================= */
let dirty=true;
const canvas=$('#map'), ctx=canvas.getContext('2d'); canvas.width=COLS*CS; canvas.height=ROWS*CS;
const RGB={}; NAT.forEach(c=>{ const h=D.N[c][1]; RGB[c]=[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]; });
const HA={}; NAT.forEach(c=>{ const a=D.N[c][2]*Math.PI/180; HA[c]=[Math.cos(a),Math.sin(a)]; });
let paperImg=null;
function paper(){ if(paperImg) return paperImg; const W=canvas.width,H=canvas.height; const img=ctx.createImageData(W,H), d=img.data; let s=99;
  for(let y=0;y<H;y++){ const wave=(y%7===0); for(let x=0;x<W;x++){ const i=(y*W+x)*4; s=(s*16807)%2147483647; const n=(s/2147483647)*14; let v=226-n; const w=wave&&((x+y*3)%23<16);
    d[i]=w?150:v; d[i+1]=w?150:v-10; d[i+2]=w?150:v-32; d[i+3]=255; } }
  return paperImg=img; }
function drawMap(){
  if(!S||!dirty) return; dirty=false;
  const W=canvas.width, img=new ImageData(new Uint8ClampedArray(paper().data), W, canvas.height), d=img.data;
  const flash=new Set(S.flash); const oc=new Array(RIDS.length); RIDS.forEach((id,i)=>oc[i]=S.owner[id]);
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const g=GRID[r*COLS+c]; if(g<0) continue; const o=oc[g], col=RGB[o], [ca,sa]=HA[o], fl=flash.has(RIDS[g]);
    for(let yy=0;yy<CS;yy++){ const py=r*CS+yy; for(let xx=0;xx<CS;xx++){ const px=c*CS+xx, i=(py*W+px)*4; let v=px*ca+py*sa; v=((v%5)+5)%5; const k=v<1.1?0.62:1;
      let R=col[0]*k,G=col[1]*k,B=col[2]*k; if(fl){ R=R*0.5+200*0.5; G=G*0.5+30*0.5; B=B*0.5+20*0.5; } d[i]=R; d[i+1]=G; d[i+2]=B; } } }
  const setPx=(x,y,R,G,B)=>{ const i=(y*W+x)*4; d[i]=R; d[i+1]=G; d[i+2]=B; };
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ const g=GRID[r*COLS+c];
    for(const [dr,dc] of [[0,1],[1,0]]){ if(r+dr>=ROWS||c+dc>=COLS) continue; const h=GRID[(r+dr)*COLS+c+dc]; if(g===h) continue;
      let kind; if(g<0||h<0) kind='coast'; else if(oc[g]!==oc[h]) kind=atWar(oc[g],oc[h])?'war':'nat'; else kind='reg';
      const x0=(c+dc)*CS, y0=(r+dr)*CS;
      for(let t=0;t<CS;t++){ const x=dc?x0:x0+t, y=dc?y0+t:y0;
        if(kind==='reg'){ if(t%2===0) setPx(x,y,70,58,45); continue; }
        const col=kind==='war'?[190,20,10]:[15,11,8];
        setPx(x,y,...col); if(dc){ if(x-1>=0) setPx(x-1,y,...col); } else { if(y-1>=0) setPx(x,y-1,...col); } } } }
  ctx.putImageData(img,0,0);
  drawOverlay();
}
function renderAll(){ if(!S) return; drawMap(); renderHUD(); renderLog(); renderRelations(); renderBriefing(); renderTicker(); }
function renderHUD(){ const n=S.nat[P()]; $('#date').textContent=dateStr(); $('#pname').textContent=nm(P()); $('#pflag').style.background=D.N[P()][1];
  $('#pstats').textContent=`💰${Math.floor(n.gold)} 🏭${n.ind.toFixed(1)} 🪖${n.army.toFixed(0)} ✊${Math.round(n.stab)}`;
  $('#tension i').style.width=Math.round(S.tension)+'%'; $('#tension b').textContent=Math.round(S.tension); }
function renderTicker(){ $('#ticker span').textContent=S.news.length?S.news.join('   ✦   '):'—'; }
function renderLog(){ $('#log').innerHTML=S.log.slice(0,150).map(l=>`<div class="le ${l.kind}"><span class="ld">${l.d}</span> ${esc(l.text)}</div>`).join(''); }
function renderRelations(){ const p=P(); const rows=NAT.filter(x=>x!==p&&alive(x)).sort((a,b)=>rel(p,b)-rel(p,a)).map(x=>{ const v=rel(p,x); const tags=[atWar(p,x)?'<b class="war">WAR</b>':'',hasT('alliance',p,x)?'ally':'',hasT('non_aggression',p,x)?'NAP':'',hasT('guarantee',p,x)?'guar.':'',hasT('trade',p,x)?'trade':'',hasT('embargo',p,x)?'embargo':''].filter(Boolean).join(' ');
  return `<div class="rr" data-n="${x}"><span class="sw" style="background:${D.N[x][1]}"></span><span class="rn">${esc(nm(x))}</span><span class="bar"><i style="width:${Math.abs(v)/2}%;${v<0?'right:50%;background:#8e1b12':'left:50%;background:#2c2a26'}"></i></span><span class="rv">${v}</span><span class="tg">${tags}</span></div>`; }).join('');
  $('#rels').innerHTML=`<div class="wars">${S.wars.map(w=>`${esc(nm(w.a))} ⚔ ${esc(nm(w.b))}${w.motive?` <small>(${esc(w.motive)})</small>`:''}`).join('<br>')||'No wars.'}</div>`+rows; }

/* ================= VIEW: pinch / pan / tap ================= */
const wrap=$('#mapwrap'); const VW={s:1,x:0,y:0,fit:1};
const ov=document.createElement('canvas'); ov.id='ov'; wrap.insertBefore(ov,canvas.nextSibling); const octx=ov.getContext('2d'); let ovQ=false;
function applyView(){ canvas.style.transform=`translate(${VW.x}px,${VW.y}px) scale(${VW.s})`; if(!ovQ){ ovQ=true; requestAnimationFrame(()=>{ ovQ=false; drawOverlay(); }); } }
/* Labels/markers live on a screen-space overlay: fixed readable size, they spread apart as you zoom in. */
function drawOverlay(){ const dpr=Math.min(3,window.devicePixelRatio||1), w=wrap.clientWidth, h=wrap.clientHeight;
  if(ov.width!==Math.round(w*dpr)||ov.height!==Math.round(h*dpr)){ ov.width=Math.round(w*dpr); ov.height=Math.round(h*dpr); ov.style.width=w+'px'; ov.style.height=h+'px'; }
  octx.setTransform(dpr,0,0,dpr,0,0); octx.clearRect(0,0,w,h); if(!S) return;
  const sp=(lon,lat)=>{ const [x,y]=toPx(lon,lat); return [VW.x+x*VW.s, VW.y+y*VW.s]; }, on=(x,y,m)=>x>-m&&y>-m&&x<w+m&&y<h+m;
  const z=VW.s/VW.fit; octx.textAlign='center'; octx.textBaseline='middle'; octx.lineJoin='round';
  const ppd=VW.s*CS*KX/STEP; if(ppd>=(w<600?30:26)){ octx.font='italic 600 10px Georgia,serif'; RIDS.forEach(id=>{ const r=REG[id]; const [x,y]=sp(r.lon,r.lat); if(!on(x,y,60)) return; octx.lineWidth=3; octx.strokeStyle='rgba(239,230,207,0.7)'; octx.strokeText(r.name,x,y+9); octx.fillStyle='#2a2018'; octx.fillText(r.name,x,y+9); }); }
  NAT.forEach(n=>{ if(!alive(n)) return; const regs=regionsOf(n); if(!regs.length) return; const cap=capOf(n); const [x,y]=sp(REG[cap].lon,REG[cap].lat); if(!on(x,y,200)) return;
    octx.fillStyle='#0d0a07'; octx.beginPath(); octx.arc(x,y,2.5,0,7); octx.fill(); octx.strokeStyle='#efe6cf'; octx.lineWidth=1.4; octx.stroke();
    const size=Math.round(clamp(9+Math.sqrt(regs.length)*1.1,9,16)); octx.font=`900 ${size}px Impact,"Arial Narrow",sans-serif`;
    const label=n==='UK'?'BRITAIN':n==='SOV'?'U.S.S.R.':n==='USA'?'U.S.A.':nm(n).toUpperCase();
    octx.lineWidth=3; octx.strokeStyle='rgba(239,230,207,0.9)'; octx.strokeText(label,x,y-size*0.85); octx.fillStyle=n===S.player?'#7a0c06':'#0d0a07'; octx.fillText(label,x,y-size*0.85); });
  octx.font='900 13px Impact,sans-serif'; S.fronts.forEach(f=>{ const [x,y]=sp(REG[f.r].lon,REG[f.r].lat); if(!on(x,y,20)) return; octx.lineWidth=3; octx.strokeStyle='rgba(239,230,207,0.9)'; octx.strokeText('✕',x,y); octx.fillStyle=f.a===S.player?'#b3140c':'rgba(20,10,5,.85)'; octx.fillText('✕',x,y); }); }
function fitView(){ const w=wrap.clientWidth,h=wrap.clientHeight; VW.fit=Math.min(w/canvas.width,h/canvas.height); VW.s=VW.fit; VW.x=(w-canvas.width*VW.s)/2; VW.y=(h-canvas.height*VW.s)/2; applyView(); }
function clampView(){ const w=wrap.clientWidth,h=wrap.clientHeight,cw=canvas.width*VW.s,ch=canvas.height*VW.s; VW.x=cw<=w?(w-cw)/2:clamp(VW.x,w-cw-w*0.4,w*0.4); VW.y=ch<=h?(h-ch)/2:clamp(VW.y,h-ch-h*0.4,h*0.4); applyView(); }
function zoomAt(px,py,f){ const ns=clamp(VW.s*f,VW.fit*0.6,VW.fit*60); const k=ns/VW.s; VW.x=px-(px-VW.x)*k; VW.y=py-(py-VW.y)*k; VW.s=ns; clampView(); }
function centerOn(c){ fitView(); const cap=capOf(c); if(!cap) return; const [x,y]=toPx(REG[cap].lon,REG[cap].lat); const w=wrap.clientWidth,h=wrap.clientHeight; const ppd=w<600?16:24; VW.s=Math.max(VW.fit*1.2, ppd*STEP/(CS*KX)); VW.x=w/2-x*VW.s; VW.y=h/2-y*VW.s; clampView(); }
window.addEventListener('resize',()=>{ const s=VW.s/VW.fit; fitView(); if(s>1.05){ VW.s=VW.fit*s; clampView(); } });
function cellAt(e){ const b=canvas.getBoundingClientRect(); const x=(e.clientX-b.left)*canvas.width/b.width, y=(e.clientY-b.top)*canvas.height/b.height; const c=Math.floor(x/CS), r=Math.floor(y/CS); if(c<0||r<0||c>=COLS||r>=ROWS) return null; const g=GRID[r*COLS+c]; return g<0?null:RIDS[g]; }
const ptrs=new Map(); let gesture=null, lastPtrType='mouse';
canvas.addEventListener('pointerdown',e=>{ canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===1) gesture={type:'tap',sx:e.clientX,sy:e.clientY,vx:VW.x,vy:VW.y,t:Date.now()};
  else if(ptrs.size===2){ const [p,q]=[...ptrs.values()]; gesture={type:'pinch',d:Math.hypot(p.x-q.x,p.y-q.y),s:VW.s,vx:VW.x,vy:VW.y,cx:(p.x+q.x)/2,cy:(p.y+q.y)/2}; } });
canvas.addEventListener('pointermove',e=>{
  if(e.pointerType==='mouse'&&!ptrs.size){ if(!S) return; const id=cellAt(e); const tip=$('#tip'); if(id){ tip.style.display='block'; tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+10)+'px'; tip.textContent=`${REG[id].name} — ${nm(S.owner[id])} · ${TERR[REG[id].t][0]}${S.fort[id]?' · forts '+S.fort[id]:''}`; } else tip.style.display='none'; return; }
  if(!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(!gesture) return;
  if(gesture.type!=='pinch'&&ptrs.size===1){ const dx=e.clientX-gesture.sx, dy=e.clientY-gesture.sy; if(gesture.type==='tap'&&Math.hypot(dx,dy)>8) gesture.type='pan'; if(gesture.type==='pan'){ VW.x=gesture.vx+dx; VW.y=gesture.vy+dy; clampView(); } }
  else if(gesture.type==='pinch'&&ptrs.size>=2){ const [p,q]=[...ptrs.values()]; const d=Math.hypot(p.x-q.x,p.y-q.y), cx=(p.x+q.x)/2, cy=(p.y+q.y)/2; const b=wrap.getBoundingClientRect();
    const ns=clamp(gesture.s*d/gesture.d,VW.fit*0.6,VW.fit*60); const ox=gesture.cx-b.left, oy=gesture.cy-b.top; VW.s=ns; VW.x=ox-(ox-gesture.vx)*(ns/gesture.s)+(cx-gesture.cx); VW.y=oy-(oy-gesture.vy)*(ns/gesture.s)+(cy-gesture.cy); clampView(); } });
function endPtr(e){ if(!ptrs.has(e.pointerId)) return; lastPtrType=e.pointerType; ptrs.delete(e.pointerId);
  if(gesture&&gesture.type==='tap'&&ptrs.size===0&&Date.now()-gesture.t<700&&S&&!busy){ const id=cellAt(e); if(!id) hidePopup(); else showPopup(S.owner[id],id,e.clientX,e.clientY); }
  if(ptrs.size===0) gesture=null; else if(gesture&&gesture.type==='pinch'){ const [p]=[...ptrs.values()]; gesture={type:'pan',sx:p.x,sy:p.y,vx:VW.x,vy:VW.y}; } }
canvas.addEventListener('pointerup',endPtr); canvas.addEventListener('pointercancel',e=>{ ptrs.delete(e.pointerId); if(!ptrs.size) gesture=null; });
canvas.addEventListener('touchend',e=>e.preventDefault(),{passive:false});
canvas.addEventListener('pointerleave',e=>{ if(e.pointerType==='mouse') $('#tip').style.display='none'; });
wrap.addEventListener('wheel',e=>{ e.preventDefault(); const b=wrap.getBoundingClientRect(); zoomAt(e.clientX-b.left,e.clientY-b.top,e.deltaY<0?1.2:1/1.2); },{passive:false});
['gesturestart','gesturechange'].forEach(t=>wrap.addEventListener(t,e=>e.preventDefault(),{passive:false}));
$('#zin').onclick=()=>zoomAt(wrap.clientWidth/2,wrap.clientHeight/2,1.5); $('#zout').onclick=()=>zoomAt(wrap.clientWidth/2,wrap.clientHeight/2,1/1.5); $('#zfit').onclick=fitView; $('#zme').onclick=()=>S&&centerOn(P());
const hdr=document.querySelector('header'); const setHH=()=>document.documentElement.style.setProperty('--hh',hdr.offsetHeight+'px'); setHH(); window.addEventListener('resize',setHH);
if(innerWidth>1100) document.body.classList.add('drawer'); 
{ const b=document.createElement('button'); b.id='btn-panel'; b.textContent='☰ Briefing'; b.onclick=()=>{ document.body.classList.toggle('drawer'); setTimeout(drawOverlay,260); }; hdr.querySelector('.btns').prepend(b); setHH(); }
const MOBILE=()=>window.matchMedia('(max-width: 820px), (max-height: 500px)').matches;
if(window.visualViewport){ const vv=window.visualViewport; const f=()=>document.documentElement.style.setProperty('--kb',Math.max(0,window.innerHeight-vv.height-vv.offsetTop)+'px'); vv.addEventListener('resize',f); vv.addEventListener('scroll',f); }

/* ================= POPUP / SHEET ================= */
let popTarget=null, popRegion=null, popOpenedAt=0;
function showPopup(n,rid,x,y){ popTarget=n; popRegion=rid; popOpenedAt=lastPtrType==='mouse'?0:Date.now(); const p=P(), pp=$('#popup'), st=S.nat[n];
  $('#pp-title').textContent=nm(n)+(n===p?' (you)':''); $('#pp-flag').style.background=D.N[n][1];
  const fr=S.fronts.find(f=>f.r===rid);
  $('#pp-info').innerHTML=`<b>${esc(REG[rid].name)}</b> · ${TERR[REG[rid].t][0]}${REG[rid].river?' + river':''}${S.fort[rid]?' · forts '+S.fort[rid]:''}${fr?` · front ${Math.round(fr.prog)}%`:''}<br>${IDEO(n)} · army ${st.army.toFixed(0)} · industry ${st.ind.toFixed(1)} · stability ${Math.round(st.stab)}${n!==p?`<br>Relations: <b>${rel(p,n)}</b>${atWar(p,n)?' <b class="war">AT WAR</b>':''}${hasT('alliance',p,n)?' · ally':''}`:''}`;
  const self=n===p; $('#pp-acts').innerHTML=(self?[['build_industry','Build factories'],['build_army','Build army'],['fortify','Fortify'],['mobilize','Mobilize'],['propaganda','Propaganda'],['advisor','Ask Advisor']]:[['talk','Talk to'],['act','Act ▾'],['attack','Attack'],['defend','Defend'],['advisor','Ask Advisor']]).map(([k,l])=>`<button data-act="${k}" class="${k==='attack'?'red':''}">${l}</button>`).join('');
  $('#pp-sub').innerHTML=''; $('#pp-sub').style.display='none';
  pp.style.display='block'; if(MOBILE()){ pp.classList.add('sheet'); pp.style.left=''; pp.style.top=''; } else { pp.classList.remove('sheet'); const w=pp.offsetWidth,h=pp.offsetHeight; pp.style.left=Math.min(innerWidth-w-8,x+10)+'px'; pp.style.top=Math.min(innerHeight-h-8,Math.max(8,y-20))+'px'; }
  $('#pp-text').value=''; }
function hidePopup(){ $('#popup').style.display='none'; }
$('#pp-acts').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b||Date.now()-popOpenedAt<350) return; const k=b.dataset.act;
  if(k==='act'){ const sub=$('#pp-sub'); sub.innerHTML=[['trade','Trade'],['spy','Spy'],['propaganda','Propaganda'],['embargo','Embargo'],['demand','Demand land'],['alliance','Propose alliance'],['nap','Non-aggression'],['guarantee','Guarantee'],['peace','Offer peace'],['insult','Denounce']].map(([k,l])=>`<button data-act="${k}">${l}</button>`).join(''); sub.style.display='grid'; return; }
  if(k==='defend') return submit(popTarget===P()?'fortify':'guarantee',popTarget,popRegion);
  submit(k,popTarget,popRegion); });
$('#pp-sub').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; submit(b.dataset.act,popTarget,popRegion); });
$('#pp-form').addEventListener('submit',e=>{ e.preventDefault(); const t=$('#pp-text').value.trim(); if(!t) return; $('#pp-text').blur(); submit('free',popTarget,null,t.slice(0,300)); });
$('#pp-close').onclick=hidePopup;
$('#cmd-form').addEventListener('submit',e=>{ e.preventDefault(); const t=$('#cmd').value.trim(); if(!t) return; $('#cmd').value=''; $('#cmd').blur(); submit('free',null,null,t.slice(0,300)); });

/* ================= MODALS ================= */
function showReport(title,body,bullets,heads){ $('#rp-title').textContent=title; $('#rp-body').innerHTML=body+(bullets.length?`<h4>What changed</h4><ul class="chg">${bullets.join('')}</ul>`:'')+(heads.length?`<h4>Headlines</h4><ul class="hd">${heads.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>`:''); $('#report').style.display='flex';
  $('#rp-body').querySelectorAll('.ex').forEach(b=>b.onclick=()=>{ $('#report').style.display='none'; $('#cmd').value=b.textContent; $('#cmd').focus(); }); }
$('#rp-ok').onclick=()=>{ $('#report').style.display='none'; };
function askDecision(e){ return new Promise(res=>{ showBusy(false); $('#dc-title').textContent=e.title; $('#dc-text').textContent=typeof e.text==='function'?e.text():e.text; $('#dc-opts').innerHTML=e.opts.map((o,i)=>`<button data-i="${i}">${esc(o.t)}</button>`).join(''); $('#decision').style.display='flex';
  $('#dc-opts').querySelectorAll('button').forEach(b=>b.onclick=()=>{ $('#decision').style.display='none'; showBusy(true); res(+b.dataset.i); }); }); }
function showBusy(on){ $('#busy').style.display=on?'flex':'none'; if(!on) $('#busy-t').textContent='The ink is drying…'; }

/* ================= TOOLBAR / SETTINGS ================= */
$('#btn-pass').onclick=passTurn;
$('#btn-save').onclick=()=>{ const c={...S}; delete c._hops; localStorage.setItem('ww2ai.v3.slot'+$('#slot').value,JSON.stringify(c)); log('event',`Saved to slot ${$('#slot').value}.`); renderLog(); };
$('#btn-load').onclick=()=>{ if(!loadFrom('ww2ai.v3.slot'+$('#slot').value)) alert('Slot empty.'); };
$('#btn-export').onclick=()=>{ const a=document.createElement('a'); const c={...S}; delete c._hops; a.href=URL.createObjectURL(new Blob([JSON.stringify(c)],{type:'application/json'})); a.download=`inkiron-${S.y}-${S.m+1}.json`; a.click(); };
$('#btn-import').onclick=()=>$('#importfile').click();
$('#importfile').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ const o=JSON.parse(await f.text()); if(o.v!==3) throw 0; S=o; dirty=true; renderAll(); }catch(err){ alert('Bad save file'); } };
$('#btn-new').onclick=()=>{ if(confirm('Start a new game?')) showStart(); };
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{ document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on')); t.classList.add('on'); document.querySelectorAll('.pane').forEach(p=>p.style.display=p.id===t.dataset.p?'block':'none'); });
$('#rels').addEventListener('click',e=>{ const r=e.target.closest('.rr'); if(!r) return; const n=r.dataset.n, cap=capOf(n); showPopup(n,cap,innerWidth/2,innerHeight/3); });
function setAIStatus(t){ $('#ai-status').textContent='AI: '+t; }
function fillSettings(){ $('#s-enabled').checked=CFG.enabled; $('#s-kind').value=CFG.kind; $('#s-base').value=CFG.base; $('#s-model').value=CFG.model; $('#s-timeout').value=CFG.timeout; $('#s-temp').value=CFG.temperature;
  $('#hosted-note').style.display=HOSTED?'block':'none'; document.querySelectorAll('#settings .llm input,#settings .llm select,#settings .llm button').forEach(x=>x.disabled=HOSTED);
  $('#wl-gpu').textContent=('gpu' in navigator)?'WebGPU detected ✔':'No WebGPU in this browser ✖ (on iPhone needs iOS 26+)'; $('#wl-load').disabled=!('gpu' in navigator)||!!WEBLLM; }
function readSettings(){ if(HOSTED) return; CFG.enabled=$('#s-enabled').checked; CFG.kind=$('#s-kind').value; CFG.base=$('#s-base').value.trim(); CFG.model=$('#s-model').value.trim(); CFG.timeout=+$('#s-timeout').value||60; CFG.temperature=+$('#s-temp').value||0.4; saveCfg(); }
$('#btn-settings').onclick=()=>{ fillSettings(); $('#settings').style.display='flex'; };
$('#start-settings').onclick=()=>$('#btn-settings').click();
$('#s-close').onclick=()=>{ readSettings(); $('#settings').style.display='none'; if(!WEBLLM) setAIStatus(llmReady()?`${CFG.kind} · ${CFG.model}`:'rules engine + order parser'); };
async function runDetect(){ $('#s-detect-out').textContent='Scanning localhost…'; const {found,hintModels}=await autodetect();
  if(!found.length){ $('#s-detect-out').textContent='No local model server found. The rules engine + order parser will run the game.'; return false; }
  const f=found[0]; CFG.kind=f.kind; CFG.base=f.base; CFG.model=pickModel(f.models,hintModels); saveCfg(); fillSettings(); $('#s-modellist').innerHTML=f.models.map(m=>`<option value="${esc(m)}">`).join('');
  $('#s-detect-out').textContent=`Found ${f.kind} at ${f.base}: ${f.models.join(', ')}`; setAIStatus(`${f.kind} · ${CFG.model}`); return true; }
$('#s-detect').onclick=runDetect;
$('#s-test').onclick=async()=>{ readSettings(); $('#s-detect-out').textContent='Asking the model…'; const t0=performance.now(); try{ const v=validateIntent(await llmRaw(intentPrompt('Invade Poland',null))); $('#s-detect-out').textContent=`OK in ${((performance.now()-t0)/1000).toFixed(1)}s → ${v.intent} ${v.target||''}: "${v.reply}"`; }catch(e){ $('#s-detect-out').textContent='Test failed: '+e.message; } };
$('#wl-load').onclick=async()=>{ const id=$('#wl-model').value; if(!confirm(`Download the on-device AI model (${$('#wl-model').selectedOptions[0].dataset.size})? It is cached by your browser afterwards. Use Wi-Fi.`)) return; $('#wl-load').disabled=true;
  try{ const got=await loadWebLLM(id); $('#wl-out').textContent='Loaded '+got+'. Typed orders now go through the on-device AI (parser still checks).'; }catch(e){ $('#wl-out').textContent='Could not load on-device AI: '+e.message+' — the rules engine + parser keep working.'; WEBLLM=null; $('#wl-load').disabled=false; } };

function fillB2(){ if(!window.B2Link) return; const c=B2Link.cfg(); $('#b2-enabled').checked=c.enabled; $('#b2-repo').value=c.repo||''; $('#b2-wh').checked=c.wake==='webhook'; $('#b2-prnum').value=c.pr||1;
  ['b2-hook','b2-key','b2-token'].forEach(id=>{ $('#'+id).value=''; });
  $('#b2-state').textContent=`Stored in this browser only: token ${c.token?'✔':'—'} · wake: ${c.wake==='webhook'?'webhook':'PR #'+(c.pr||1)+' comment'}${c.wake==='webhook'?` · webhook ${c.hookUrl?'✔':'—'} · key ${c.hookKey?'✔':'—'}`:''} · ${B2Link.ready()?'READY (B2 is the AI)':'not active'}`; }
function saveB2(){ if(!window.B2Link) return; const c=B2Link.cfg(), patch={enabled:$('#b2-enabled').checked, repo:$('#b2-repo').value.trim()||c.repo, wake:$('#b2-wh').checked?'webhook':'ghcomment', pr:+$('#b2-prnum').value||1};
  [['b2-hook','hookUrl'],['b2-key','hookKey'],['b2-token','token']].forEach(([id,k])=>{ const v=$('#'+id).value.trim(); if(v) patch[k]=v; }); B2Link.saveCfg(patch); fillB2(); }
$('#b2-save').onclick=()=>{ saveB2(); };
$('#b2-forget').onclick=()=>{ if(window.B2Link){ B2Link.forget(); fillB2(); $('#b2-out').textContent='B2 credentials removed from this browser.'; } };
$('#b2-test').onclick=async()=>{ saveB2(); const c=B2Link.cfg(); const out=$('#b2-out'); if(!c.repo||!c.token){ out.textContent='Need the turns repo and the token.'; return; } out.textContent='Checking GitHub access…';
  try{ const r=await fetch(`https://api.github.com/repos/${c.repo}`,{headers:{'Authorization':'Bearer '+c.token,'Accept':'application/vnd.github+json'}});
    if(!r.ok){ out.textContent=`GitHub said HTTP ${r.status} — check the token/repo.`; return; }
    const pv=(await r.json()).private; out.textContent=`Token OK: ${c.repo} is reachable (${pv?'private':'PUBLIC — should be private!'}). Sending a probe to B2…`;
    if(c.wake==='webhook'&&(!c.hookUrl||!c.hookKey)){ out.textContent+=' Webhook URL/key missing.'; return; }
    const head=out.textContent; const res=await B2Link.probe({onStatus:t=>out.textContent=head+'\n'+t});
    out.textContent=head+'\n'+(res.ok?`B2 answered: "${String(res.msg).slice(0,160)}"`:res.stage==='wake'?`Could not wake B2: ${res.msg}.`+(/403|404/.test(res.msg)?' The token needs "Pull requests: write" on this repo.':''):`B2 problem: ${res.msg}`); }
  catch(e){ out.textContent='Test failed: '+e.message+' (network). The rules engine will be used.'; } };
$('#btn-settings').addEventListener('click',fillB2);

/* ================= START ================= */
function showStart(){ const majors=NAT.filter(n=>D.N[n][8]), minors=NAT.filter(n=>!D.N[n][8]&&n!=='NSP');
  const btn=n=>`<button class="nb" data-n="${n}"><span class="sw" style="background:${D.N[n][1]}"></span>${esc(nm(n))}<small>${IDEO(n)}</small></button>`;
  $('#start-majors').innerHTML=majors.map(btn).join(''); $('#start-minors').innerHTML=minors.map(btn).join('');
  $('#start').style.display='flex'; $('#start-continue').style.display=localStorage.getItem(SAVE_KEY)?'inline-block':'none';
  document.querySelectorAll('#start .nb').forEach(b=>b.onclick=()=>{ $('#start').style.display='none'; newGame(b.dataset.n); }); }
$('#start-continue').onclick=()=>{ if(loadFrom(SAVE_KEY)){ $('#start').style.display='none'; centerOn(P()); } };

window.WW2={ get state(){return S;}, REG, ADJ, LANDADJ, parseIntent, validateIntent, validateResult, applyResult, b2Ready, rel, act, frontCalc, eff, endMonth, submit, passTurn, get hosted(){return HOSTED;}, get cfg(){return CFG;}, VW,
  regionXY(rid){ const [x,y]=toPx(REG[rid].lon,REG[rid].lat); const b=canvas.getBoundingClientRect(); return [b.left+x*b.width/canvas.width, b.top+y*b.height/canvas.height]; },
  focus(rid,s){  const [x,y]=toPx(REG[rid].lon,REG[rid].lat); VW.s=VW.fit*(s||6); VW.x=wrap.clientWidth/2-x*VW.s; VW.y=wrap.clientHeight/2-y*VW.s; applyView(); }, cellOwnerAt(rid){ return S.owner[rid]; },
  regionPixels(rid){ const i=RIDS.indexOf(rid), out=[]; for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(GRID[r*COLS+c]===i){ const d=ctx.getImageData(c*CS+1,r*CS+1,1,1).data; out.push([d[0],d[1],d[2]]); } return out; }, pixelAt(rid){ const [x,y]=toPx(REG[rid].lon,REG[rid].lat); const d=ctx.getImageData(Math.round(x)+6,Math.round(y)+6,1,1).data; return [d[0],d[1],d[2]]; }, RGB };
(async function init(){ await detectProxy(); fitView(); showStart();
  if(HOSTED) setAIStatus('rules engine + order parser (optional on-device AI in Settings)');
  else if(CFG.enabled&&(CFG.kind==='auto'||!CFG.model)){ fillSettings(); runDetect(); } else setAIStatus(llmReady()?`${CFG.kind} · ${CFG.model}`:'rules engine + order parser'); })();
})();
