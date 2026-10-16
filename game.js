/* INK & IRON v4 — world-scale alternate-history WWII. Rules-only: diplomacy, intrigue, economy and war
   resolved by a deterministic-ish rules engine. No AI, no network calls. */
(function(){
'use strict';
const D = window.WW2DATA;
const $ = s => document.querySelector(s);
const NAT = Object.keys(D.N);
const REG = {}; D.R.forEach(r => REG[r[0]] = {id:r[0], name:r[1], home:r[2], lon:r[3], lat:r[4], t:r[5][0], river:r[5].includes('r')});
const RIDS = Object.keys(REG);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SAVE_KEY='ww2ai.v4.autosave';
['b2link.cfg','b2link.gid','b2link.notes','ww2ai.settings'].forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} }); // AI removed: wipe any stored AI/B2 credentials
const TERR = {p:['plains',1], f:['forest',1.3], m:['mountains',1.8], s:['marsh',1.4], d:['desert',1.15], j:['jungle',1.5], a:['arctic',1.5]};
let S=null, busy=false;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rnd(){ S.seed=(S.seed*1664525+1013904223)>>>0; return S.seed/4294967296; }
const pick=a=>a[Math.floor(rnd()*a.length)];
const nm=c=>(D.N[c]||[c])[0];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ================= MAP GRID ================= */
const LON0=-180, LON1=180, LAT0=-56, LAT1=84, KX=0.8, STEP=0.2, CS=3;
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
const COAST=new Set(); for(let r=1;r<ROWS-1;r++) for(let c=1;c<COLS-1;c++){ const a=GRID[r*COLS+c]; if(a>=0&&(GRID[r*COLS+c+1]<0||GRID[r*COLS+c-1]<0||GRID[(r+1)*COLS+c]<0||GRID[(r-1)*COLS+c]<0)) COAST.add(RIDS[a]); }

/* ================= STATE ================= */
const rk=(a,b)=>a<b?a+'|'+b:b+'|'+a;
const IDEO=c=>(S&&S.ideo&&S.ideo[c])||D.N[c][3];
function ideoAff(a,b){ const ia=IDEO(a), ib=IDEO(b); if(ia===ib) return 20; if((ia==='communist')!==(ib==='communist')) return -25; if((ia==='fascist'&&ib==='democratic')||(ib==='fascist'&&ia==='democratic')) return -15; return 0; }
function newGame(player){
  S={v:4, betray:[], factions:[], ideo:{}, occ:{}, seed:(Date.now()>>>0)||7, player, y:1935, m:11, turn:0, owner:{}, rel:{}, wars:[], treaties:[], nat:{}, fort:{}, fronts:[], tension:22, ev:{}, log:[], news:[], claims:{}, flash:[], lastCap:{}};
  RIDS.forEach(id=>S.owner[id]=REG[id].home);
  NAT.forEach(c=>{ const n=D.N[c]; const regs=RIDS.filter(r=>REG[r].home===c).length; S.nat[c]={army:n[4], ind:n[5], q:n[6], mp:n[4]*6+regs*8, gold:40+n[5]*3, bud:defaultBud(c), stab:60, alive:regs>0, start:regs, pp:n[8]?90:50, arm:({GER:2,SOV:3,FRA:2,UK:1,ITA:1,USA:1,JAP:1})[c]||0, art:Math.round(n[4]*0.2), air:Math.round(n[5]*0.3*10)/10, nav:({UK:12,USA:9,JAP:8,FRA:5,ITA:4,GER:2,SOV:2,NED:2})[c]??(n[5]>=3?1:0), wareco:false}; });
  (D.PUPPETS||[]).forEach(([m,s])=>{ S.treaties.push({type:'puppet',a:m,b:s,t:0},{type:'alliance',a:m,b:s}); S.rel[rk(m,s)]=Math.max(S.rel[rk(m,s)]||0,60); });
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
  S.lastReport=null; autosave(); dirty=true; renderAll(); centerOn(player);
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
const eff=c=>{ const n=S.nat[c]; return (n.army+2.8*(n.arm||0)+0.9*(n.art||0)+0.6*(n.air||0))*n.q*(0.7+n.stab/200); };
const capOf=c=>{ const cap=D.N[c][7]; return S.owner[cap]===c?cap:regionsOf(c)[0]; };
function borderRegs(a,b,landOnly){ const A=landOnly?LANDADJ:ADJ; return regionsOf(b).filter(r=>[...A[r]].some(x=>S.owner[x]===a)); }
const neighbours=c=>{ const s=new Set(); regionsOf(c).forEach(r=>ADJ[r].forEach(x=>{ const o=S.owner[x]; if(o!==c) s.add(o); })); return [...s].filter(alive); };
function log(kind,text){ S.log.unshift({d:dateStr(),kind,text}); if(S.log.length>400) S.log.length=400; }
function news(t){ S.news.unshift(t); if(S.news.length>14) S.news.length=14; }
function hops(c){ // BFS distance through own territory from capital (cached per turn)
  S._hops=S._hops||{}; const key=c+S.turn+':'+regionsOf(c).length; if(S._hops[c]&&S._hops[c].k===key) return S._hops[c].d;
  const d={}, cap=capOf(c); if(cap){ d[cap]=0; const q=[cap]; if((S.nat[c].nav||0)>=1) regionsOf(c).forEach(r=>{ if(COAST.has(r)&&r!==cap){ d[r]=3; q.push(r); } }); while(q.length){ const r=q.shift(); for(const x of LANDADJ[r]) if(S.owner[x]===c&&d[x]==null){ d[x]=d[r]+1; q.push(x);} } }
  S._hops[c]={k:key,d}; return d; }

/* ================= WAR & COMBAT ================= */
function declareWar(a,b,motive,silentJoin){
  if(a===b||atWar(a,b)||!alive(a)||!alive(b)) return;
  const broken=pactsBetween(a,b).filter(t=>['alliance','puppet','guarantee','non_aggression','access'].includes(t.type)); if(broken.length){ leaveFactionPair(a,b); betray(a,b,broken.sort((x,y)=>BINDING.indexOf(x.type)-BINDING.indexOf(y.type))[0].type); }
  S.wars.push({a,b,since:dateStr(),m:0,motive});
  S.treaties=S.treaties.filter(t=>!((t.a===a&&t.b===b)||(t.a===b&&t.b===a)));
  addRel(a,b,-50); S.tension=clamp(S.tension+(D.N[a][8]||D.N[b][8]?8:4),0,100);
  log('war',`⚔ ${nm(a)} declares war on ${nm(b)}. Motive: ${motive}.`); news(`${dateStr()}: ${nm(a).toUpperCase()} DECLARES WAR ON ${nm(b).toUpperCase()}`);
  const joiners=[...new Set(alliesOf(b).concat(guarantorsOf(b)))].filter(x=>x!==a&&!atWar(x,a)&&!alliesOf(a).includes(x));
  for(const x of joiners){ const p=x===S.player?1:(alliesOf(b).includes(x)?0.85:0.75)*(rel(x,b)>20?1:0.5); if(rnd()<p){ S.wars.push({a:x,b:a,since:dateStr(),m:0,motive:`honouring its pact with ${nm(b)}`}); addRel(x,a,-40); log('war',`⚔ ${nm(x)} joins the war against ${nm(a)}, honouring its pact with ${nm(b)}.`); news(`${nm(x)} enters the war`); } }
  // puppets follow masters
  S.treaties.filter(t=>t.type==='puppet'&&t.a===a).map(t=>t.b).concat(alliesOf(a).filter(x=>['MAN','MON'].includes(x))).filter(x=>alive(x)&&!atWar(x,b)&&x!==b).forEach(x=>S.wars.push({a:x,b,since:dateStr(),m:0,motive:`following ${nm(a)}`}));
}
function makePeace(a,b,why){ S.wars=S.wars.filter(w=>!((w.a===a&&w.b===b)||(w.a===b&&w.b===a))); S.fronts=S.fronts.filter(f=>!((f.a===a&&f.d===b)||(f.a===b&&f.d===a))); log('peace',`🕊 ${nm(a)} and ${nm(b)} make peace${why?' — '+why:''}.`); news(`Peace between ${nm(a)} and ${nm(b)}`); }
function pickTarget(a,d,prefer){
  if(prefer&&S.owner[prefer]===d&&[...ADJ[prefer]].some(x=>S.owner[x]===a)) return prefer;
  const cand=borderRegs(a,d,false); S.treaties.filter(t=>t.type==='access'&&(t.a===a||t.b===a)).map(t=>t.a===a?t.b:t.a).forEach(x=>regionsOf(d).forEach(r=>{ if(!cand.includes(r)&&[...ADJ[r]].some(y=>S.owner[y]===x)) cand.push(r); })); if(!cand.length) return null;
  const hd=hops(d), land=new Set(borderRegs(a,d,true));
  const score=x=>{ const T=TERR[REG[x].t][1]+(REG[x].river?0.25:0); return T*(1+0.2*(S.fort[x]||0))*(D.N[d][7]===x?1.4:1)*(land.has(x)?1:1.7)*10+(hd[x]??20)*0.5; };
  cand.sort((x,y)=>score(x)-score(y)); return cand[0]; }
function openFront(a,d,prefer){ const ex=S.fronts.find(f=>f.a===a&&f.d===d); if(ex){ if(prefer&&prefer!==ex.r){ const t=pickTarget(a,d,prefer); if(t&&t!==ex.r){ ex.r=t; ex.prog=Math.min(ex.prog,20);} } return ex; }
  const r=pickTarget(a,d,prefer); if(!r) return null; const f={a,d,r,prog:0}; S.fronts.push(f); return f; }
function frontCalc(f){
  const a=f.a, d=f.d, r=f.r, nA=S.fronts.filter(x=>x.a===a).length, nD=Math.max(1,enemiesOf(d).length);
  const landLink=[...LANDADJ[r]].some(x=>S.owner[x]===a); const hd=hops(a); const nearest=Math.min(...[...ADJ[r]].filter(x=>S.owner[x]===a).map(x=>hd[x]??12));
  const oos=!isFinite(nearest)||nearest>14; const navR=(S.nat[a].nav+0.5)/(S.nat[a].nav+S.nat[d].nav+1); const supply=oos?0.35:clamp(1.1-nearest*0.04,0.45,1)*(landLink?1:clamp(0.25+0.7*navR,0.25,0.9));
  const airA=S.nat[a].air||0, airD=S.nat[d].air||0, airSup=(airA-airD)/(airA+airD+2);
  const T=TERR[REG[r].t]; const terr=T[1]+(REG[r].river?0.25:0); const fort=1+0.2*(S.fort[r]||0); const cap=(D.N[d][7]===r)?1.4:1;
  const A=eff(a)*0.8/Math.max(1,nA)*supply*(1+0.25*airSup);
  let Dd=eff(d)*0.5/nD*terr*fort*cap*1.25*(1+0.4*(S.nat[d].art||0)/Math.max(4,S.nat[d].army))*(1-0.15*airSup);
  let help=0; enemiesOf(a).filter(x=>x!==d&&[...LANDADJ[r]].some(y=>S.owner[y]===x)).forEach(x=>help+=eff(x)*0.25/Math.max(1,enemiesOf(x).length)); Dd+=help;
  return {A, D:Dd, ratio:A/Math.max(0.3,Dd), supply, oos, airA, airD, terr:T[0]+(REG[r].river?' + river':''), fort:S.fort[r]||0, help};
}
function resolveFront(f){
  if(!atWar(f.a,f.d)||!alive(f.a)||!alive(f.d)) return 'drop';
  if(S.owner[f.r]!==f.d||![...ADJ[f.r]].some(x=>S.owner[x]===f.a)){ const t=pickTarget(f.a,f.d); if(!t) return 'drop'; f.r=t; f.prog=0; }
  const c=frontCalc(f); const delta=clamp(40*(c.ratio-0.8)*(0.75+rnd()*0.5),-15,45);
  f.prog=clamp(f.prog+delta,0,100);
  const la=Math.min(S.nat[f.a].army*0.06, 0.03*c.D*(1.2/Math.sqrt(Math.max(0.2,c.ratio)))), ld=Math.min(S.nat[f.d].army*0.06, 0.03*c.A*Math.sqrt(c.ratio));
  const harsh=['m','j','a','s'].includes(REG[f.r].t)?0.01:0, attr=S.nat[f.a].army*(0.008+harsh+(c.oos?0.03:0));
  const hit=(n,l)=>{ n.army=Math.max(0.5,n.army-l*0.8); n.arm=Math.max(0,(n.arm||0)-l*0.08); n.art=Math.max(0,(n.art||0)-l*0.05); n.air=Math.max(0,(n.air||0)-l*0.03); };
  hit(S.nat[f.a],la+attr); hit(S.nat[f.d],ld);
  f.last={delta:Math.round(delta), ratio:+c.ratio.toFixed(2), la:+(la+attr).toFixed(1), ld:+ld.toFixed(1), terr:c.terr, supply:+c.supply.toFixed(2), fort:c.fort, oos:c.oos};
  if(f.prog>=100){ capture(f.a,f.r,f.d); f.prog=0; const t=pickTarget(f.a,f.d); if(!t) return 'drop'; f.r=t; }
  return 'ok';
}
function capture(a,r,d){
  S.owner[r]=a; S.flash.push(r); S.fort[r]=Math.max(0,(S.fort[r]||0)-1); S.lastCap[r]=S.turn; if(REG[r].home!==a) S.occ[r]={t:S.turn,res:10}; else delete S.occ[r];
  const share=S.nat[d].ind/Math.max(1,regionsOf(d).length+1)*0.6; S.nat[d].ind=Math.max(0.5,S.nat[d].ind-share); S.nat[a].ind+=share*0.5;
  S.nat[d].stab=clamp(S.nat[d].stab-6,0,100); S.nat[a].stab=clamp(S.nat[a].stab+2,0,100);
  log('border',`🏴 ${nm(a)} captures ${REG[r].name} from ${nm(d)}.`); news(`${REG[r].name} falls to ${nm(a)}`);
  checkCapitulation(d,a);
}
function checkCapitulation(d,a){
  const regs=regionsOf(d); const lostCap=S.owner[D.N[d][7]]!==d;
  if(!regs.length || (lostCap && (regs.length<=S.nat[d].start*0.6 || S.nat[d].army<2 || S.nat[d].stab<20))){
    regs.forEach(r=>{ S.owner[r]=a; S.flash.push(r); S.occ[r]={t:S.turn,res:15}; });
    S.nat[d].alive=false; S.wars=S.wars.filter(w=>w.a!==d&&w.b!==d); S.fronts=S.fronts.filter(f=>f.a!==d&&f.d!==d); S.treaties=S.treaties.filter(t=>t.a!==d&&t.b!==d);
    S.tension=clamp(S.tension+6,0,100); log('war',`☠ ${nm(d)} capitulates. Its lands pass to ${nm(a)}.`); news(`${nm(d).toUpperCase()} CAPITULATES`);
    return true; } return false;
}
function transfer(r,to,why){ const from=S.owner[r]; if(from===to) return; S.owner[r]=to; S.flash.push(r); if(REG[r].home!==to) S.occ[r]={t:S.turn,res:why&&/ceded|concession/.test(why)?5:10}; else delete S.occ[r]; log('border',`🏴 ${REG[r].name} passes from ${nm(from)} to ${nm(to)}${why?' — '+why:''}.`); if(!regionsOf(from).length){ S.nat[from].alive=false; S.wars=S.wars.filter(w=>w.a!==from&&w.b!==from); S.fronts=S.fronts.filter(f=>f.a!==from&&f.d!==from); S.treaties=S.treaties.filter(t=>t.a!==from&&t.b!==from); log('border',`${nm(from)} ceases to exist.`);} }

/* ================= ECONOMY ================= */
function economyTick(){
  for(const c of NAT){ const n=S.nat[c]; if(!n.alive) continue; const regs=regionsOf(c).length; const war=enemiesOf(c).length>0;
    if(c!==S.player) n.bud=clamp(defaultBud(c)+S.tension/300+(war?0.2:0),0.1,0.7);
    n.gold=clamp(n.gold + n.ind*0.9 - n.army*0.04 - (war?n.ind*0.15:0), -50, 999);
    n.mp=Math.min(n.mp + 0.8 + regs*0.25 + n.ind*0.05, 60+regs*20);
    let g=n.ind*n.bud*0.09*(n.gold<0?0.4:1); const need=g*6; if(n.mp<need) g=n.mp/6; n.army+=g; n.mp-=g*6;
    const growth=(n.ind*(1-n.bud)*0.005+0.01)*(n.stab<35?0.5:1); n.ind+=growth;
    n.stab=clamp(n.stab+(war?-1.2:0)+(n.stab<60?0.6:-0.3)+(n.gold<0?-2:0),0,100);
    if(c==='GER'&&S.y>=1936) n.q=Math.min(1.3,n.q+0.002);
    n.pp=Math.min(200,(n.pp||0)+4+n.stab/25);
    n.gold+=S.treaties.filter(t=>t.type==='trade'&&(t.a===c||t.b===c)).length;
    const m=masterOf(c); if(m&&alive(m)){ const tr=n.ind*0.1; n.gold-=tr; S.nat[m].gold+=tr; }
    n.gold-=(n.arm||0)*0.15+(n.air||0)*0.1+(n.nav||0)*0.2;
    if(n.wareco){ n.army+=g*0.35; n.ind-=growth*0.4; n.stab-=0.3; }
    if(n.ind>=8&&c!==S.player){ n.arm=(n.arm||0)+g*0.1; n.art=(n.art||0)+g*0.12; n.air=(n.air||0)+n.ind*0.004; if(MAJOR(c)&&coastal(c)) n.nav=(n.nav||0)+n.ind*0.002; } }
  // occupation & resistance
  for(const r in S.occ){ const o=S.occ[r], c=S.owner[r], h=REG[r].home; if(c===h||!alive(c)){ delete S.occ[r]; continue; }
    o.res=clamp(o.res+2+(alive(h)?2:0)+(alive(h)&&atWar(c,h)?2:0)+(ideoAff(c,h)<0?1:0)-(S.nat[c].army>40?1:0),0,100);
    S.nat[c].gold-=0.3+o.res/60; S.nat[c].army=Math.max(0.5,S.nat[c].army-o.res/2000);
    if(c!==S.player&&o.res>60&&S.nat[c].gold>20&&rnd()<0.3){ o.res-=25; S.nat[c].gold-=15; }
    if(o.res>=100){ if(alive(h)&&rnd()<0.5){ transfer(r,h,'a popular uprising'); news(`Uprising: ${REG[r].name} throws out ${nm(c)}`); } else { o.res=60; S.nat[c].army=Math.max(0.5,S.nat[c].army-1); log('event',`Partisans ambush ${nm(c)}'s garrison in ${REG[r].name}.`); } } }
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

/* ================= ACTIONS: diplomacy / intrigue / economy / military (rules only) ================= */
const P=()=>S.player;
const MAJOR=c=>!!D.N[c][8];
const decay=(t,span)=>Math.max(0,1-(S.turn-t)/span);
const TNAME={alliance:'alliance',non_aggression:'non-aggression pact',guarantee:'guarantee',trade:'trade deal',access:'military-access treaty',puppet:'protectorate treaty',embargo:'embargo'};
function grudge(x,by){ return (S.betray||[]).filter(b=>b.victim===x&&b.by===by).reduce((s,b)=>s+55*decay(b.t,60),0); }
function rep(by,except){ return (S.betray||[]).filter(b=>b.by===by&&b.victim!==except).reduce((s,b)=>s+16*decay(b.t,48),0); }
function betray(by,victim,type){ S.betray.push({by,victim,type,t:S.turn,d:dateStr()}); addRel(by,victim,-40);
  NAT.filter(x=>alive(x)&&x!==by&&x!==victim&&(MAJOR(x)||neighbours(by).includes(x))).forEach(x=>addRel(by,x,-8));
  log('betrayal',`🗡 ${nm(by)} betrays ${nm(victim)} by breaking their ${TNAME[type]||type}. ${nm(victim)} will remember for years; every chancellery takes note.`);
  news(`${nm(by).toUpperCase()} TEARS UP ITS ${(TNAME[type]||type).toUpperCase()} WITH ${nm(victim).toUpperCase()}`); }
const pactsBetween=(a,b)=>S.treaties.filter(t=>(t.a===a&&t.b===b)||(t.a===b&&t.b===a));
const BINDING=['alliance','puppet','guarantee','non_aggression','access','trade'];
const factionOf=c=>S.factions.find(f=>f.members.includes(c));
const factionLed=c=>S.factions.find(f=>f.leader===c);
function leaveFactionPair(a,b){ const f=factionOf(a); if(f&&f.members.includes(b)){ f.members=f.members.filter(x=>x!==a); if(f.leader===a) f.leader=f.members[0]; if(f.members.length<2) S.factions=S.factions.filter(x=>x!==f); } }
function breakPacts(a,b){ const ps=pactsBetween(a,b).filter(t=>BINDING.includes(t.type)); if(!ps.length) return []; S.treaties=S.treaties.filter(t=>!ps.includes(t)); leaveFactionPair(a,b);
  betray(a,b,ps.slice().sort((x,y)=>BINDING.indexOf(x.type)-BINDING.indexOf(y.type))[0].type); return ps; }
const isPuppet=(m,s)=>S.treaties.some(t=>t.type==='puppet'&&t.a===m&&t.b===s);
const masterOf=s=>{ const t=S.treaties.find(t=>t.type==='puppet'&&t.b===s); return t?t.a:null; };
const coastal=c=>regionsOf(c).some(r=>COAST.has(r));
function warScore(a,T){ const mine=RIDS.filter(r=>S.owner[r]===a&&REG[r].home===T).length, theirs=RIDS.filter(r=>S.owner[r]===T&&REG[r].home===a).length;
  return (mine-theirs)/Math.max(1,S.nat[T].start)*100+(eff(a)-eff(T))/Math.max(1,eff(T))*20+(100-S.nat[T].stab)/3; }
function colonyOf(T){ const cap=capOf(T); if(!cap) return []; return regionsOf(T).filter(r=>Math.hypot(REG[r].lon-REG[cap].lon,REG[r].lat-REG[cap].lat)>28); }
function demandRatio(a,T){ return eff(a)/Math.max(0.5,coalition(T,a).reduce((s,x)=>s+eff(x)*(x===T?1:0.6),0)); }
/* acceptance model: every factor is shown to the player before committing */
function accept(a,T,base,extra){ const f=[]; const add=(l,v)=>{ if(Math.abs(v)>=0.005) f.push([l,v]); };
  add('base',base); add(`relations ${rel(a,T)}`,rel(a,T)/160); add(ideoAff(a,T)>=0?'kindred regimes':'hostile ideologies',ideoAff(a,T)/100);
  const g=grudge(T,a); if(g>1){ const b=S.betray.filter(x=>x.victim===T&&x.by===a).slice(-1)[0]; add(`remembers your betrayal (${TNAME[b.type]||b.type}, ${b.d})`,-g/100); }
  const r=rep(a,T); if(r>1) add('your record of broken treaties',-r/100);
  (extra||[]).forEach(([l,v])=>add(l,v));
  return {p:clamp(f.reduce((s,x)=>s+x[1],0),0.02,0.97),f}; }
const pct=p=>Math.round(p*100)+'%';
function reasons(od,neg=true){ return od.f.filter(x=>x[0]!=='base'&&(neg?x[1]<0:x[1]>0)).sort((x,y)=>neg?x[1]-y[1]:y[1]-x[1]).slice(0,3).map(x=>x[0]).join('; '); }
const refuse=(a,T,what,od)=>`${nm(T)} refuses ${nm(a)}'s ${what}. Reason: ${reasons(od)||'the cabinet votes no despite the odds'}. (${pct(od.p)} chance)`;
const accepted=(T,od)=>`${nm(T)} accepts (${pct(od.p)} chance; ${reasons(od,false)||'favourable terms'}).`;
const addT=(type,a,b,extra)=>{ if(!hasT(type,a,b)) S.treaties.push(Object.assign({type,a,b,t:S.turn},extra||{})); };
const notWar=(a,T)=>atWar(a,T)?`You are at war with ${nm(T)}.`:null;
const BUILD={inf:[20,10,0,'Infantry (+2 div)'],arm:[45,6,8,'Armour (+1 div, 2.8× punch)'],art:[25,5,4,'Artillery (+1 div, +defence)'],air:[35,2,6,'Air wing (+1)'],nav:[50,3,6,'Fleet (+1)']};
/* id: [tab, scope, label, cost(a,T)->{gold,pp,mp}, pre(a,T)->reason|null, odds(a,T)->{p,f}|null, run(a,T,ok,od)->text, info?] */
const AX={
 improve:['diplomacy','other','Improve relations',()=>({pp:15}),(a,T)=>notWar(a,T),null,(a,T)=>{ const g=Math.max(2,Math.round(8+rnd()*6+ideoAff(a,T)/10-grudge(T,a)/10)); addRel(a,T,g); return `Envoys from ${nm(a)} court ${nm(T)} with dinners and trade fairs. Relations +${g} → ${rel(a,T)}.`; }],
 alliance:['diplomacy','other','Propose alliance',()=>({pp:40}),(a,T)=>notWar(a,T)||(hasT('alliance',a,T)?'Already allied.':null)||(masterOf(T)&&masterOf(T)!==a?`${nm(T)} answers to ${nm(masterOf(T))}.`:null),
   (a,T)=>{ const se=enemiesOf(a).some(e=>enemiesOf(T).includes(e))||NAT.some(x=>alive(x)&&rel(a,x)<-40&&rel(T,x)<-40); const el=enemiesOf(a).some(e=>hasT('alliance',T,e));
     return accept(a,T,-0.35,[['common enemy',se?0.3:0],['allied to your enemy',el?-0.6:0],['you are at war and would drag them in',enemiesOf(a).length&&!se?-0.2:0],['your military weight',clamp((eff(a)-eff(T))/(eff(T)+5)*0.05,-0.1,0.15)],['same faction',factionOf(a)&&factionOf(a)===factionOf(T)?0.3:0]]); },
   (a,T,ok,od)=>{ if(!ok){ addRel(a,T,2); return refuse(a,T,'offer of alliance',od); } addT('alliance',a,T); addRel(a,T,10); S.tension+=2; return `${accepted(T,od)} ${nm(a)} and ${nm(T)} sign a military alliance — an attack on one is an attack on both.`; }],
 nap:['diplomacy','other','Non-aggression pact',()=>({pp:20}),(a,T)=>notWar(a,T)||(hasT('non_aggression',a,T)?'A pact already exists.':null),
   (a,T)=>accept(a,T,0.05,[['they fear your army',eff(a)>1.5*eff(T)?0.25:0],['shared border',neighbours(a).includes(T)?0.05:0],['they are busy elsewhere',enemiesOf(T).length?0.15:0]]),
   (a,T,ok,od)=>{ if(!ok){ addRel(a,T,1); return refuse(a,T,'non-aggression pact',od); } addT('non_aggression',a,T); addRel(a,T,8); return `${accepted(T,od)} ${nm(a)} and ${nm(T)} sign a ten-year non-aggression pact. Few believe it will last ten years.`; }],
 trade:['economy','other','Trade deal',()=>({pp:10}),(a,T)=>notWar(a,T)||(hasT('trade',a,T)?'Already trading.':null)||(hasT('embargo',a,T)||hasT('embargo',T,a)?'An embargo is in force.':null),
   (a,T)=>accept(a,T,0.35,[['raw materials for their industry',S.nat[a].ind>S.nat[T].ind?0.1:0.05]]),
   (a,T,ok,od)=>{ if(!ok) return refuse(a,T,'trade deal',od); addT('trade',a,T); const g=Math.round(5+S.nat[T].ind*0.4); S.nat[a].gold+=g; S.nat[T].gold+=g/2; addRel(a,T,6); return `${accepted(T,od)} Freighters of coal, ore and grain sail between ${nm(a)} and ${nm(T)}: +${g} gold now and +1 gold/month while it lasts.`; }],
 guarantee:['diplomacy','other','Guarantee independence',()=>({pp:25}),(a,T)=>notWar(a,T)||(hasT('guarantee',a,T)?'Already guaranteed.':null)||(MAJOR(T)?'Great powers do not need guarantees.':null)||(!MAJOR(a)&&eff(a)<eff(T)?'Too weak to guarantee anyone.':null),null,
   (a,T)=>{ addT('guarantee',a,T); addRel(a,T,15); const foes=NAT.filter(x=>alive(x)&&x!==a&&(S.claims[x]||[]).some(r=>S.owner[r]===T)); foes.forEach(x=>addRel(a,x,-12)); return `${nm(a)} guarantees the independence of ${nm(T)}: attack them and you fight ${nm(a)}.${foes.length?` ${foes.map(nm).join(', ')} call it a provocation.`:''}`; }],
 access:['diplomacy','other','Request military access',()=>({pp:15}),(a,T)=>notWar(a,T)||(hasT('access',a,T)?'Access already granted.':null),
   (a,T)=>accept(a,T,-0.15,[['allies',hasT('alliance',a,T)?0.55:0],['they fear you',eff(a)>3*eff(T)?0.2:0],['it would anger their friends',enemiesOf(a).some(e=>rel(T,e)>30)?-0.25:0]]),
   (a,T,ok,od)=>{ if(!ok) return refuse(a,T,'request for military access',od); addT('access',a,T); return `${accepted(T,od)} ${nm(a)}'s troops may now march through ${nm(T)} to reach their enemies.`; }],
 faction_form:['diplomacy','self','Form a faction',()=>({pp:50}),(a)=>factionOf(a)?`Already in ${factionOf(a).name}.`:(!MAJOR(a)&&S.nat[a].ind<8?'Only a great power (or industry 8+) can lead a faction.':null),null,
   (a)=>{ const base={fascist:'Iron Pact',communist:'Comintern',democratic:'Entente',authoritarian:'Concord'}[IDEO(a)]; const name=S.factions.some(f=>f.name===base)?`${nm(a)} ${base}`:base; S.factions.push({name,leader:a,members:[a]}); S.nat[a].stab+=3; S.tension+=2; log('diplo',`${nm(a)} founds the ${name}.`); news(`${nm(a)} founds the ${name}`); return `${nm(a)} founds the ${name}. Invite like-minded nations from their Diplomacy tab.`; }],
 faction_invite:['diplomacy','other','Invite to faction',()=>({pp:30}),(a,T)=>!factionLed(a)?'Lead a faction first (your own country → Diplomacy → Form a faction).':(factionOf(T)?`Already in ${factionOf(T).name}.`:notWar(a,T)),
   (a,T)=>accept(a,T,-0.25,[['same ideology',IDEO(a)===IDEO(T)?0.3:-0.15],['protection from a strong leader',eff(a)>2*eff(T)?0.15:0],['threatened by your enemies',enemiesOf(a).some(e=>(S.claims[e]||[]).some(r=>S.owner[r]===T))?0.25:0]]),
   (a,T,ok,od)=>{ const f=factionLed(a); if(!ok) return refuse(a,T,`invitation to the ${f.name}`,od); f.members.forEach(m=>{ addT('alliance',m,T); addRel(m,T,8); }); f.members.push(T); S.tension+=2; news(`${nm(T)} joins the ${f.name}`); return `${accepted(T,od)} ${nm(T)} joins the ${f.name} — now allied with ${f.members.filter(x=>x!==T).map(nm).join(', ')}.`; }],
 summit:['diplomacy','other','Hold a summit',()=>({pp:30,gold:20}),(a,T)=>notWar(a,T),
   (a,T)=>accept(a,T,0.0,[['the summit mood',0.15],['already have a pact',hasT('non_aggression',a,T)?-1:0]]),
   (a,T,ok,od)=>{ const g=Math.round(14+rnd()*8); addRel(a,T,g); S.nat[a].stab+=2; let t=`Leaders of ${nm(a)} and ${nm(T)} meet under flashbulbs. Relations +${g}, stability +2.`; if(ok&&!hasT('non_aggression',a,T)){ addT('non_aggression',a,T); t+=' They emerge with a non-aggression pact.'; } else t+=` No pact (${pct(od.p)} chance).`; return t; },'Odds shown are for a pact; relations improve either way.'],
 mediate:['diplomacy','other','Mediate peace',()=>({pp:25}),(a,T)=>atWar(a,T)?'You are a belligerent, not a mediator.':(!enemiesOf(T).filter(x=>x!==a).length?`${nm(T)} is not at war.`:null),
   (a,T)=>{ const w=S.wars.find(w=>w.a===T||w.b===T); return accept(a,T,-0.25,[['war weariness',Math.min(0.4,(w?w.m:0)/30)],['your prestige',MAJOR(a)?0.15:0],['they are winning',S.fronts.some(f=>f.a===T&&f.prog>50)?-0.2:0]]); },
   (a,T,ok,od)=>{ const X=enemiesOf(T).filter(x=>x!==a)[0]; if(!ok){ return refuse(a,T,`mediation with ${nm(X)}`,od); } makePeace(T,X,`mediated by ${nm(a)}`); addRel(a,T,12); addRel(a,X,12); S.tension-=4; S.nat[a].pp+=10; return `${accepted(T,od)} Under ${nm(a)}'s chairmanship ${nm(T)} and ${nm(X)} sign an armistice. Prestige +10 PP.`; }],
 join_war:['military','other','Join their war',()=>({pp:10}),(a,T)=>atWar(a,T)?'You are fighting them.':(!enemiesOf(T).filter(x=>x!==a&&!atWar(a,x)&&!hasT('alliance',a,x)).length?`${nm(T)} has no war you can join.`:null),null,
   (a,T)=>{ const X=enemiesOf(T).filter(x=>x!==a&&!atWar(a,x)&&!hasT('alliance',a,x))[0]; declareWar(a,X,`joining ${nm(T)}'s war`); addRel(a,T,20); if(a===S.player) openFront(a,X); return `${nm(a)} enters the war against ${nm(X)} at ${nm(T)}'s side. Relations with ${nm(T)} +20.`; }],
 peace:['diplomacy','other','Offer peace',()=>({pp:10}),(a,T)=>!atWar(a,T)?`Not at war with ${nm(T)}.`:null,
   (a,T)=>{ const s=warScore(a,T); return {p:clamp(0.15+s/100,0.03,0.95),f:[['war score '+Math.round(s),s/100],['base',0.15]]}; },
   (a,T,ok,od)=>{ if(!ok){ addRel(a,T,3); return `${nm(T)} rejects peace — they believe they can win (${pct(od.p)} chance).`; } makePeace(a,T,'negotiated'); return `White flags over the trenches: ${nm(T)} accepts an armistice. Each side keeps what it holds.`; }],
 reparations:['diplomacy','other','Demand reparations',()=>({pp:20}),(a,T)=>!atWar(a,T)?'Only from a beaten enemy.':(warScore(a,T)<25?`War score ${Math.round(warScore(a,T))}; you need 25+.`:null),
   (a,T)=>{ const s=warScore(a,T); return {p:clamp(s/90,0.05,0.9),f:[['war score '+Math.round(s),s/90]]}; },
   (a,T,ok,od)=>{ if(!ok) return `${nm(T)} would rather fight on than pay (${pct(od.p)} chance).`; const g=Math.round(Math.min(Math.max(0,S.nat[T].gold),40)+S.nat[T].ind*3); makePeace(a,T,'with reparations'); S.nat[a].gold+=g; S.nat[T].gold-=g; S.nat[T].ind=Math.max(0.5,S.nat[T].ind-1); addRel(a,T,-15); return `${nm(T)} signs a humiliating peace and pays ${g} gold in reparations (−1 industry for them).`; }],
 demand:['diplomacy','other','Demand territory',()=>({pp:30}),(a,T)=>atWar(a,T)?'At war — take it by force.':(!borderRegs(a,T,false).length?`${nm(T)} has no territory bordering yours.`:null),
   (a,T)=>{ const cand=borderRegs(a,T,false); const r=(S.claims[a]||[]).find(x=>S.owner[x]===T&&cand.includes(x))||cand[0]; const ratio=demandRatio(a,T), cl=(S.claims[a]||[]).includes(r);
     return {p:clamp((ratio-1.6)*0.35+(cl?0.15:0),0.02,0.85),f:[[`your strength vs their coalition ${ratio.toFixed(1)}:1`,(ratio-1.6)*0.35],[cl?`legitimate claim on ${REG[r].name}`:`no claim on ${REG[r].name}`,cl?0.15:0]],r}; },
   (a,T,ok,od)=>{ const r=od.r; if(!ok){ addRel(a,T,-20); S.tension+=3; return `${nm(T)} rejects the ultimatum over ${REG[r].name} (${pct(od.p)} chance; ${reasons(od)||'they think you are bluffing'}). Relations −20.`; }
     transfer(r,a,'ceded under ultimatum'); addRel(a,T,-30); S.tension+=5; ['UK','FRA','SOV','USA'].filter(x=>x!==a&&x!==T&&alive(x)).forEach(x=>addRel(a,x,-6)); return `${nm(T)} buckles and cedes ${REG[r].name}. The great powers watch with alarm.`; }],
 concessions:['diplomacy','other','Colonial concessions',()=>({pp:30}),(a,T)=>atWar(a,T)?'At war.':(!colonyOf(T).length?`${nm(T)} has no overseas colonies.`:(!MAJOR(a)?'Only a great power can extract concessions.':null)),
   (a,T)=>{ const ratio=demandRatio(a,T); return {p:clamp((ratio-1.3)*0.3+0.05,0.02,0.8),f:[[`your strength vs theirs ${ratio.toFixed(1)}:1`,(ratio-1.3)*0.3],['far-flung colony',0.05]],r:colonyOf(T).sort((x,y)=>(S.claims[a]||[]).includes(y)-(S.claims[a]||[]).includes(x))[0]}; },
   (a,T,ok,od)=>{ if(!ok){ addRel(a,T,-15); return `${nm(T)} refuses to hand over ${REG[od.r].name} (${pct(od.p)} chance). Relations −15.`; } transfer(od.r,a,'colonial concession'); addRel(a,T,-25); S.tension+=3; return `${nm(T)} hands ${REG[od.r].name} to ${nm(a)} as a colonial concession.`; }],
 puppet:['diplomacy','other','Make puppet',()=>({pp:50}),(a,T)=>MAJOR(T)?'Great powers cannot be puppeted this way.':(masterOf(T)?`${nm(T)} already answers to ${nm(masterOf(T))}.`:(atWar(a,T)?(warScore(a,T)<40?`War score ${Math.round(warScore(a,T))}; need 40+.`:null):(eff(a)<4*eff(T)?'You need 4× their strength (or win a war).':null))),
   (a,T)=>atWar(a,T)?{p:clamp(warScore(a,T)/100,0.1,0.9),f:[['war score '+Math.round(warScore(a,T)),warScore(a,T)/100]]}:accept(a,T,-0.3,[['overwhelming power',0.25],['protection',enemiesOf(T).length?0.15:0]]),
   (a,T,ok,od)=>{ if(!ok){ addRel(a,T,-15); return refuse(a,T,'protectorate terms',od); } if(atWar(a,T)) makePeace(a,T,'as a protectorate'); addT('puppet',a,T); addT('alliance',a,T); S.ideo[T]=IDEO(a); S.tension+=3; return `${nm(T)} becomes a protectorate of ${nm(a)}: its army follows ${nm(a)}'s wars and its regime now mirrors ${nm(a)}'s.`; }],
 annex:['diplomacy','other','Annex puppet',()=>({pp:60}),(a,T)=>!isPuppet(a,T)?`${nm(T)} is not your puppet.`:(S.turn-(S.treaties.find(t=>t.type==='puppet'&&t.a===a&&t.b===T).t||0)<6?'A puppet must be held 6 months before annexation.':null),null,
   (a,T)=>{ const rs=regionsOf(T); rs.forEach(r=>{ S.owner[r]=a; S.flash.push(r); S.occ[r]={t:S.turn,res:20}; }); S.nat[a].army+=S.nat[T].army*0.5; S.nat[a].ind+=S.nat[T].ind*0.5; S.nat[T].alive=false; S.treaties=S.treaties.filter(t=>t.a!==T&&t.b!==T); ['UK','FRA','USA','SOV'].filter(x=>x!==a&&alive(x)).forEach(x=>addRel(a,x,-10)); S.tension+=4; log('border',`${nm(a)} annexes ${nm(T)}.`); news(`${nm(a).toUpperCase()} ANNEXES ${nm(T).toUpperCase()}`); return `${nm(T)} is annexed into ${nm(a)}: ${rs.length} region${rs.length>1?'s':''} gained (occupied — expect resistance).`; }],
 recall:['diplomacy','other','Recall ambassador',()=>({}),(a,T)=>null,null,(a,T)=>{ addRel(a,T,-12); S.nat[a].pp+=5; S.nat[a].stab+=1; return `${nm(a)} recalls its ambassador from ${nm(T)}. Relations −12; hard-liners at home approve (+5 PP).`; }],
 denounce:['diplomacy','other','Denounce',()=>({}),(a,T)=>null,null,(a,T)=>{ addRel(a,T,-18); S.nat[a].pp+=8; S.nat[a].stab+=3; alliesOf(T).forEach(x=>addRel(a,x,-4)); return `${nm(a)} denounces ${nm(T)} on the wireless. Crowds cheer (+3 stability, +8 PP); relations crash to ${rel(a,T)}.`; }],
 break:['diplomacy','other','Break treaties',()=>({pp:10}),(a,T)=>!pactsBetween(a,T).some(t=>BINDING.includes(t.type))?`No treaties with ${nm(T)}.`:null,null,
   (a,T)=>{ const ps=breakPacts(a,T); return `${nm(a)} tears up its ${ps.map(t=>TNAME[t.type]||t.type).join(', ')} with ${nm(T)}. ${nm(T)} will remember this betrayal for years, and third parties will trust ${nm(a)} less.`; },'Betrayal: −40 relations, −8 with great powers & neighbours, remembered ~5 years.'],
 // ---- intrigue
 spy:['intrigue','other','Spy',()=>({gold:15}),(a,T)=>null,(a,T)=>({p:clamp(0.6+(S.nat[a].ind-S.nat[T].ind)/100,0.3,0.85),f:[['base',0.6],['spy-service budgets',(S.nat[a].ind-S.nat[T].ind)/100]]}),
   (a,T,ok,od)=>{ const n=S.nat[T]; let t=`Intel on ${nm(T)}: ${n.army.toFixed(0)} inf, ${n.arm.toFixed(1)} armour, ${n.art.toFixed(1)} artillery, ${n.air.toFixed(1)} air, ${n.nav.toFixed(1)} fleets, industry ${n.ind.toFixed(1)}, stability ${Math.round(n.stab)}.`; if(ok){ n.ind=Math.max(0.5,n.ind-0.4); t=`Saboteurs blow a rail junction (−0.4 industry). `+t; } if(rnd()<0.25){ addRel(a,T,-20); t+=' One agent is caught and talks: relations −20.'; } return t; }],
 propaganda:['intrigue','other','Propaganda broadcasts',()=>({gold:10,pp:5}),(a,T)=>null,null,(a,T)=>{ S.nat[T].stab=clamp(S.nat[T].stab-6,0,100); addRel(a,T,-5); return `${nm(a)}'s radio towers beam into ${nm(T)}: −6 stability there.`; }],
 fund_rebels:['intrigue','other','Fund rebels',()=>({gold:30}),(a,T)=>null,(a,T)=>({p:clamp(0.4+(60-S.nat[T].stab)/100,0.15,0.85),f:[['base',0.4],[`their stability ${Math.round(S.nat[T].stab)}`,(60-S.nat[T].stab)/100]]}),
   (a,T,ok,od)=>{ let t; if(ok){ S.nat[T].stab=clamp(S.nat[T].stab-10,0,100); S.nat[T].army=Math.max(0.5,S.nat[T].army-1); t=`Smuggled rifles reach rebels in ${nm(T)}: −10 stability, −1 division tied down.`; } else t=`The rebels squander the money (${pct(od.p)} chance).`; if(rnd()<0.25){ addRel(a,T,-25); t+=` ${nm(T)} uncovers the plot: relations −25.`; } return t; }],
 coup:['intrigue','other','Support coup',()=>({gold:60,pp:40}),(a,T)=>S.nat[T].stab>=45?`Their regime is too stable (stability ${Math.round(S.nat[T].stab)}; needs below 45).`:(IDEO(T)===IDEO(a)?'They already share your ideology.':null),
   (a,T)=>({p:clamp((45-S.nat[T].stab)/45+0.1-(MAJOR(T)?0.25:0),0.05,0.8),f:[[`their instability`,(45-S.nat[T].stab)/45],['base',0.1],['great power security services',MAJOR(T)?-0.25:0]]}),
   (a,T,ok,od)=>{ if(!ok){ addRel(a,T,-40); S.tension+=3; return `The coup in ${nm(T)} collapses; the plotters are shot and ${nm(a)}'s hand is exposed (relations −40).`; } S.ideo[T]=IDEO(a); S.rel[rk(a,T)]=Math.max(rel(a,T),50); S.nat[T].stab=40; S.treaties=S.treaties.filter(t=>!((t.a===T||t.b===T)&&t.type==='alliance'&&enemiesOf(a).includes(t.a===T?t.b:t.a))); log('event',`A ${IDEO(a)} coup topples the government of ${nm(T)}.`); news(`COUP IN ${nm(T).toUpperCase()}`); return `Tanks surround the palace: a ${IDEO(a)} junta seizes ${nm(T)}. Relations now ${rel(a,T)}.`; }],
 aid:['intrigue','other','Send aid',()=>({gold:25}),(a,T)=>notWar(a,T),null,(a,T)=>{ S.nat[T].army+=1.5; S.nat[T].gold+=10; addRel(a,T,12); enemiesOf(T).forEach(x=>addRel(a,x,-8)); return `${nm(a)} ships rifles, trucks and grain to ${nm(T)}: +1.5 divisions for them, relations +12.`; }],
 arms_sell:['economy','other','Sell arms',()=>({}),(a,T)=>notWar(a,T)||(S.nat[a].army<6?'Your own army is too small to spare weapons.':null)||(S.nat[T].gold<30?`${nm(T)} cannot pay (needs 30 gold).`:null),
   (a,T)=>accept(a,T,0.3,[['they need weapons',enemiesOf(T).length?0.3:0]]),
   (a,T,ok,od)=>{ if(!ok) return refuse(a,T,'arms offer',od); S.nat[a].army-=1.5; S.nat[a].gold+=30; S.nat[T].gold-=30; S.nat[T].army+=1.5; addRel(a,T,6); return `${accepted(T,od)} Crated rifles and field guns go to ${nm(T)}: +30 gold, −1.5 of your divisions' kit.`; }],
 arms_buy:['economy','other','Buy arms',()=>({gold:35}),(a,T)=>notWar(a,T)||(S.nat[T].ind<6?`${nm(T)}'s arms industry is too small.`:null)||(hasT('embargo',T,a)?`${nm(T)} embargoes you.`:null),
   (a,T)=>accept(a,T,0.3,[['spare factory capacity',S.nat[T].ind>15?0.15:0],['they are at war themselves',enemiesOf(T).length?-0.25:0]]),
   (a,T,ok,od)=>{ if(!ok){ S.nat[a].gold+=35; return refuse(a,T,'purchase order',od)+' Gold refunded.'; } S.nat[a].army+=1.4; S.nat[a].arm+=0.4; S.nat[T].gold+=35; addRel(a,T,5); return `${accepted(T,od)} ${nm(T)} delivers rifles and a battalion of tanks: +1.4 infantry, +0.4 armour.`; }],
 embargo:['economy','other','Embargo',()=>({pp:10}),(a,T)=>hasT('embargo',a,T)?'Embargo already in force.':null,null,
   (a,T)=>{ const hadTrade=hasT('trade',a,T); if(hadTrade){ S.treaties=S.treaties.filter(t=>!(t.type==='trade'&&((t.a===a&&t.b===T)||(t.a===T&&t.b===a)))); betray(a,T,'trade'); } addT('embargo',a,T); S.nat[T].ind=Math.max(0.5,S.nat[T].ind-0.6); S.nat[T].stab-=3; addRel(a,T,-15); return `${nm(a)} closes its ports to ${nm(T)}: −0.6 industry, −3 stability for them${hadTrade?' (their trade deal is broken — remembered as a betrayal)':''}.`; }],
 // ---- economy (self)
 build_industry:['economy','self','Build factories',()=>({gold:40}),()=>null,null,(a)=>{ S.nat[a].ind+=1.2; return `Smokestacks rise: +1.2 industry.`; }],
 war_economy:['economy','self','War economy',()=>({pp:25}),(a)=>S.nat[a].wareco?'Already on a war footing.':null,null,(a)=>{ const n=S.nat[a]; n.wareco=true; n.bud=Math.max(n.bud,0.55); n.stab-=5; return `${nm(a)} converts to a war economy: military budget ${Math.round(n.bud*100)}%, unit output ×1.35, factory growth slowed, −5 stability.`; }],
 civil_economy:['economy','self','Civilian economy',()=>({pp:15}),(a)=>!S.nat[a].wareco?'Not on a war footing.':null,null,(a)=>{ const n=S.nat[a]; n.wareco=false; n.bud=Math.min(n.bud,0.3); n.stab+=4; return `Factories return to consumer goods: budget ${Math.round(n.bud*100)}% military, +4 stability.`; }],
 tax:['economy','self','Raise taxes',()=>({pp:10}),(a)=>S.nat[a].stab<20?'Stability too low to squeeze more.':null,null,(a)=>{ const n=S.nat[a], g=Math.round(25+n.ind*1.2); n.gold+=g; n.stab-=6; return `New taxes on tobacco, wireless sets and beer: +${g} gold, −6 stability.`; }],
 ration:['economy','self','Rationing',()=>({pp:15}),(a)=>S.nat[a].stab<25?'Stability too low for rationing.':null,null,(a)=>{ const n=S.nat[a], m=Math.round(12+regionsOf(a).length*0.5); n.mp+=m; n.gold+=10; n.stab-=4; return `Ration books are issued: +${m} manpower freed, +10 gold, −4 stability.`; }],
 budget_army:['economy','self','Budget → army',()=>({}),(a)=>S.nat[a].bud>=0.7?'Already at 70% military.':null,null,(a)=>{ S.nat[a].bud=Math.min(0.7,S.nat[a].bud+0.1); return `Budget: ${Math.round(S.nat[a].bud*100)}% military.`; },null,1],
 budget_civ:['economy','self','Budget → factories',()=>({}),(a)=>S.nat[a].bud<=0.1?'Already at 10% military.':null,null,(a)=>{ S.nat[a].bud=Math.max(0.1,S.nat[a].bud-0.1); return `Budget: ${Math.round(S.nat[a].bud*100)}% military.`; },null,1],
 propaganda_home:['economy','self','Home propaganda',()=>({gold:10}),()=>null,null,(a)=>{ S.nat[a].stab=clamp(S.nat[a].stab+7,0,100); S.nat[a].pp+=5; return `Posters, parades and a stirring speech: +7 stability, +5 PP.`; }],
 // ---- military
 mobilize:['military','self','Mobilize',()=>({pp:10}),(a)=>S.nat[a].mp<15?`Manpower ${Math.floor(S.nat[a].mp)}; need 15.`:null,null,(a)=>{ const n=S.nat[a], add=Math.min(n.mp/6,n.army*0.25+3); n.army+=add; n.mp-=add*6; n.stab-=8; n.bud=Math.max(n.bud,0.5); S.tension+=3; return `Mobilization: +${add.toFixed(1)} infantry divisions, budget ${Math.round(n.bud*100)}% military, −8 stability. Neighbours are alarmed.`; }],
 demobilize:['military','self','Demobilize',()=>({}),(a)=>S.nat[a].army<6?'Army already minimal.':(enemiesOf(a).length?'Not while at war.':null),null,(a)=>{ const n=S.nat[a], d=n.army*0.25; n.army-=d; n.mp+=d*5; n.gold+=d*2; n.stab+=5; S.tension-=1; return `${d.toFixed(1)} divisions go home to the farms: +${Math.round(d*5)} manpower, +${Math.round(d*2)} gold, +5 stability.`; }],
 build_inf:['military','self','Build infantry',()=>({gold:20,mp:10}),()=>null,null,(a)=>{ S.nat[a].army+=2; return `+2 infantry divisions drill on muddy fields.`; }],
 build_arm:['military','self','Build armour',()=>({gold:45,mp:6}),(a)=>S.nat[a].ind<8?'Needs industry 8+.':null,null,(a)=>{ S.nat[a].arm+=1; return `+1 armoured division rolls off the line (2.8× an infantry division in attack).`; }],
 build_art:['military','self','Build artillery',()=>({gold:25,mp:5}),(a)=>S.nat[a].ind<4?'Needs industry 4+.':null,null,(a)=>{ S.nat[a].art+=1; return `+1 artillery division (strong in defence and sieges).`; }],
 build_air:['military','self','Build air wing',()=>({gold:35,mp:2}),(a)=>S.nat[a].ind<6?'Needs industry 6+.':null,null,(a)=>{ S.nat[a].air+=1; return `+1 air wing: air superiority boosts every front.`; }],
 build_nav:['military','self','Build fleet',()=>({gold:50,mp:3}),(a)=>!coastal(a)?'You have no coastline.':(S.nat[a].ind<6?'Needs industry 6+.':null),null,(a)=>{ S.nat[a].nav+=1; return `+1 fleet: supplies overseas fronts and enables blockades.`; }],
 fortify:['military','both','Fortify border',()=>({gold:25}),(a,T)=>null,null,(a,T)=>{ let r=null; if(T&&T!==a) r=regionsOf(a).filter(x=>[...LANDADJ[x]].some(y=>S.owner[y]===T)).sort((x,y)=>(S.fort[x]||0)-(S.fort[y]||0))[0]; if(!r){ const th=regionsOf(a).filter(x=>[...LANDADJ[x]].some(y=>S.owner[y]!==a&&(atWar(a,S.owner[y])||rel(a,S.owner[y])<0))); r=th.sort((x,y)=>(S.fort[x]||0)-(S.fort[y]||0))[0]||capOf(a); }
   if((S.fort[r]||0)>=5){ S.nat[a].gold+=25; return `${REG[r].name} is already fortified to the maximum (refunded).`; } S.fort[r]=(S.fort[r]||0)+1; return `Concrete pours at ${REG[r].name}: fort level ${S.fort[r]} (+20% defence each).`; }],
 garrison:['military','self','Pacify occupied lands',()=>({gold:15,pp:5}),(a)=>!Object.keys(S.occ).some(r=>S.owner[r]===a)?'You occupy no foreign regions.':null,null,(a)=>{ const rs=Object.keys(S.occ).filter(r=>S.owner[r]===a); rs.forEach(r=>S.occ[r].res=Math.max(0,S.occ[r].res-25)); S.nat[a].stab-=1; return `Garrisons and curfews in ${rs.length} occupied region${rs.length>1?'s':''}: resistance −25 each.`; }],
 attack:['military','other','Attack',(a,T)=>({pp:atWar(a,T)?0:((S.claims[a]||[]).some(r=>S.owner[r]===T)?10:25)}),(a,T)=>hasT('alliance',a,T)?`${nm(T)} is your ally — break the alliance first.`:null,
   (a,T)=>{ const r=pickTarget(a,T); if(!r) return {p:0,f:[['no border, sea lane or military access',-1]],r:null}; const c=frontCalc({a,d:T,r}); return {p:clamp((c.ratio-0.6)/1.4,0.02,0.95),f:[[`strength ratio ${c.ratio.toFixed(2)}:1`,0],[`terrain ${c.terr}`,0],[`forts ${c.fort}`,0],[`supply ${Math.round(c.supply*100)}%${c.oos?' (OUT OF SUPPLY)':''}`,0],[`air ${c.airA.toFixed(0)} vs ${c.airD.toFixed(0)}`,0]],r,c}; },
   (a,T,ok,od)=>{ let t=''; const pacts=pactsBetween(a,T).filter(x=>BINDING.includes(x.type)); if(!atWar(a,T)){ declareWar(a,T,'direct order'); t=`${nm(a)} declares war on ${nm(T)}${pacts.length?` — breaking their ${pacts.map(x=>TNAME[x.type]).join(', ')}`:''}. `; }
     if(!od.r) return t+`But no front can be opened: no border, sea lane or military access to ${nm(T)}.`; const f=openFront(a,T,od.r), c=frontCalc(f); return t+`Offensive into ${REG[f.r].name} (${c.terr}${c.fort?`, forts ${c.fort}`:''}): ratio ${c.ratio.toFixed(2)}:1, supply ${Math.round(c.supply*100)}%. ${c.ratio<0.8?'The generals expect it to fail.':c.ratio<1.3?'Expect a grinding, multi-month fight.':'The enemy line looks brittle.'}`; },'The % is the front\'s chance to make progress each month; a region falls at 100% progress.'],
 blockade:['military','other','Naval blockade',()=>({gold:20}),(a,T)=>S.nat[a].nav<2?`Need 2+ fleets (you have ${S.nat[a].nav.toFixed(1)}).`:(!coastal(T)?`${nm(T)} is landlocked.`:(hasT('alliance',a,T)?'They are your ally.':null)),
   (a,T)=>({p:clamp(0.5+(S.nat[a].nav-S.nat[T].nav)/(S.nat[a].nav+S.nat[T].nav+1)*0.5,0.1,0.95),f:[[`fleets ${S.nat[a].nav.toFixed(0)} vs ${S.nat[T].nav.toFixed(0)}`,0]]}),
   (a,T,ok,od)=>{ let t=''; if(!atWar(a,T)){ addRel(a,T,-25); S.tension+=3; t='An act of aggression in peacetime: relations −25. '; } if(!ok){ S.nat[a].nav=Math.max(0,S.nat[a].nav-0.5); return t+`${nm(T)}'s fleet breaks the blockade; you lose half a fleet.`; } S.nat[T].ind=Math.max(0.5,S.nat[T].ind-0.6); S.nat[T].gold-=15; S.nat[T].stab-=3; return t+`The blockade holds: ${nm(T)} loses 0.6 industry, 15 gold and 3 stability.`; }],
 air_raid:['military','other','Air raid',()=>({gold:20}),(a,T)=>!atWar(a,T)?'Only in wartime.':(S.nat[a].air<1?'You have no air wings.':null),
   (a,T)=>({p:clamp(0.5+(S.nat[a].air-S.nat[T].air)/(S.nat[a].air+S.nat[T].air+1)*0.45,0.1,0.92),f:[[`air ${S.nat[a].air.toFixed(0)} vs ${S.nat[T].air.toFixed(0)}`,0]]}),
   (a,T,ok,od)=>{ if(!ok){ S.nat[a].air=Math.max(0,S.nat[a].air-0.5); return `Fighters tear the bomber stream apart: −0.5 air wing.`; } S.nat[T].ind=Math.max(0.5,S.nat[T].ind-0.5); S.nat[T].stab-=2; S.fronts.filter(f=>f.a===a&&f.d===T).forEach(f=>f.prog=Math.min(99,f.prog+10)); return `Bombers hit ${nm(T)}'s rail yards: −0.5 industry, fronts against them +10%.`; }],
 reinforce:['military','other','Reinforce front',()=>({gold:15,mp:10}),(a,T)=>!S.fronts.some(f=>f.a===a&&f.d===T)?`No offensive against ${nm(T)} to reinforce.`:null,null,
   (a,T)=>{ const f=S.fronts.find(f=>f.a===a&&f.d===T); S.nat[a].army+=1; f.prog=Math.min(99,f.prog+12); return `Fresh reserves and shells reach the ${REG[f.r].name} front: +1 division, +12% progress.`; }],
 advisor:['diplomacy','both','Ask advisor',()=>({}),()=>null,null,(a,T)=>advisorText(T),null,1],
};
const AXI=k=>({tab:AX[k][0],scope:AX[k][1],label:AX[k][2],cost:AX[k][3],pre:AX[k][4],odds:AX[k][5],run:AX[k][6],note:AX[k][7],noTime:AX[k][8]});
const costStr=c=>[c.gold?`${c.gold}💰`:'',c.pp?`${c.pp} PP`:'',c.mp?`${c.mp} MP`:''].filter(Boolean).join(' · ')||'free';
function costOf(k,a,T){ return AXI(k).cost(a,T)||{}; }
function lackOf(a,c){ const n=S.nat[a]; if(c.gold&&n.gold<c.gold) return `Needs ${c.gold} gold (have ${Math.floor(n.gold)}).`; if(c.pp&&n.pp<c.pp) return `Needs ${c.pp} political power (have ${Math.floor(n.pp)}).`; if(c.mp&&n.mp<c.mp) return `Needs ${c.mp} manpower (have ${Math.floor(n.mp)}).`; return null; }
function checkAction(k,a,T){ const A=AXI(k); if(T&&!alive(T)) return {why:`${nm(T)} no longer exists.`}; if(A.scope==='other'&&(!T||T===a)) return {why:'Needs a foreign target.'}; if(A.scope==='self'&&T&&T!==a) return {why:'Only on your own country.'};
  const why=A.pre(a,T)||lackOf(a,costOf(k,a,T)); if(why) return {why}; return {why:null,od:A.odds?A.odds(a,T):null}; }
function doAction(k,a,T){ const A=AXI(k); const chk=checkAction(k,a,T); if(chk.why) return {ok:false,narr:chk.why};
  const c=costOf(k,a,T), n=S.nat[a]; n.gold-=c.gold||0; n.pp-=c.pp||0; n.mp-=c.mp||0;
  const od=chk.od, success=od&&!A.note?.startsWith('The %')?rnd()<od.p:true; const narr=A.run(a,T,success,od||{p:1,f:[]});
  return {ok:true,narr,success,od,cost:c,noTime:A.noTime}; }
/* AI nations use the same actions toward each other */
const AI_LOG=new Set(['alliance','nap','guarantee','faction_form','faction_invite','break','mediate','coup','embargo','puppet','annex','demand','concessions','join_war','access','denounce','aid']);
function aiDiploActions(){
  const actors=NAT.filter(c=>alive(c)&&c!==S.player).sort(()=>rnd()-0.5).slice(0,10);
  for(const a of actors){ const n=S.nat[a]; if(n.pp<20||rnd()>0.6) continue; const opts=[]; const nb=neighbours(a);
    const cands=[...new Set(nb.concat(NAT.filter(x=>MAJOR(x))))].filter(x=>x!==a&&x!==S.player&&alive(x));
    for(const T of cands){ const r=rel(a,T), ia=ideoAff(a,T); if(atWar(a,T)){ if(warScore(a,T)>30) opts.push(['peace',T,0.4]); continue; }
      if(!hasT('alliance',a,T)&&r>=55&&ia>=0) opts.push(['alliance',T,2]);
      if(!hasT('non_aggression',a,T)&&nb.includes(T)&&r>-40&&r<40&&enemiesOf(a).length+(YM()>=(WAR_START[a]??9e9)-6?1:0)) opts.push(['nap',T,1.2]);
      if(!hasT('trade',a,T)&&r>15&&!hasT('embargo',a,T)&&!hasT('embargo',T,a)) opts.push(['trade',T,0.8]);
      if(ia>=0&&r<55&&r>-15) opts.push(['improve',T,0.6]);
      if(MAJOR(a)&&IDEO(a)==='democratic'&&!MAJOR(T)&&!hasT('guarantee',a,T)&&S.tension>50&&NAT.some(x=>alive(x)&&IDEO(x)==='fascist'&&(S.claims[x]||[]).some(q=>S.owner[q]===T))) opts.push(['guarantee',T,1.5]);
      if(factionLed(a)&&!factionOf(T)&&IDEO(T)===IDEO(a)&&r>25) opts.push(['faction_invite',T,1.5]);
      if(r<-45&&ia<0) opts.push(['denounce',T,0.4]);
      if(IDEO(a)==='democratic'&&MAJOR(a)&&S.wars.some(w=>w.a===T&&w.motive&&!/honour|joining|following/.test(w.motive))&&!hasT('embargo',a,T)&&S.tension>55) opts.push(['embargo',T,1]);
      if(enemiesOf(T).length&&r>40) opts.push(['aid',T,1]);
      if(MAJOR(a)&&enemiesOf(T).length&&!enemiesOf(a).length&&rnd()<0.3) opts.push(['mediate',T,0.3]);
      if(['fascist','communist'].includes(IDEO(a))&&YM()>=(WAR_START[a]??9e9)&&(S.claims[a]||[]).some(q=>S.owner[q]===T)&&pactsBetween(a,T).some(t=>t.type==='non_aggression')&&eff(a)>1.8*eff(T)) opts.push(['break',T,0.7]);
      if(IDEO(a)!=='democratic'&&!MAJOR(T)&&S.nat[T].stab<35&&IDEO(T)!==IDEO(a)&&nb.includes(T)) opts.push(['coup',T,0.3]);
    }
    if(MAJOR(a)&&!factionOf(a)&&S.tension>35&&NAT.filter(x=>alive(x)&&x!==a&&IDEO(x)===IDEO(a)).length>1) opts.push(['faction_form',a,S.tension>45?2.5:0.8]);
    if(enemiesOf(a).length&&!n.wareco) opts.push(['war_economy',a,1.5]);
    const ok=opts.filter(o=>!checkAction(o[0],a,o[0].endsWith('_form')||o[0]==='war_economy'?null:o[1]).why); const ws=ok.reduce((s,o)=>s+o[2],0); if(!ws) continue;
    let x=rnd()*ws; const o=ok.find(o=>(x-=o[2])<0)||ok[0]; const T=AXI(o[0]).scope==='self'?null:o[1];
    const res=doAction(o[0],a,T); if(res.ok&&AI_LOG.has(o[0])) log('diplo',res.narr);
  }
}
/* AI proposals to the player: accept/refuse in a decision card */
async function aiOffers(){
  if(rnd()>0.18) return; const p=P(); const c=NAT.filter(x=>alive(x)&&x!==p&&!atWar(x,p)&&(MAJOR(x)||neighbours(p).includes(x))&&rel(x,p)>=35&&S.nat[x].pp>=20).sort(()=>rnd()-0.5)[0]; if(!c) return;
  const kinds=[['alliance',!hasT('alliance',c,p)&&rel(c,p)>=60&&ideoAff(c,p)>=0],['non_aggression',!hasT('non_aggression',c,p)],['trade',!hasT('trade',c,p)&&!hasT('embargo',c,p)&&!hasT('embargo',p,c)]].filter(k=>k[1]);
  if(!kinds.length) return; const type=kinds[0][0]; S.nat[c].pp-=15;
  const i=await askDecision({title:`${nm(c)} proposes ${/^[aeiou]/.test(TNAME[type])?'an':'a'} ${TNAME[type]}`,text:`The ambassador of ${nm(c)} (relations ${rel(c,p)}) offers ${nm(p)} a ${TNAME[type]}. Refusing costs 5 relations. Remember: breaking a treaty later is a betrayal that ${nm(c)} will not forget.`,opts:[{t:'Accept'},{t:'Refuse'}]});
  if(i===0){ addT(type,c,p); addRel(c,p,8); log('diplo',`${nm(p)} accepts ${nm(c)}'s ${TNAME[type]}.`); } else { addRel(c,p,-5); log('diplo',`${nm(p)} turns down ${nm(c)}'s ${TNAME[type]}.`); }
}

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
   <div class="econ">Political power <b>${Math.floor(n.pp)}</b> · Units: ${n.army.toFixed(0)} inf · ${n.arm.toFixed(1)} armour · ${n.art.toFixed(1)} artillery · ${n.air.toFixed(1)} air · ${n.nav.toFixed(1)} fleets${n.wareco?' · <b>WAR ECONOMY</b>':''}</div>
   <label class="bud">Budget: <b id="budv">${Math.round(n.bud*100)}%</b> army / ${Math.round(100-n.bud*100)}% factories<input id="budr" type="range" min="10" max="70" value="${Math.round(n.bud*100)}"></label>
   <h4>Fronts</h4>${fr.length?fr.map(f=>`<div class="front"><span>${f.a===p?'▶ Attacking':'◀ Defending'} ${esc(REG[f.r].name)} <small>${esc(nm(f.a))} vs ${esc(nm(f.d))}${f.last?` · ratio ${f.last.ratio} · ${f.last.delta>=0?'+':''}${f.last.delta}%/mo · losses ${f.last.la}/${f.last.ld} div · ${esc(f.last.terr)}`:''}</small></span><i style="width:${Math.round(f.prog)}%"></i></div>`).join(''):'<small>No active fronts.</small>'}
   <h4>Diplomacy</h4><div class="econ">${factionOf(p)?`Faction: <b>${esc(factionOf(p).name)}</b> (${factionOf(p).members.map(x=>esc(nm(x))).join(', ')})<br>`:''}Treaties: ${S.treaties.filter(t=>t.a===p||t.b===p).map(t=>`${esc(TNAME[t.type]||t.type)} ${esc(nm(t.a===p?t.b:t.a))}`).join(' · ')||'none'}<br>${(()=>{ const g=NAT.filter(x=>alive(x)&&grudge(x,p)>1); return g.length?`🗡 Remember your betrayals: ${g.map(x=>`${esc(nm(x))} (−${Math.round(grudge(x,p))}% trust)`).join(', ')}`:'No one holds a grudge against you.'; })()}</div>
   <h4>Threats</h4><ul>${th||'<li><small>None nearby.</small></li>'}</ul>
   <h4>War goals (claims)</h4><ul>${goals||'<li><small>No claims. Demand or conquer to expand.</small></li>'}</ul>
   <h4>Coming up</h4><small>${esc(nextEventHint())}</small>`;
  $('#budr').oninput=e=>{ n.bud=e.target.value/100; $('#budv').textContent=e.target.value+'%'; autosave(); };
}

/* ================= TURN FLOW ================= */
function snap(){ const p=P(); return {betray:S.betray.length, occ:Object.keys(S.occ).filter(r=>S.owner[r]===p).length, own:{...S.owner}, nat:JSON.parse(JSON.stringify(S.nat[p])), rel:Object.fromEntries(NAT.map(x=>[x,rel(p,x)])), wars:S.wars.map(w=>w.a+'|'+w.b), tre:S.treaties.map(t=>t.type+'|'+t.a+'|'+t.b), tension:S.tension, fronts:Object.fromEntries(S.fronts.filter(f=>f.a===p||f.d===p).map(f=>[f.a+f.d+f.r,f.prog])), news:S.news.length, newsTop:S.news[0]}; }
function diff(b){ const p=P(), out=[], n=S.nat[p];
  RIDS.forEach(r=>{ if(b.own[r]!==S.owner[r]){ if(S.owner[r]===p) out.push(`<li class="good">＋ ${esc(REG[r].name)} is now yours (from ${esc(nm(b.own[r]))})</li>`); else if(b.own[r]===p) out.push(`<li class="bad">− Lost ${esc(REG[r].name)} to ${esc(nm(S.owner[r]))}</li>`); } });
  const world={}; RIDS.forEach(r=>{ if(b.own[r]!==S.owner[r]&&S.owner[r]!==p&&b.own[r]!==p){ const k=nm(S.owner[r])+' took '; (world[k]=world[k]||[]).push(REG[r].name);} }); Object.entries(world).slice(0,5).forEach(([k,v])=>out.push(`<li>🌍 ${esc(k+v.join(', '))}</li>`));
  const st=[['army','Infantry','div',1],['arm','Armour','',1],['art','Artillery','',1],['air','Air','',1],['nav','Fleets','',1],['ind','Industry','',1],['gold','Gold','',0],['pp','Political power','',0],['mp','Manpower','',0],['stab','Stability','',0]].map(([k,l,u,dp])=>{ const d=n[k]-b.nat[k]; return Math.abs(d)>=(dp?0.1:1)?`${l} ${d>0?'+':''}${d.toFixed(dp)}${u?' '+u:''}`:null; }).filter(Boolean);
  if(st.length) out.push(`<li>📊 ${st.join(' · ')}</li>`);
  NAT.forEach(x=>{ const d=rel(p,x)-b.rel[x]; if(Math.abs(d)>=3&&alive(x)) out.push(`<li class="${d>0?'good':'bad'}">🤝 ${esc(nm(x))} ${d>0?'+':''}${d} → ${rel(p,x)}</li>`); });
  S.wars.forEach(w=>{ if(!b.wars.includes(w.a+'|'+w.b)) out.push(`<li class="bad">⚔ War: ${esc(nm(w.a))} vs ${esc(nm(w.b))}${w.motive?` <small>(${esc(w.motive)})</small>`:''}</li>`); });
  b.wars.forEach(k=>{ if(!S.wars.some(w=>w.a+'|'+w.b===k)){ const [x,y]=k.split('|'); out.push(`<li class="good">🕊 Peace/ended: ${esc(nm(x))} – ${esc(nm(y))}</li>`);} });
  S.treaties.forEach(t=>{ if(!b.tre.includes(t.type+'|'+t.a+'|'+t.b)) out.push(`<li>📜 ${esc(t.type.replace('_','-'))}: ${esc(nm(t.a))} – ${esc(nm(t.b))}</li>`); });
  S.fronts.filter(f=>f.a===p||f.d===p).forEach(f=>{ const was=b.fronts[f.a+f.d+f.r]; out.push(`<li>🎯 Front ${esc(REG[f.r].name)} (${esc(nm(f.a))}→${esc(nm(f.d))}): ${Math.round(f.prog)}%${was!=null?` (${f.prog-was>=0?'+':''}${Math.round(f.prog-was)})`:' (new)'}${f.last?` · ratio ${f.last.ratio}, losses ${f.last.la}/${f.last.ld} div`:''}</li>`); });
  b.tre.forEach(k=>{ if(!S.treaties.some(t=>t.type+'|'+t.a+'|'+t.b===k)){ const [ty,x,y]=k.split('|'); if(x===p||y===p) out.push(`<li class="bad">✂ ${esc((TNAME[ty]||ty))} ended: ${esc(nm(x))} – ${esc(nm(y))}</li>`); } });
  S.betray.slice(b.betray).forEach(x=>out.push(`<li class="bad">🗡 Betrayal: ${esc(nm(x.by))} broke its ${esc(TNAME[x.type]||x.type)} with ${esc(nm(x.victim))} — remembered for years</li>`));
  const oc=Object.keys(S.occ).filter(r=>S.owner[r]===p); if(oc.length) out.push(`<li>🔥 Occupied regions: ${oc.length} · avg resistance ${Math.round(oc.reduce((s,r)=>s+S.occ[r].res,0)/oc.length)}%</li>`);
  const dt=S.tension-b.tension; if(Math.abs(dt)>=1) out.push(`<li>🌡 World tension ${dt>0?'+':''}${Math.round(dt)} → ${Math.round(S.tension)}</li>`);
  return out; }
function headlinesSince(b){ const k=S.news.indexOf(b.newsTop); return (k<0?S.news.slice(0,6):S.news.slice(0,k)).slice(0,6); }
async function endMonth(){
  economyTick(); aiDiplomacy(); aiDiploActions(); aiWarCheck(); aiFronts();
  const fs=S.fronts.slice().sort(()=>rnd()-0.5); for(const f of fs){ if(!S.fronts.includes(f)) continue; if(resolveFront(f)==='drop') S.fronts=S.fronts.filter(x=>x!==f); }
  await runEvents(); await aiOffers();
  S.m++; if(S.m>11){ S.m=0; S.y++; } S.turn++; S.tension=clamp(S.tension,0,100);
  if(!alive(P())) log('war',`${nm(P())} has fallen. Start a new game or load a save.`);
  autosave(); dirty=true;
}
async function submit(kind,target){
  if(busy||!S) return; busy=true; hidePopup(); showBusy(true); const before=snap(); S.flash=[]; dirty=true;
  try{
    const p=P(), A=AXI(kind), T=A.scope==='self'?p:target; const title=A.label+(T&&T!==p?' → '+nm(T):'');
    const res=doAction(kind,p,A.scope==='self'?null:T);
    if(!res.ok){ showReport(title,`<p>${esc(res.narr)}</p><p><small>No time has passed.</small></p>`,[],[]); return; }
    if(res.noTime){ if(kind==='advisor') log('advisor',res.narr); autosave(); showReport(title,`<p>${esc(res.narr)}</p><p><small>No time has passed.</small></p>`,diff(before),[]); return; }
    log('turn',`— ${nm(p)}: ${title}`); log('narr',res.narr);
    $('#busy-t').textContent='The month passes…'; await endMonth();
    const oddsLine=res.od&&res.od.f.length&&!(A.note||'').startsWith('The %')?`<p class="odds">${res.success?'✔ Succeeded':'✖ Failed'} at ${pct(res.od.p)}</p>`:'';
    showReport(title+` — ${dateStr()}`,`${oddsLine}<p>${esc(res.narr)}</p><p><small>Cost: ${costStr(res.cost)}</small></p>`,diff(before),headlinesSince(before));
  } finally { busy=false; showBusy(false); renderAll(); }
}
async function passTurn(){ if(busy||!S) return; busy=true; showBusy(true); const before=snap(); S.flash=[]; try{ log('turn','— You wait and watch.'); await endMonth(); showReport(`Month report — ${dateStr()}`,'<p>You hold your hand and watch the world move.</p>',diff(before),headlinesSince(before)); } finally{ busy=false; showBusy(false); renderAll(); } }

/* ================= SAVE ================= */
function autosave(){ try{ const c={...S}; delete c._hops; localStorage.setItem(SAVE_KEY,JSON.stringify(c)); }catch(e){} }
function loadFrom(key){ const s=localStorage.getItem(key); if(!s) return false; try{ const o=JSON.parse(s); if(o.v!==4) return false; S=o; dirty=true; renderAll(); return true; }catch(e){ return false; } }

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
  $('#pstats').textContent=`💰${Math.floor(n.gold)} ⚖${Math.floor(n.pp)}PP 🏭${n.ind.toFixed(1)} 🪖${n.army.toFixed(0)}+${n.arm.toFixed(0)}🛡 ✊${Math.round(n.stab)}`;
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

/* ================= POPUP / SHEET: tabbed actions ================= */
let popTarget=null, popRegion=null, popOpenedAt=0, popTab='diplomacy', popPending=null;
const TABS=[['diplomacy','Diplomacy'],['intrigue','Intrigue'],['economy','Economy'],['military','Military']];
function actionsFor(n){ const self=n===P(); return Object.keys(AX).filter(k=>{ const s=AX[k][1]; return k!=='advisor'&&(s==='both'||(self?s==='self':s==='other')); }); }
function renderActs(){ const n=popTarget, p=P(), self=n===p; const ks=actionsFor(n).filter(k=>AX[k][0]===popTab);
  $('#pp-tabs').innerHTML=TABS.map(([k,l])=>{ const c=actionsFor(n).filter(x=>AX[x][0]===k).length; return `<button data-tab="${k}" class="${k===popTab?'on':''}" ${c?'':'disabled'}>${l}<small>${c}</small></button>`; }).join('');
  $('#pp-acts').innerHTML=ks.map(k=>{ const A=AXI(k), chk=checkAction(k,p,self?null:n), c=costOf(k,p,self?null:n); const od=chk.od; const attack=(A.note||'').startsWith('The %');
    return `<button data-act="${k}" class="act ${k==='attack'?'red':''}" ${chk.why?'disabled':''}><b>${esc(A.label)}</b><small>${esc(costStr(c))}${od?` · ${attack?'progress':'odds'} ${pct(od.p)}`:''}</small>${chk.why?`<small class="why">${esc(chk.why)}</small>`:''}</button>`; }).join('')+`<button data-act="advisor" class="act adv"><b>Ask advisor</b><small>free · no time passes</small></button>`;
  $('#pp-conf').style.display='none'; $('#pp-acts').style.display='grid'; }
function showConfirm(k){ const n=popTarget, p=P(), self=n===p, A=AXI(k), chk=checkAction(k,p,self?null:n); if(chk.why) return; const c=costOf(k,p,self?null:n), od=chk.od; popPending=k;
  const attack=(A.note||'').startsWith('The %');
  $('#pp-conf').innerHTML=`<h4>${esc(A.label)}${self?'':' → '+esc(nm(n))}</h4><div class="cf-cost">Cost: <b>${esc(costStr(c))}</b>${A.noTime?' · no time passes':' · takes 1 month'}</div>
   ${od?`<div class="cf-odds">${attack?'Monthly progress chance':(k==='summit'?'Pact chance':'Chance they accept / it succeeds')}: <b>${pct(od.p)}</b><ul>${od.f.map(([l,v])=>`<li class="${v>0?'good':v<0?'bad':''}">${esc(l)}${v?` <small>${v>0?'+':''}${Math.round(v*100)}%</small>`:''}</li>`).join('')}</ul></div>`:'<div class="cf-odds">Certain — no one can refuse this.</div>'}
   ${A.note?`<div class="cf-note">${esc(A.note)}</div>`:''}
   <div class="row"><button id="cf-back">◀ Back</button><button id="cf-go" class="${k==='attack'||k==='break'?'red':'go'}">Commit ▸</button></div>`;
  $('#pp-acts').style.display='none'; $('#pp-conf').style.display='block';
  $('#cf-back').onclick=()=>{ popPending=null; renderActs(); }; $('#cf-go').onclick=()=>{ const t=popTarget; submit(k,t); }; }
function showPopup(n,rid,x,y){ popTarget=n; popRegion=rid; popOpenedAt=lastPtrType==='mouse'?0:Date.now(); const p=P(), pp=$('#popup'), st=S.nat[n];
  $('#pp-title').textContent=nm(n)+(n===p?' (you)':''); $('#pp-flag').style.background=D.N[n][1];
  const fr=S.fronts.find(f=>f.r===rid), oc=S.occ[rid];
  $('#pp-info').innerHTML=`<b>${esc(REG[rid].name)}</b> · ${TERR[REG[rid].t][0]}${REG[rid].river?' + river':''}${S.fort[rid]?' · forts '+S.fort[rid]:''}${fr?` · front ${Math.round(fr.prog)}%`:''}${oc?` · occupied, resistance ${Math.round(oc.res)}%`:''}<br>${IDEO(n)} · ${st.army.toFixed(0)} inf / ${st.arm.toFixed(1)} arm / ${st.art.toFixed(1)} art / ${st.air.toFixed(1)} air / ${st.nav.toFixed(1)} fleets · ind ${st.ind.toFixed(1)} · stab ${Math.round(st.stab)}${n!==p?`<br>Relations <b>${rel(p,n)}</b>${atWar(p,n)?' <b class="war">AT WAR</b>':''}${pactsBetween(p,n).length?' · '+pactsBetween(p,n).map(t=>TNAME[t.type]||t.type).join(', '):''}${grudge(n,p)>1?` · <b class="war">remembers your betrayal</b>`:''}${factionOf(n)?' · '+esc(factionOf(n).name):''}`:''}`;
  popTab=n===p?'economy':'diplomacy'; renderActs();
  pp.style.display='block'; if(MOBILE()){ pp.classList.add('sheet'); pp.style.left=''; pp.style.top=''; } else { pp.classList.remove('sheet'); const w=pp.offsetWidth,h=pp.offsetHeight; pp.style.left=Math.max(8,Math.min(innerWidth-w-8,x+10))+'px'; pp.style.top=Math.min(innerHeight-h-8,Math.max(8,y-20))+'px'; } }
function hidePopup(){ $('#popup').style.display='none'; }
$('#pp-tabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b||b.disabled) return; popTab=b.dataset.tab; renderActs(); });
$('#pp-acts').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b||b.disabled||Date.now()-popOpenedAt<350) return; const k=b.dataset.act; if(k==='advisor') return submit('advisor',popTarget); showConfirm(k); });
$('#pp-close').onclick=hidePopup;

/* ================= MODALS ================= */
function showReport(title,body,bullets,heads){ $('#rp-title').textContent=title; $('#rp-body').innerHTML=body+(bullets.length?`<h4>What changed</h4><ul class="chg">${bullets.join('')}</ul>`:'')+(heads.length?`<h4>Headlines</h4><ul class="hd">${heads.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>`:''); $('#report').style.display='flex';
}
$('#rp-ok').onclick=()=>{ $('#report').style.display='none'; };
function askDecision(e){ return new Promise(res=>{ showBusy(false); $('#dc-title').textContent=e.title; $('#dc-text').textContent=typeof e.text==='function'?e.text():e.text; $('#dc-opts').innerHTML=e.opts.map((o,i)=>`<button data-i="${i}">${esc(o.t)}</button>`).join(''); $('#decision').style.display='flex';
  $('#dc-opts').querySelectorAll('button').forEach(b=>b.onclick=()=>{ $('#decision').style.display='none'; showBusy(true); res(+b.dataset.i); }); }); }
function showBusy(on){ $('#busy').style.display=on?'flex':'none'; if(!on) $('#busy-t').textContent='The ink is drying…'; }

/* ================= TOOLBAR / SETTINGS ================= */
$('#btn-pass').onclick=passTurn;
$('#btn-save').onclick=()=>{ const c={...S}; delete c._hops; localStorage.setItem('ww2ai.v4.slot'+$('#slot').value,JSON.stringify(c)); log('event',`Saved to slot ${$('#slot').value}.`); renderLog(); };
$('#btn-load').onclick=()=>{ if(!loadFrom('ww2ai.v4.slot'+$('#slot').value)) alert('Slot empty.'); };
$('#btn-export').onclick=()=>{ const a=document.createElement('a'); const c={...S}; delete c._hops; a.href=URL.createObjectURL(new Blob([JSON.stringify(c)],{type:'application/json'})); a.download=`inkiron-${S.y}-${S.m+1}.json`; a.click(); };
$('#btn-import').onclick=()=>$('#importfile').click();
$('#importfile').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ const o=JSON.parse(await f.text()); if(o.v!==4) throw 0; S=o; dirty=true; renderAll(); }catch(err){ alert('Bad save file'); } };
$('#btn-new').onclick=()=>{ if(confirm('Start a new game?')) showStart(); };
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{ document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on')); t.classList.add('on'); document.querySelectorAll('.pane').forEach(p=>p.style.display=p.id===t.dataset.p?'block':'none'); });
$('#rels').addEventListener('click',e=>{ const r=e.target.closest('.rr'); if(!r) return; const n=r.dataset.n, cap=capOf(n); showPopup(n,cap,innerWidth/2,innerHeight/3); });
/* ================= START ================= */
function showStart(){ const majors=NAT.filter(n=>D.N[n][8]), minors=NAT.filter(n=>!D.N[n][8]&&n!=='NSP');
  const btn=n=>`<button class="nb" data-n="${n}"><span class="sw" style="background:${D.N[n][1]}"></span>${esc(nm(n))}<small>${IDEO(n)}</small></button>`;
  $('#start-majors').innerHTML=majors.map(btn).join(''); $('#start-minors').innerHTML=minors.map(btn).join('');
  $('#start').style.display='flex'; $('#start-continue').style.display=localStorage.getItem(SAVE_KEY)?'inline-block':'none';
  document.querySelectorAll('#start .nb').forEach(b=>b.onclick=()=>{ $('#start').style.display='none'; newGame(b.dataset.n); }); }
$('#start-continue').onclick=()=>{ if(loadFrom(SAVE_KEY)){ $('#start').style.display='none'; centerOn(P()); } };

window.WW2={ get state(){return S;}, REG, ADJ, LANDADJ, rel, AX, checkAction, doAction, grudge, rep, warScore, factionOf, betray, COAST, frontCalc, eff, endMonth, submit, passTurn, VW,
  regionXY(rid){ const [x,y]=toPx(REG[rid].lon,REG[rid].lat); const b=canvas.getBoundingClientRect(); return [b.left+x*b.width/canvas.width, b.top+y*b.height/canvas.height]; },
  focus(rid,s){  const [x,y]=toPx(REG[rid].lon,REG[rid].lat); VW.s=VW.fit*(s||6); VW.x=wrap.clientWidth/2-x*VW.s; VW.y=wrap.clientHeight/2-y*VW.s; applyView(); }, cellOwnerAt(rid){ return S.owner[rid]; },
  regionPixels(rid){ const i=RIDS.indexOf(rid), out=[]; for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(GRID[r*COLS+c]===i){ const d=ctx.getImageData(c*CS+1,r*CS+1,1,1).data; out.push([d[0],d[1],d[2]]); } return out; }, pixelAt(rid){ const [x,y]=toPx(REG[rid].lon,REG[rid].lat); const d=ctx.getImageData(Math.round(x)+6,Math.round(y)+6,1,1).data; return [d[0],d[1],d[2]]; }, RGB };
(function init(){ fitView(); showStart(); })();
})();
