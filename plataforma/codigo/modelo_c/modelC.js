/* Modelo C en JavaScript: réplica de modelC.py + fe2d.Frame2D.modal (unidades kN, m, s, t). */
const MC_NSEG=24;
function mcRibSection(h,n){const b=.25,tf=.05,tw=.04,hw=h-2*tf;const A=2*b*tf+hw*tw;const I=2*(b*tf**3/12+b*tf*((h-tf)/2)**2)+tw*hw**3/12;return [n*A,n*I];}
function mcPolyval(c,y){return c[0]*y*y+c[1]*y+c[2];}
function mcBuild(D,pp){
  const p=Object.assign({},D.nominal,pp||{});const F=D.faces;
  let [Ar,Ir]=mcRibSection(p.rib_h,p.n_ribs);Ir*=p.I_factor;
  const nodes=[],mass=[],el=[],E=[],A=[],I=[],grp=[];
  const addN=(y,z)=>{nodes.push([y,z]);mass.push(0);return nodes.length-1;};
  const addE=(i,j,e,a,ii,g)=>{el.push([i,j]);E.push(e);A.push(a);I.push(ii);grp.push(g);};
  const arches=[],springs={};
  for(const k of ['izq','centro','der']){const c=D.fit[k].coef,yv=-c[1]/(2*c[0]);let a,b;
    if(k==='izq'){b=F.p1_L;a=p.left_span?b-p.left_span:2*yv-b;}else if(k==='centro'){a=F.p1_R;b=F.p2_L;}else{a=F.p2_R;b=F.abut_R;}
    const OA=(p.geo==='anterior'&&D.old_arches)?D.old_arches[k]:null;
    // geometría anterior: eje del nervio del modelo 2D previo llevado a la luz medida con ξ = (y−a)/(b−a)
    const zf=OA?(y=>{const yy=OA.y[0]+(y-a)/(b-a)*(OA.y[OA.y.length-1]-OA.y[0]);let j=1;while(j<OA.y.length-1&&OA.y[j]<yy)j++;const t=Math.max(0,Math.min(1,(yy-OA.y[j-1])/(OA.y[j]-OA.y[j-1])));return OA.z[j-1]+t*(OA.z[j]-OA.z[j-1]);}):(y=>mcPolyval(c,y)+p.rib_h/2);
    const ys=[],zs=[],ids=[];for(let i=0;i<=MC_NSEG;i++){const y=a+(b-a)*i/MC_NSEG;ys.push(y);zs.push(zf(y));ids.push(addN(y,zs[i]));}
    for(let i=0;i<MC_NSEG;i++)addE(ids[i],ids[i+1],p.E_ci,Ar,Ir,'arco_'+k);
    arches.push({k,ids,ys,zs});springs[k]=[ids[0],ids[ids.length-1]];}
  const r4=v=>Math.round(v*1e4)/1e4;
  const pc=[r4((F.p1_L+F.p1_R)/2),r4((F.p2_L+F.p2_R)/2)];
  const yset=new Set();arches.forEach(a=>a.ys.forEach(y=>yset.add(r4(y))));pc.forEach(y=>yset.add(y));
  const ydeck=[...yset].sort((a,b)=>a-b),deckN={};ydeck.forEach(y=>deckN[y]=addN(y,D.z_deck_axis));
  const dk=ydeck.map(y=>deckN[y]);for(let i=0;i<dk.length-1;i++)addE(dk[i],dk[i+1],p.E_ci,p.deck_A,p.deck_I,'tablero');
  arches.forEach(a=>{for(let i=1;i<a.ids.length-1;i++)addE(a.ids[i],deckN[r4(a.ys[i])],p.E_ci,p.post_A,p.post_I,'montante_'+a.k);});
  const pierA=p.pier_t*p.width,pierI=p.width*p.pier_t**3/12,fixed=[];
  for(const [pn,kl,kr] of [['p1','izq','centro'],['p2','centro','der']]){
    const nl=springs[kl][1],nr=springs[kr][0];const [yl,zl]=nodes[nl],[yr,zr]=nodes[nr];
    const top=addN((yl+yr)/2,(zl+zr)/2),base=addN((yl+yr)/2,D.z_base[pn]);
    addE(nl,top,p.E_pier*50,pierA,pierI,'pilar_'+pn);addE(top,nr,p.E_pier*50,pierA,pierI,'pilar_'+pn);addE(top,base,p.E_pier,pierA,pierI,'pilar_'+pn);
    const yd=ydeck.reduce((best,v)=>Math.abs(v-(yl+yr)/2)<Math.abs(best-(yl+yr)/2)?v:best,ydeck[0]);
    addE(top,deckN[yd],p.E_pier,pierA,pierI,'pilar_'+pn);fixed.push(base);}
  const fixedFull=[springs.izq[0],springs.der[1]],deckEnd=[dk[0],dk[dk.length-1]];
  // masas
  const m=new Float64Array(nodes.length);const n=ydeck.length;
  const lt=ydeck.map((y,i)=>i===0?(ydeck[1]-ydeck[0])/2:i===n-1?(ydeck[n-1]-ydeck[n-2])/2:(ydeck[i+1]-ydeck[i-1])/2);
  ydeck.forEach((y,i)=>m[deckN[y]]+=p.w_deck/9.81*lt[i]);
  el.forEach(([i,j],t)=>{if(grp[t].startsWith('arco')||grp[t].startsWith('montante')){const L=Math.hypot(nodes[j][0]-nodes[i][0],nodes[j][1]-nodes[i][1]);m[i]+=p.rho_ci*A[t]*L/2;m[j]+=p.rho_ci*A[t]*L/2;}});
  for(let i=0;i<m.length;i++)m[i]=Math.max(m[i],1e-3);
  const ndof=3*nodes.length,fx=new Uint8Array(ndof);
  const fixAll=k=>{fx[3*k]=fx[3*k+1]=fx[3*k+2]=1;};fixed.forEach(fixAll);
  if(p.springing==='fixed')fixedFull.forEach(fixAll);else fixedFull.forEach(k=>{fx[3*k]=fx[3*k+1]=1;});
  deckEnd.forEach(k=>{fx[3*k]=fx[3*k+1]=1;});
  return {nodes,el,E,A,I,grp,mass:m,fx,p,ydeck,deckN,arches,springs};
}
function mcK(fr,esc){const N=fr.nodes.length,nd=3*N,K=new Float64Array(nd*nd);
  fr.el.forEach(([i1,i2],j)=>{const dx=fr.nodes[i2][0]-fr.nodes[i1][0],dz=fr.nodes[i2][1]-fr.nodes[i1][1],L=Math.hypot(dx,dz),c=dx/L,s=dz/L;
    const Ej=fr.E[j]*(esc?esc[j]:1),EA=Ej*fr.A[j]/L,EI=Ej*fr.I[j];
    const k=[[EA,0,0,-EA,0,0],[0,12*EI/L**3,6*EI/L**2,0,-12*EI/L**3,6*EI/L**2],[0,6*EI/L**2,4*EI/L,0,-6*EI/L**2,2*EI/L],[-EA,0,0,EA,0,0],[0,-12*EI/L**3,-6*EI/L**2,0,12*EI/L**3,-6*EI/L**2],[0,6*EI/L**2,2*EI/L,0,-6*EI/L**2,4*EI/L]];
    const T=[[c,s,0,0,0,0],[-s,c,0,0,0,0],[0,0,1,0,0,0],[0,0,0,c,s,0],[0,0,0,-s,c,0],[0,0,0,0,0,1]];
    const d=[3*i1,3*i1+1,3*i1+2,3*i2,3*i2+1,3*i2+2];
    for(let a=0;a<6;a++)for(let b=0;b<6;b++){let v=0;for(let u=0;u<6;u++){if(!T[u][a])continue;for(let w=0;w<6;w++)if(T[w][b])v+=T[u][a]*k[u][w]*T[w][b];}K[d[a]*nd+d[b]]+=v;}});
  return K;}
// Jacobi para matrices simétricas pequeñas
function mcJacobi(Ain,n){const A=Float64Array.from(Ain),V=new Float64Array(n*n);for(let i=0;i<n;i++)V[i*n+i]=1;
  for(let sweep=0;sweep<60;sweep++){let off=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)off+=A[i*n+j]**2;if(off<1e-22)break;
    for(let p=0;p<n;p++)for(let q=p+1;q<n;q++){const apq=A[p*n+q];if(Math.abs(apq)<1e-300)continue;
      const th=(A[q*n+q]-A[p*n+p])/(2*apq),t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c;
      for(let k=0;k<n;k++){const akp=A[k*n+p],akq=A[k*n+q];A[k*n+p]=c*akp-s*akq;A[k*n+q]=s*akp+c*akq;}
      for(let k=0;k<n;k++){const apk=A[p*n+k],aqk=A[q*n+k];A[p*n+k]=c*apk-s*aqk;A[q*n+k]=s*apk+c*aqk;}
      for(let k=0;k<n;k++){const vkp=V[k*n+p],vkq=V[k*n+q];V[k*n+p]=c*vkp-s*vkq;V[k*n+q]=s*vkp+c*vkq;}}}
  const ev=[];for(let i=0;i<n;i++)ev.push(A[i*n+i]);return {ev,V};}
// Modal: problema generalizado K φ = λ M φ (M diagonal, masa rotacional = 1e-4·m), iteración en subespacio
function mcModal(fr,nmodes=6,esc=null){
  const K=mcK(fr,esc),N=fr.nodes.length,nd=3*N,free=[];for(let i=0;i<nd;i++)if(!fr.fx[i])free.push(i);
  const nf=free.length,Md=new Float64Array(nd);for(let i=0;i<N;i++){Md[3*i]=Md[3*i+1]=fr.mass[i];Md[3*i+2]=fr.mass[i]*1e-4;}
  const m=free.map(i=>Md[i]),L=new Float64Array(nf*nf);
  for(let a=0;a<nf;a++)for(let b=0;b<=a;b++)L[a*nf+b]=.5*(K[free[a]*nd+free[b]]+K[free[b]*nd+free[a]]);
  for(let j=0;j<nf;j++){let s=L[j*nf+j];for(let k=0;k<j;k++)s-=L[j*nf+k]**2;s=Math.sqrt(s);L[j*nf+j]=s;
    for(let i=j+1;i<nf;i++){let t=L[i*nf+j];for(let k=0;k<j;k++)t-=L[i*nf+k]*L[j*nf+k];L[i*nf+j]=t/s;}}
  const solve=x=>{const y=new Float64Array(nf);for(let i=0;i<nf;i++){let s=x[i];for(let k=0;k<i;k++)s-=L[i*nf+k]*y[k];y[i]=s/L[i*nf+i];}
    const z=new Float64Array(nf);for(let i=nf-1;i>=0;i--){let s=y[i];for(let k=i+1;k<nf;k++)s-=L[k*nf+i]*z[k];z[i]=s/L[i*nf+i];}return z;};
  const q=Math.min(nf,nmodes+8);let seed=12345;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647-.5;};
  let X=[];for(let j=0;j<q;j++){const v=new Float64Array(nf);for(let i=0;i<nf;i++)v[i]=rnd()/Math.sqrt(m[i]);X.push(v);}
  let lam=null,prev=null;
  for(let it=0;it<300;it++){
    const MX=X.map(v=>v.map((x,i)=>x*m[i])),Y=MX.map(solve);
    const Kr=new Float64Array(q*q),Mr=new Float64Array(q*q);
    for(let a=0;a<q;a++)for(let b=a;b<q;b++){let s=0,t=0;for(let i=0;i<nf;i++){s+=Y[a][i]*MX[b][i];t+=Y[a][i]*Y[b][i]*m[i];}Kr[a*q+b]=Kr[b*q+a]=s;Mr[a*q+b]=Mr[b*q+a]=t;}
    for(let a=0;a<q;a++)for(let b=a+1;b<q;b++){const v=.5*(Kr[a*q+b]+Kr[b*q+a]);Kr[a*q+b]=Kr[b*q+a]=v;}
    // Cholesky de Mr y reducción a forma estándar
    const C=Float64Array.from(Mr);for(let j=0;j<q;j++){let s=C[j*q+j];for(let k=0;k<j;k++)s-=C[j*q+k]**2;s=Math.sqrt(s);C[j*q+j]=s;for(let i=j+1;i<q;i++){let t=C[i*q+j];for(let k=0;k<j;k++)t-=C[i*q+k]*C[j*q+k];C[i*q+j]=t/s;}for(let i=0;i<j;i++)C[i*q+j]=0;}
    const Ci=new Float64Array(q*q);for(let c=0;c<q;c++){for(let i=0;i<q;i++){let s=i===c?1:0;for(let k=0;k<i;k++)s-=C[i*q+k]*Ci[k*q+c];Ci[i*q+c]=s/C[i*q+i];}}
    const T=new Float64Array(q*q);for(let a=0;a<q;a++)for(let b=0;b<q;b++){let s=0;for(let k=0;k<q;k++)for(let l=0;l<q;l++)s+=Ci[a*q+k]*Kr[k*q+l]*Ci[b*q+l];T[a*q+b]=s;}
    for(let a=0;a<q;a++)for(let b=a+1;b<q;b++){const v=.5*(T[a*q+b]+T[b*q+a]);T[a*q+b]=T[b*q+a]=v;}
    const {ev,V}=mcJacobi(T,q),ord=ev.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]);
    X=ord.map(([_,c])=>{const z=new Float64Array(q);for(let k=0;k<q;k++){let s=0;for(let l=0;l<q;l++)s+=Ci[l*q+k]*V[l*q+c];z[k]=s;}
      const v=new Float64Array(nf);for(let k=0;k<q;k++)if(z[k])for(let i=0;i<nf;i++)v[i]+=z[k]*Y[k][i];return v;});
    lam=ord.map(o=>o[0]);
    if(prev){let ok=true;for(let j=0;j<nmodes;j++)if(Math.abs(lam[j]-prev[j])>1e-12*lam[j])ok=false;if(ok)break;}prev=lam.slice();}
  const f=lam.slice(0,nmodes).map(l=>Math.sqrt(Math.max(l,0))/(2*Math.PI));
  const phi=X.slice(0,nmodes).map(v=>{const u=new Float64Array(nd);free.forEach((g,a)=>u[g]=v[a]);return u;});
  let mt=0;for(let i=0;i<N;i++)mt+=Md[3*i];
  const part=phi.map(u=>{let mm=0;for(let i=0;i<nd;i++)mm+=u[i]*u[i]*Md[i];const g=[0,1].map(dd=>{let s=0;for(let i=0;i<N;i++)s+=u[3*i+dd]*Md[3*i+dd];return s/mm;});return {Y:g[0]**2*mm/mt,Z:g[1]**2*mm/mt};});
  return {f,phi,part};
}
/* ---- Bloque B: zonas de daño, sensores y rasgos (réplica de blockB_data.py) ---- */
function mcZones(fr){const z=new Int16Array(fr.el.length).fill(-1);
  fr.el.forEach(([i,j],t)=>{const mid=(fr.nodes[i][0]+fr.nodes[j][0])/2;
    fr.arches.forEach((A,ai)=>{const a=A.ys[0],b=A.ys[A.ys.length-1];
      if(fr.grp[t]==='arco_'+A.k){const r=(mid-a)/(b-a);z[t]=ai*5+Math.min(Math.floor(r*5),4);}
      if(fr.grp[t]==='tablero'&&a<=mid&&mid<=b)z[t]=15+ai;});});return z;}
function mcSensors(fr){const ys=[];fr.arches.forEach(A=>{const a=A.ys[0],b=A.ys[A.ys.length-1];[.25,.5,.75].forEach(r=>ys.push(a+r*(b-a)));});
  return ys.map(y=>{const yd=fr.ydeck.reduce((best,v)=>Math.abs(v-y)<Math.abs(best-y)?v:best,fr.ydeck[0]);return {y,node:fr.deckN[yd],dof:3*fr.deckN[yd]+1};});}
function mcFeatures(f,phi,f0,phi0,sdof,NM=8){const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};const df=[],sh=[];
  for(let i=0;i<NM;i++){let best=-1,j=0;for(let k=0;k<NM;k++){const m=dot(phi0[i],phi[k])**2/(dot(phi0[i],phi0[i])*dot(phi[k],phi[k]));if(m>best){best=m;j=k;}}
    df.push((f[j]-f0[i])/f0[i]);
    if(i<4){const v=sdof.map(d=>phi[j][d]),v0=sdof.map(d=>phi0[i][d]);const sg=Math.sign(dot(v,v0))||1,mx=Math.max(...v.map(Math.abs));v.forEach(x=>sh.push(x*sg/mx));}}
  return df.concat(sh);}
if(typeof module!=='undefined')module.exports={mcBuild,mcModal,mcZones,mcSensors,mcFeatures};
