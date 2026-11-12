/* Banco de completado: oclusión simulada por punto de vista (como Yang et al. 2026: se quitan los p % de puntos más cercanos al punto de vista dentro de un cono de ±45°),
   luego detección + completarNube sobre la nube ocluida, y métricas contra la nube original: distancia de Chamfer (m) y F-score con umbral τ. */
const fs=require('fs');const OPC=new Function(fs.readFileSync(process.argv[2],'utf8')+'\nreturn OPC;')();
const f=process.argv[3], pcts=(process.argv[4]||'10,30,50').split(',').map(Number), vistaArg=process.argv[5]||'lateral';
function pipeline(xyz){const c={xyz,offset:[0,0,0]};c.total=c.kept=xyz.length/3;let O=OPC.orient(c,'z',1);const dk=OPC.deckLevel(O),gr=OPC.groundLevel(O);const S=OPC.detectSupports(O,dk,gr);if(S.skew)O=OPC.applySkew(O,{phi:S.skew,tm:S.skewTm});const sup=OPC.estribosHueco(O,dk,gr,S.supports).supports;
 const q=OPC.calidadNube(O,dk,gr,sup);const mp=Math.max(3,Math.round(15*Math.min(1,c.kept/601243)));const sg=OPC.suggestType(O,dk,gr,sup,{zmin:gr+.2*(dk-gr),zmax:dk-.38},mp,{left:'none',right:'none'});
 const arcos=sg.tipo==='arco'?OPC.archAll(O,sup,gr+.2*(dk-gr),dk-.38,mp):[];const D=OPC.dimensiones(O,dk,gr,sup);const R=OPC.elementos(O,dk,gr,sup,{calidad:q,dims:D,arcos,superestructura:sg.superestructura});
 const F=OPC.fichaInspeccion(O,R,{calidad:q});const K=OPC.completitud(O,R,F,{espaciado:q.espaciado});const C=OPC.completarNube(O,R,F,{espaciado:q.espaciado});return {O,R,F,K,C,q,sup};}
/* mundo→marco de la nube original: usamos siempre el marco (s,t,z) de la nube ocluida para sus puntos y para los generados; la original se lleva al mismo marco con O.tr */
/* grilla para vecino más cercano aproximado (celdas de lado h; busca en 27 celdas; distancia exacta dentro) */
function Grid(P,h){const M=new Map();const n=P.length/3;const k=(a,b,c)=>a*1e8+b*1e4+c;for(let i=0;i<n;i++){const a=Math.floor(P[3*i]/h)+5000,b=Math.floor(P[3*i+1]/h)+5000,c=Math.floor(P[3*i+2]/h)+5000;const key=k(a,b,c);let L=M.get(key);if(!L){L=[];M.set(key,L);}L.push(i);}
 return {nn:(x,y,zz)=>{const a=Math.floor(x/h)+5000,b=Math.floor(y/h)+5000,c=Math.floor(zz/h)+5000;let best=Infinity;for(let da=-1;da<=1;da++)for(let db=-1;db<=1;db++)for(let dc=-1;dc<=1;dc++){const L=M.get(k(a+da,b+db,c+dc));if(!L)continue;for(const i of L){const d=(P[3*i]-x)**2+(P[3*i+1]-y)**2+(P[3*i+2]-zz)**2;if(d<best)best=d;}}return best===Infinity?h*h*9:best;}};}
function metricas(A,B,tau){/* A: evaluada, B: verdad; muestreo ≤ 60k puntos por lado */const h=Math.max(tau*2,.1),sub=(P,n)=>{const m=P.length/3,st=Math.max(1,Math.ceil(m/n)),Q=[];for(let i=0;i<m;i+=st)Q.push(P[3*i],P[3*i+1],P[3*i+2]);return Q;};
 /* rejillas con las nubes completas; solo se muestrean los puntos de consulta */const a=sub(A,40000),b=sub(B,40000),GA=Grid(A,h),GB=Grid(B,h);let sAB=0,pAB=0,na=a.length/3;for(let i=0;i<na;i++){const d=GB.nn(a[3*i],a[3*i+1],a[3*i+2]);sAB+=Math.sqrt(d);if(d<=tau*tau)pAB++;}
 let sBA=0,pBA=0,nb=b.length/3;for(let i=0;i<nb;i++){const d=GA.nn(b[3*i],b[3*i+1],b[3*i+2]);sBA+=Math.sqrt(d);if(d<=tau*tau)pBA++;}
 const P=pAB/na,Rc=pBA/nb;return {CD:+(sAB/na+sBA/nb).toFixed(4),F:+(P+Rc>0?2*P*Rc/(P+Rc):0).toFixed(4),prec:+P.toFixed(3),rec:+Rc.toFixed(3)};}
(async()=>{let xyz;if(f.endsWith('.bin')){const b=fs.readFileSync(f);xyz=Float32Array.from(new Float32Array(b.buffer,b.byteOffset,b.length/4));}else{const p=await OPC.parseCloud(new Blob([fs.readFileSync(f)]),f.split('/').pop(),()=>{});xyz=p.xyz;}
 const n=xyz.length/3;let cx=0,cy=0,cz=0,mx=[Infinity,Infinity,Infinity],Mx=[-Infinity,-Infinity,-Infinity];for(let i=0;i<n;i++)for(let k=0;k<3;k++){const v=xyz[3*i+k];cx+=k==0?v:0;cy+=k==1?v:0;cz+=k==2?v:0;mx[k]=Math.min(mx[k],v);Mx[k]=Math.max(Mx[k],v);}cx/=n;cy/=n;cz/=n;
 const ext=Math.max(Mx[0]-mx[0],Mx[1]-mx[1]);/* punto de vista: lateral a nivel del suelo (escáner terrestre) o cenital (dron) */
 const dx=Mx[0]-mx[0],dy=Mx[1]-mx[1],largoX=dx>=dy;/* eje largo del puente */
 const V=vistaArg==='cenital'?[cx,cy,Mx[2]+ext]:vistaArg==='extremo'?(largoX?[mx[0]-ext*0.6,cy,mx[2]+1.5]:[cx,mx[1]-ext*0.6,mx[2]+1.5]):(largoX?[cx,mx[1]-ext*0.5,mx[2]+1.5]:[mx[0]-ext*0.5,cy,mx[2]+1.5]);
 const d2=new Float64Array(n),ang=new Uint8Array(n);const dir=[cx-V[0],cy-V[1],cz-V[2]];const dn=Math.hypot(...dir);for(let i=0;i<n;i++){const dx=xyz[3*i]-V[0],dy=xyz[3*i+1]-V[1],dz=xyz[3*i+2]-V[2];d2[i]=dx*dx+dy*dy+dz*dz;const c=(dx*dir[0]+dy*dir[1]+dz*dir[2])/(Math.sqrt(d2[i])*dn);ang[i]=c>=Math.SQRT1_2?1:0;}
 const idx=[];for(let i=0;i<n;i++)if(ang[i])idx.push(i);idx.sort((a,b)=>d2[a]-d2[b]);
 const base=pipeline(xyz);console.log(JSON.stringify({nube:f.split('/').pop(),n,vista:vistaArg,base:{apoyos:base.sup.map(p=>p.tipo[0]+((p.a+p.b)/2).toFixed(1)),indice:base.K&&+base.K.indice.toFixed(2),gen:base.C&&base.C.n}}));
 const tau=Math.max(2*base.q.espaciado,.05);
 /* oclusión por componente (como el artículo): dentro de la caja de cada cara se quitan los p % de puntos más cercanos a un punto de vista propio de esa cara, dentro de un cono de ±45° */
 const porComp=vistaArg==='componente';const O0=base.O,tm0=(base.R.marco.t0+base.R.marco.t1)/2,an0=base.R.marco.ancho||10;
 let seed=11;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
 const quitarComp=pc=>{seed=11;const Q=new Set();for(const it of base.F.elementos)for(const c of it.cajas||[]){const sm=c.s0+(c.s1-c.s0)*(.2+.6*rnd()),zm=(c.z0+c.z1)/2,lado=rnd()<.5?-1:1;let V;
   if(c.parte==='calzada')V=[sm,tm0+lado*an0*.3,c.z1+40];else if(c.parte==='baranda')V=[sm,tm0,c.z1+2];else if(c.parte==='cara inferior'||c.parte==='arco y montantes')V=[sm,tm0+lado*2*an0,c.z0-4];else V=[sm,tm0+lado*3*an0,zm];
   const dir=[sm-V[0],tm0-V[1],zm-V[2]],dn=Math.hypot(...dir),L=[];for(let i=0;i<O0.n;i++){const s=O0.s[i],t=O0.t[i],z=O0.z[i];if(s<c.s0||s>=c.s1||t<c.t0||t>c.t1||z<c.z0||z>c.z1)continue;const dx=s-V[0],dy=t-V[1],dz=z-V[2],d=Math.sqrt(dx*dx+dy*dy+dz*dz);if((dx*dir[0]+dy*dir[1]+dz*dir[2])/(d*dn)<Math.SQRT1_2)continue;L.push([d,i]);}
   L.sort((a,b)=>a[0]-b[0]);const k=Math.round(pc/100*L.length);for(let j=0;j<k;j++)Q.add(L[j][1]);}return Q;};
 for(const pc of pcts){const quitar=porComp?quitarComp(pc):new Set(idx.slice(0,Math.round(pc/100*n)));const keep=[];for(let i=0;i<n;i++)if(!quitar.has(i))keep.push(i);const q=new Float32Array(3*keep.length);keep.forEach((i,j)=>{q[3*j]=xyz[3*i];q[3*j+1]=xyz[3*i+1];q[3*j+2]=xyz[3*i+2];});
  const t0=Date.now();const X=pipeline(q);const O=X.O;/* nube original al marco de la ocluida: mismo orient aplicado a la original (misma transformación porque se reusa O.tr) */
  /* métricas en coordenadas de mundo: la nube ocluida ya está en mundo (q); los puntos generados se llevan a mundo con alMundo */
  const gen=[];if(X.C){const m=X.C.n,st=1;for(let i=0;i<m;i+=st){const W=OPC.alMundo(O,X.C.xyz[3*i],X.C.xyz[3*i+1],X.C.xyz[3*i+2]);gen.push(W[0],W[1],W[2]);}}
  const subq=Array.from(q);const comp=subq.concat(gen);
  const r={oclusion:pc,quitados:quitar.size,apoyos:X.sup.map(p=>p.tipo[0]+((p.a+p.b)/2).toFixed(1)+(p.inferido?'*':'')),indice:X.K&&+X.K.indice.toFixed(2),generados:X.C&&X.C.n,ms:Date.now()-t0,tau};
  r.crudo=metricas(subq,xyz,tau);r.completado=metricas(comp,xyz,tau);
  /* por fuente: precisión de lo generado frente a la nube original, y recuperación del hueco (puntos quitados que ahora tienen un vecino generado a ≤ τ) */
  if(X.C){const GT=Grid(xyz,Math.max(tau*2,.1));const pf={};for(let i=0;i<X.C.n;i++){const k=X.C.cod[i];const d=GT.nn(gen[3*i],gen[3*i+1],gen[3*i+2]);const o=pf[k]||(pf[k]={n:0,ok:0});o.n++;if(d<=tau*tau)o.ok++;}
   r.porFuente=Object.entries(pf).map(([k,o])=>({fuente:X.C.fuentes[k].id+'/'+X.C.fuentes[k].parte+' · '+X.C.fuentes[k].origen.slice(0,45),n:o.n,prec:+(o.ok/o.n).toFixed(2)}));
   { /* precisión en el hueco: solo los puntos generados a ≤ 0,5 m de algún punto quitado */ const qp=[];for(const i of quitar)qp.push(xyz[3*i],xyz[3*i+1],xyz[3*i+2]);const GQ=Grid(qp,.5);let n=0,ok=0;for(let i=0;i<X.C.n;i++){if(GQ.nn(gen[3*i],gen[3*i+1],gen[3*i+2])>.25)continue;n++;if(GT.nn(gen[3*i],gen[3*i+1],gen[3*i+2])<=tau*tau)ok++;}r.enHueco={n,prec:n?+(ok/n).toFixed(3):null};}
   const GG=Grid(gen,Math.max(tau*2,.1));let rec=0,tot=0;const qs=[...quitar];const st=Math.max(1,Math.ceil(qs.length/40000));for(let j=0;j<qs.length;j+=st){const i=qs[j];tot++;if(GG.nn(xyz[3*i],xyz[3*i+1],xyz[3*i+2])<=tau*tau)rec++;}r.huecoRecuperado=+(rec/tot).toFixed(3);}
  r.fuentes=X.C?X.C.lista.map(l=>`${l.id}/${l.parte}: ${l.n} (${l.origen.split(' (')[0].slice(0,40)})`):[];console.log(JSON.stringify(r));}
})();
