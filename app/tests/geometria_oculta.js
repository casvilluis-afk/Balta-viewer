// Experimento: IA con geometría nominal frente a IA con la geometría que la nube no registró, en puentes cuya geometría oculta difiere del modelo.
// Uso: node app/tests/geometria_oculta.js [prefijo del puente]   (Balta, Arco, Viga, Armadura)
global.self=undefined;const fs=require('fs'),path=require('path'),PL=path.join(__dirname,'..','..','plataforma');const OPC=new Function(fs.readFileSync(path.join(PL,'op_core.js'),'utf8')+'\nreturn OPC;')();
const MCD=JSON.parse(fs.readFileSync(path.join(PL,'data','modelo_c.json')));const F=MCD.faces,fit=MCD.fit,yv=c=>-c[1]/(2*c[0]),N0=MCD.nominal;
const B=[];
{const arches=[{a:2*yv(fit.izq.coef)-F.p1_L,b:F.p1_L,coef:fit.izq.coef},{a:F.p1_R,b:F.p2_L,coef:fit.centro.coef},{a:F.p2_R,b:F.abut_R,coef:fit.der.coef}];
['izq','centro','der'].forEach((k,i)=>{const c=MCD.completitud.find(r=>r.arch===k),g=MCD.geometria[k];arches[i].obs={rise:g.flecha,rms:g.rms_cm/100,clave:c.C_crown,arranque:c.C_springing};});
B.push({nm:'Balta (nube real)',type:'arco',G:{supports:[{a:arches[0].a,b:arches[0].a},{a:F.p1_L,b:F.p1_R},{a:F.p2_L,b:F.p2_R},{a:F.abut_R,b:F.abut_R}],arches,deckAxis:MCD.z_deck_axis,zBase:[MCD.z_base.p1,MCD.z_base.p2]},
 P:{E:N0.E_ci/1e6,rho:N0.rho_ci,rib_h:N0.rib_h,n_ribs:N0.n_ribs,I_factor:1,deck_A:N0.deck_A,deck_I:N0.deck_I,post_A:N0.post_A,post_I:N0.post_I,E_pier:N0.E_pier/1e6,pier_t:N0.pier_t,width:N0.width,w_deck:N0.w_deck,springing:'fixed'}});}
// arco hipotético de 2 vanos de 30 m, flecha 4 m (cobertura supuesta: clave 20 % y 90 %)
{const mk=(a,b,f,z0)=>{const ym=(a+b)/2,k=-4*f/((b-a)**2);return {a,b,coef:[k,-2*k*ym,k*ym*ym+z0+f]};};const A=[mk(0,30,4,0),mk(33,63,4,0)];A[0].obs={rise:4,rms:.02,clave:.2,arranque:.6};A[1].obs={rise:4,rms:.02,clave:.9,arranque:.7};
 B.push({nm:'Arco hipotético 2×30 m',type:'arco',G:{supports:[{a:0,b:0},{a:30,b:33},{a:63,b:63}],arches:A,deckAxis:5.2,zBase:[-6]},P:Object.assign({E:100,rho:7.2},{rib_h:.7,n_ribs:6,I_factor:1,deck_A:.36,deck_I:.005,post_A:.05,post_I:5e-4,E_pier:5,pier_t:3,width:10,w_deck:100,springing:'fixed'})});}
B.push({nm:'Viga hipotética 20+25+20 m',type:'viga',G:{supports:[{a:0,b:0},{a:19.5,b:20.5},{a:44.5,b:45.5},{a:65,b:65}],deckAxis:6,cover:[.9,.3,.8]},P:{E:200,rho:7.85,deck_A:.6,deck_I:.35,w_deck:80}});
B.push({nm:'Armadura hipotética 2×40 m',type:'armadura',G:{supports:[{a:0,b:0},{a:39.5,b:40.5},{a:80,b:80}],deckAxis:6,cover:[.8,.4]},P:{E:200,rho:7.85,panels:10,truss_h:5,chord_A:.03,chord_I:2e-4,web_A:.015,web_I:5e-5,w_deck:60}});
const only=process.argv[2];
const mac=(u,v)=>{let a=0,b=0,c=0;for(let i=0;i<u.length;i++){a+=u[i]*v[i];b+=u[i]*u[i];c+=v[i]*v[i];}return a*a/(b*c||1);};
for(const br of B){ if(only&&!br.nm.startsWith(only))continue; const t0=Date.now();
 const fr0=OPC.build(br.type,br.G,br.P),sens=OPC.sensorsOf(fr0),m0=OPC.modal(fr0,8),Z=fr0.zoneDefs.length;
 const S=OPC.geomSigmas(br.type,br.G,1);
 const r=OPC.mulberry(4242),gs=()=>OPC.gaussR(r);
 // sensibilidad de las frecuencias a la geometría oculta (100 geometrías plausibles, sin daño)
 const sd=[];{const fs=[];for(let i=0;i<100;i++){const pg=OPC.perturbGeom(br.type,br.G,r,1),fr=OPC.build(br.type,pg.G,br.P),esc=new Float64Array(fr.el.length).fill(1);if(pg.fac)fr.zoneOf.forEach((z,t)=>{if(z>=0)esc[t]*=pg.fac[Math.min(pg.fac.length-1,Math.floor(z/3))];});fs.push(OPC.modal(fr,8,esc,1e-9).f);}
  for(let j=0;j<6;j++){const v=fs.map(f=>f[j]/m0.f[j]-1),m=v.reduce((a,b)=>a+b)/v.length;sd.push(Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/v.length));}}
 // puentes "reales": geometría oculta distinta del modelo (muestra de la misma incertidumbre), rigidez por elemento ±8 %, E −4 %
 const cases=[];for(let rep=0;rep<20;rep++){const pg=OPC.perturbGeom(br.type,br.G,r,1),P2=Object.assign({},br.P,{E:br.P.E*.96}),fr=OPC.build(br.type,pg.G,P2),e0=new Float64Array(fr.el.length).map(()=>Math.exp(gs()*.08));
   if(pg.fac)fr.zoneOf.forEach((q,t)=>{if(q>=0)e0[t]*=pg.fac[Math.min(pg.fac.length-1,Math.floor(q/3))];});
   for(let z=-2;z<Z;z++){const esc=e0.slice(),sev=z<0?0:.2+.3*r();if(z>=0)fr.zoneOf.forEach((q,t)=>{if(q===z)esc[t]*=1-sev;});cases.push({rep,z:Math.max(-1,z),isBase:z===-2,md:OPC.modal(fr,8,esc,1e-9)});}}
 const far=j=>m0.f.every((v,i)=>i===j||Math.abs(v/m0.f[j]-1)>.03),sel={f:[0,1,2,3,4,5],s:[0,1,2,3,4,5].filter(far),sens:sens.map((_,i)=>i)};console.log('modos con forma (sin modos cercanos <3 %):',sel.s.map(j=>'M'+(j+1)).join(' ')||'ninguno');
 const meas=md=>{const fm={},sh={};sel.f.forEach(j=>{const v0=sens.map(s=>m0.phi[j][s.dof]);let b=-1,k=j;md.phi.forEach((ph,i)=>{const M=mac(sens.map(s=>ph[s.dof]),v0)*(1-Math.min(1,Math.abs(md.f[i]/m0.f[j]-1)*2));if(M>b){b=M;k=i;}});fm[j]=md.f[k]*(1+gs()*.005);sh[j]=sens.map(s=>md.phi[k][s.dof]*(1+gs()*.05));});return {fm,sh};};
 const M=cases.map(c=>meas(c.md)),bases={};cases.forEach((c,i)=>{if(c.isBase)bases[c.rep]={fm:M[i].fm,shapes:M[i].sh};});
 console.log(`\n== ${br.nm} · ${Z} zonas · σ geom: ${JSON.stringify(S.arches?S.arches.map(a=>[+a.rise.toFixed(2),+a.spr.toFixed(2)]):S.spans.map(v=>+v.toFixed(3)))} · δf geom (1σ) por modo: ${sd.map(v=>(100*v).toFixed(1)+'%').join(' ')}`);
 for(const geom of [0,1]){const camp=OPC.freqCampaign(br.type,br.G,br.P,{nPerZone:60,nUndamaged:100,unc:.05,seed:7,NM:8,modelErr:.05,geom});
  for(const [nm,se] of [['formas',sel],['solo f',{f:sel.f,s:[],sens:sel.sens}]]){const I=OPC.trainModalIA(camp,se,.005,.05);
   for(const useBase of [false,true]){let ok=0,sp=0,fa=0,nh=0,nd=0,ood=0,oodH=0;cases.forEach((c,i)=>{if(c.isBase)return;const d=OPC.freqPredict(I,Z,OPC.modalMeasFeat(camp,se,M[i].fm,M[i].sh,useBase?bases[c.rep]:null));if(d.ood)ood++;
     if(c.z<0){nh++;if(d.ood)oodH++;if(d.cls>=0&&d.conclusive&&!d.ood)fa++;}else{nd++;if(d.cls===c.z&&!d.ood)ok++;if(d.cls>=0&&!d.ood&&camp.spanOfZone[d.cls]===camp.spanOfZone[c.z])sp++;}});
    console.log(`IA ${geom?'CON geometría oculta':'geometría nominal  '} · ${nm.padEnd(6)} · ${useBase?'línea base':'vs modelo '} | interna ${Math.round(100*I.metrics.localizacion)}% | zona ${Math.round(100*ok/nd)}% vano ${Math.round(100*sp/nd)}% | falsas alarmas ${fa}/${nh} | sanos fuera de dominio ${oodH}/${nh} | total OOD ${ood}/${nh+nd}`);}}}
 console.log('tiempo',((Date.now()-t0)/1000).toFixed(0),'s');}
