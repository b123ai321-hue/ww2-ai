/* Ink & Iron: fast world grid builder (scanline land fill + bucketed nearest-seed Voronoi). Shared by game and tools. */
(function(root){
function build(D, seeds, o){ // seeds: [{lon,lat}] ; o:{LON0,LAT1,KX,STEP,COLS,ROWS}
  const {LON0,LAT1,KX,STEP,COLS,ROWS}=o, polys=Object.values(D.LAND), seas=Object.values(D.SEA);
  const LM=new Int16Array(COLS*ROWS).fill(-1); const xs=[];
  const lonC=c=>LON0+(c+0.5)*STEP/KX, cOf=lon=>(lon-LON0)*KX/STEP-0.5;
  function spans(poly,lat,cb){ xs.length=0; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const yi=poly[i][1],yj=poly[j][1]; if((yi>lat)!==(yj>lat)) xs.push(poly[i][0]+(lat-yi)*(poly[j][0]-poly[i][0])/(yj-yi)); }
    xs.sort((a,b)=>a-b); for(let k=0;k+1<xs.length;k+=2){ const c0=Math.max(0,Math.ceil(cOf(xs[k]))), c1=Math.min(COLS-1,Math.floor(cOf(xs[k+1]))); if(c1>=c0) cb(c0,c1); } }
  for(let r=0;r<ROWS;r++){ const lat=LAT1-(r+0.5)*STEP, row=r*COLS;
    for(let p=polys.length-1;p>=0;p--) spans(polys[p],lat,(a,b)=>{ for(let c=a;c<=b;c++) LM[row+c]=p; });
    for(const s of seas) spans(s,lat,(a,b)=>{ for(let c=a;c<=b;c++) LM[row+c]=-1; }); }
  // per-(landmass,bucket) candidate lists: any seed that can be nearest to some point of the bucket
  const B=1.6, NX=Math.ceil(400/B), bxy=(x,y)=>Math.floor((y+90)/B)*NX+Math.floor((x+200)/B);
  const cellOfSeed=s=>{ const c=Math.round(cOf(s.lon)), r=Math.round((LAT1-s.lat)/STEP-0.5); return (r>=0&&r<ROWS&&c>=0&&c<COLS)?LM[r*COLS+c]:-1; };
  const byLm=new Map(); const SX=new Float64Array(seeds.length), SY=new Float64Array(seeds.length);
  seeds.forEach((s,i)=>{ SX[i]=s.lon*KX; SY[i]=s.lat; const lm=cellOfSeed(s); (byLm.get(lm)||byLm.set(lm,[]).get(lm)).push(i); });
  const allIdx=seeds.map((s,i)=>i), cand=new Map(), diag=B*Math.SQRT2;
  function candidates(lm,b){ const key=lm*1e6+b; let l=cand.get(key); if(l) return l; const pool=byLm.get(lm)||allIdx; const cx=((b%NX)+0.5)*B-200, cy=(Math.floor(b/NX)+0.5)*B-90;
    let dmin=1e18; const ds=pool.map(i=>{ const d=Math.hypot(SX[i]-cx,SY[i]-cy); if(d<dmin) dmin=d; return d; });
    l=Int32Array.from(pool.filter((i,k)=>ds[k]<=dmin+diag)); cand.set(key,l); return l; }
  const GRID=new Int16Array(COLS*ROWS).fill(-1);
  for(let r=0;r<ROWS;r++){ const lat=LAT1-(r+0.5)*STEP, row=r*COLS;
    for(let c=0;c<COLS;c++){ const lm=LM[row+c]; if(lm<0) continue; const x=lonC(c)*KX; const l=candidates(lm,bxy(x,lat)); let best=l[0],bd=1e18;
      for(let k=0;k<l.length;k++){ const i=l[k], dx=SX[i]-x, dy=SY[i]-lat, d=dx*dx+dy*dy; if(d<bd){bd=d;best=i;} } GRID[row+c]=best; } }
  return {GRID,LM};
}
const api={build}; if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.WW2GRID=api;
})(typeof window!=='undefined'?window:globalThis);
