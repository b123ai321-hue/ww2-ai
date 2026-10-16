// WW2-AI map + nation data. All shapes hand-plotted (lon,lat), original & simplified.
window.WW2DATA = (function(){
const LAND = {
 main: [[-9.5,43],[-8,43.7],[-1.8,43.4],[-1.4,46],[-2.5,47.3],[-4.7,48],[-1.5,48.7],[-1.3,49.6],[0.2,49.7],[1.6,50.9],[3,51.3],[4,51.9],[4.8,53],[7,53.5],[8.6,53.9],[8.8,54.9],[8.1,56.6],[10.4,57.7],[10.5,56.2],[10.9,54.4],[11,54],[13.4,54.4],[14.3,53.9],[16.5,54.5],[18.5,54.7],[19.9,54.9],[21.1,55.3],[21,56.7],[22,57.6],[24.4,57.2],[23.8,59.3],[28,59.5],[30.2,59.9],[29,60.2],[26,60.4],[22.8,59.9],[21.3,60.9],[21.5,62.3],[25.2,65],[24.5,65.8],[22.3,65.8],[21.2,64.5],[19,63.5],[17.4,62.4],[17.2,61],[18.8,60],[18,59.3],[16.7,57.5],[16.4,56.2],[14.2,55.4],[12.8,55.6],[12.6,56.6],[11.8,58.2],[10.9,59.1],[10.5,59.9],[9.7,59],[8,58.1],[5.7,58.9],[5,60.5],[5,62],[7.5,63.3],[10,64.3],[12.5,66],[14,67.5],[16,68.5],[19,69.8],[23.5,70.8],[28,71],[31,70],[32.5,69.2],[41,67.5],[40,66],[34.8,64.5],[36.5,64],[40,64.6],[44,66.5],[45,68],[45,36.9],[36,36.2],[32,36.1],[30.5,36.4],[28,36.7],[27.2,37.9],[26.3,38.6],[26.7,39.5],[26.2,40.1],[26,40.8],[24,40.8],[23.7,40.2],[22.6,40.4],[23,39.3],[24,38.2],[22.9,36.5],[21.7,36.8],[21.1,37.8],[21.2,38.4],[20.2,39.6],[19.4,40.4],[19.4,41.8],[18.5,42.5],[16,43.5],[15,44.2],[13.6,45.1],[13.6,45.8],[12.3,45.4],[12.4,44.2],[13.6,43.5],[16,41.9],[18.5,40.2],[17.1,40.5],[16.6,39.6],[17.1,39],[16.1,37.9],[15.6,38.2],[15.8,40],[14.3,40.8],[12.5,41.7],[11.1,42.4],[10.2,43.9],[8.7,44.4],[7.5,43.8],[6,43.1],[4.6,43.4],[3,43.2],[3.2,41.9],[0.9,41],[-0.3,39.4],[0.2,38.7],[-0.7,37.6],[-2.1,36.7],[-4.4,36.7],[-5.6,36],[-6.3,36.8],[-7.4,37.2],[-8.9,37],[-8.8,38.7],[-9.5,39.4],[-8.8,41.2]],
 africa: [[-10,30],[-10,35.8],[-5.9,35.9],[-2,35.1],[3,36.8],[10,37.3],[11,35],[10.5,34],[15,32.4],[19,30.3],[20.2,32],[22,32.9],[25,31.8],[30,31.3],[34.3,31.3],[35,33],[35.8,35],[35.9,36.15],[44.9,36.85],[45,30]],
 gb: [[-5.7,50],[-3,50.2],[1.4,51.2],[1.7,52.7],[0.2,53.5],[-0.2,54.4],[-1.6,55.6],[-2.1,57.2],[-1.8,57.6],[-4,57.6],[-3,58.6],[-5,58.6],[-6.2,57.5],[-5.6,56.3],[-5,55],[-3.3,54.8],[-3.3,54],[-3,53.3],[-4.6,53.3],[-4.2,52.3],[-5.2,51.7],[-3,51.5]],
 ireland: [[-6,52.2],[-6,53.9],[-5.5,54.6],[-6.3,55.3],[-7.6,55.3],[-8.5,54.6],[-10,54.2],[-9.5,53],[-10.2,51.6],[-8.5,51.6]],
 sicily: [[12.4,38.1],[15.6,38.3],[15.1,36.7],[12.5,37.6]],
 sardinia: [[8.4,39],[8.2,40.9],[9.8,41],[9.6,39.1]],
 corsica: [[8.6,41.4],[8.6,42.9],[9.4,43],[9.5,42]],
 crete: [[23.5,35.6],[26.3,35.3],[26,34.9],[24,35.1]],
 zealand: [[11.2,55.2],[11.1,55.9],[12.6,56.1],[12.5,55.2]]
};
const SEA = { black: [[28,41.5],[28.6,43.7],[29.7,45.2],[30.8,46.5],[31.8,46.6],[33.6,46.1],[32.5,45.4],[33.5,44.5],[35.5,45],[36.5,45.3],[38,47.1],[39.3,47.1],[38,46],[37.8,44.7],[39.8,43.4],[41.6,41.6],[41.5,41.1],[37,41.1],[35,42],[32,41.8],[29.1,41.2]],
 caspian: [[47,45],[46.8,41],[45.2,42],[45.3,45.2]] };
// [id, name, owner, lon, lat]
const R = [
 ['lon','London & South','UK',-0.5,51.8],['mid','Midlands','UK',-2,53],['sco','Scotland','UK',-4,56.8],['wal','Wales','UK',-3.8,52.2],['uls','Ulster','UK',-6.7,54.6],
 ['egy','Egypt','UK',29,30.5],['pal','Palestine','UK',35.3,31.2],['irq','Iraq','UK',42,33],
 ['ire','Ireland','IRE',-8,53.2],
 ['par','Paris','FRA',2.4,48.8],['nor','Normandy & Brittany','FRA',-2,48.2],['als','Alsace-Lorraine','FRA',6.5,48.6],['bur','Burgundy','FRA',4.5,46.8],['aqu','Aquitaine','FRA',0,44.5],['pro','Provence','FRA',5.5,44],['cor','Corsica','FRA',9.1,42.1],
 ['alg','Algeria','FRA',3,34],['mor','Morocco','FRA',-6,33],['tun','Tunisia','FRA',9.5,34],['syr','Syria & Lebanon','FRA',38,35],
 ['mad','Castile','ESP',-3.7,40.4],['cat','Catalonia','ESP',1.5,41.7],['and','Andalusia','ESP',-4.5,37.5],['gal','Galicia','ESP',-7.3,42.5],['ara','Aragon','ESP',-1,41.5],
 ['por','Portugal','POR',-8.2,39.5],
 ['bel','Belgium','BEL',4.5,50.7],['ned','Netherlands','NED',5.5,52.3],['lux','Luxembourg','LUX',6.1,49.7],['swi','Switzerland','SWI',8,46.8],
 ['ber','Brandenburg','GER',13.4,52.5],['rhi','Rhineland','GER',7,50.8],['saa','Saar','GER',6.9,49.35],['bav','Bavaria','GER',11.5,48.6],['sax','Saxony','GER',12.6,51],['han','Hanover','GER',9.5,52.8],['sch','Schleswig','GER',9.6,54.3],['pom','Pomerania','GER',15,53.7],['sil','Silesia','GER',16.8,51],['epr','East Prussia','GER',21,54.2],['bad','Baden-Wurttemberg','GER',8.6,48.4],
 ['dnz','Danzig','DNZ',18.6,54.3],
 ['vie','Vienna','AUT',15.8,48],['tyr','Tyrol','AUT',12,47.2],
 ['boh','Bohemia','CZE',14.4,49.9],['sud','Sudetenland','CZE',13.4,50.4],['mor2','Moravia','CZE',17,49.4],['slo','Slovakia','CZE',19.5,48.8],['rut','Ruthenia','CZE',23,48.4],
 ['war','Warsaw','POL',21,52.2],['poz','Poznan','POL',17,52.4],['kra','Krakow','POL',20,50],['lwo','Lwow','POL',24,49.8],['wil','Wilno','POL',25.5,54],['pol','Polesie','POL',26,52],
 ['lit','Lithuania','LIT',23.9,55.3],['mem','Memel','LIT',21.4,55.6],['lat','Latvia','LAT',24.5,56.9],['est','Estonia','EST',25.5,58.7],
 ['hel','Southern Finland','FIN',25,61],['kar','Finnish Karelia','FIN',29,61.6],['oul','Oulu','FIN',26,65],['lap','Finnish Lapland','FIN',26,68.5],
 ['sto','Svealand','SWE',17,59.6],['got','Gotaland','SWE',14,57],['nrl','Norrland','SWE',17,64],['sla','Swedish Lapland','SWE',20,67.3],
 ['osl','Ostlandet','NOR',10,60.5],['brg','Vestlandet','NOR',6.5,61],['trd','Trondelag','NOR',11,64],['nar','Nordland','NOR',16,68.3],['fin','Finnmark','NOR',25,70],
 ['den','Jutland','DEN',9.3,56],['dzl','Zealand','DEN',11.9,55.6],
 ['mos','Moscow','SOV',37.6,55.8],['len','Leningrad','SOV',31,59.5],['blr','Byelorussia','SOV',28.5,53.8],['kie','Kiev','SOV',31.5,50.2],['ode','Odessa','SOV',30.5,47.3],['cri','Crimea','SOV',34.3,45.2],['kha','Kharkov','SOV',36.5,49.5],['cau','North Caucasus','SOV',42,44.5],['arc','Archangelsk','SOV',41,63.5],['mur','Murmansk','SOV',33,68],['vol','Volga','SOV',43,53],['ksr','Soviet Karelia','SOV',33,63],['smo','Smolensk','SOV',32.5,55],['sta','Stalingrad','SOV',43,48.3],['tra','Transcaucasia','SOV',44.3,41.8],['gor','Gorky','SOV',43,57.5],
 ['wal2','Wallachia','ROM',25,44.5],['trn','Transylvania','ROM',24,46.5],['mol','Moldavia','ROM',26.8,47],['bes','Bessarabia','ROM',28.6,46.8],['buk','Bukovina','ROM',25.8,48.1],['dob','Dobruja','ROM',28.3,44.3],
 ['hun','Hungary','HUN',18.8,47.2],['ehu','Alfold','HUN',21.3,47.3],
 ['ser','Serbia','YUG',20.8,44],['cro','Croatia','YUG',16,45.4],['bos','Bosnia','YUG',17.8,44],['slv','Slovenia','YUG',14.7,46.1],['mac','Vardar Macedonia','YUG',21.5,41.8],
 ['bul','Bulgaria','BUL',25.2,42.7],['alb','Albania','ALB',20,41],
 ['ath','Attica & Morea','GRE',22.5,38],['gma','Greek Macedonia','GRE',23,40.6],['thr','Western Thrace','GRE',25.3,41.1],['epi','Epirus & Thessaly','GRE',21.5,39.6],['cre','Crete','GRE',24.8,35.25],
 ['ist','Istanbul & Thrace','TUR',27.5,41.3],['ana','Central Anatolia','TUR',32.5,39],['aeg','Aegean Coast','TUR',28,38.5],['ean','Eastern Anatolia','TUR',40,39],['pon','Pontus','TUR',36,40.6],
 ['rom','Lazio','ITA',12.5,42],['pie','Piedmont & Lombardy','ITA',8.6,45.3],['ven','Venetia','ITA',12,45.8],['nap','Campania','ITA',15,41],['sic','Sicily','ITA',14,37.5],['sar','Sardinia','ITA',9,40],['apu','Apulia & Calabria','ITA',16.6,40.1],['tus','Tuscany','ITA',11.2,43.5],
 ['lib','Tripolitania','ITA',14,31],['cyr','Cyrenaica','ITA',21.5,31.6]
];
// Sea links between regions (naval adjacency)
const SEALINKS = [['lon','par'],['lon','nor'],['lon','bel'],['lon','ned'],['mid','ned'],['sco','brg'],['wal','ire'],['mid','uls'],['sic','apu'],['sic','tun'],['sar','cor'],['cor','tus'],['sar','tun'],['dzl','got'],['dzl','den'],['dzl','sch'],['den','osl'],['got','pom'],['sic','lib'],['and','mor'],['cre','ath'],['cre','cyr'],['ist','ana'],['egy','pal'],['est','hel'],['sto','hel'],['sto','lat'],['cri','pon'],['ode','ist'],['alb','apu'],['pro','cor'],['cat','sar']];
// code: [name, color, hatch angle, ideology, army, industry, capital region, major]
const N = {
 GER:['Germany','#5d5a55',45,'fascist',8,9,'ber',1], UK:['United Kingdom','#a8443a',-45,'democratic',6,9,'lon',1], FRA:['France','#456996',0,'democratic',8,7,'par',1],
 ITA:['Italy','#5d8448',90,'fascist',6,5,'rom',1], SOV:['Soviet Union','#82281f',30,'communist',9,7,'mos',1], ESP:['Spain','#c2903a',-30,'democratic',3,3,'mad',0],
 POL:['Poland','#b87a86',60,'authoritarian',5,3,'war',0], POR:['Portugal','#7c8a3c',-60,'authoritarian',2,2,'por',0], IRE:['Ireland','#4f8a5e',15,'democratic',1,1,'ire',0],
 BEL:['Belgium','#c7b04a',75,'democratic',2,3,'bel',0], NED:['Netherlands','#d27a34',-15,'democratic',2,3,'ned',0], LUX:['Luxembourg','#8b6ca8',0,'democratic',1,1,'lux',0],
 SWI:['Switzerland','#b83a3a',90,'democratic',3,3,'swi',0], AUT:['Austria','#c9c2b0',-75,'authoritarian',2,2,'vie',0], CZE:['Czechoslovakia','#6f8fb5',45,'democratic',4,4,'boh',0],
 DNZ:['Danzig','#9a9a8a',0,'authoritarian',1,1,'dnz',0], LIT:['Lithuania','#9aa65a',-45,'authoritarian',1,1,'lit',0], LAT:['Latvia','#9b4d5c',30,'authoritarian',1,1,'lat',0],
 EST:['Estonia','#5f7f9a',-30,'authoritarian',1,1,'est',0], FIN:['Finland','#e0e0d8',60,'democratic',3,2,'hel',0], SWE:['Sweden','#4a74a8',-60,'democratic',3,4,'sto',0],
 NOR:['Norway','#9a5a4a',15,'democratic',1,2,'osl',0], DEN:['Denmark','#b85a5a',-15,'democratic',1,2,'dzl',0], ROM:['Romania','#c9a23a',75,'authoritarian',4,3,'wal2',0],
 HUN:['Hungary','#7a9a6a',-75,'authoritarian',3,2,'hun',0], YUG:['Yugoslavia','#7a6aa0',0,'authoritarian',4,2,'ser',0], BUL:['Bulgaria','#6a8a5a',45,'authoritarian',2,1,'bul',0],
 ALB:['Albania','#a0705a',-45,'authoritarian',1,1,'alb',0], GRE:['Greece','#7aa0c8',90,'authoritarian',2,2,'ath',0], TUR:['Turkey','#a88a6a',30,'authoritarian',4,3,'ana',0]
};
return {LAND, SEA, R, SEALINKS, N};
})();
