// Rasgos por vóxel + clase mayoritaria cruda (0–8) de una nube TLS etiquetada
const fs=require('fs');global.self=undefined;const OPC=new Function(fs.readFileSync(require('path').join(__dirname,'..','..','..','plataforma','op_core.js'),'utf8')+'\nreturn OPC;')();
(async()=>{const [,,f,labf,out]=process.argv;const c=await OPC.parseCloud(new Blob([fs.readFileSync(f)]),f.split('/').pop(),()=>{});
 let O=OPC.orient(c,'z',1);const dk=OPC.deckLevel(O),gr=OPC.groundLevel(O),S=OPC.detectSupports(O,dk,gr);if(S.skew)O=OPC.applySkew(O,{phi:S.skew,tm:S.skewTm});
 const R=OPC.iaFeatures(O,dk,gr),lab=new Uint8Array(fs.readFileSync(labf)),h=new Uint32Array(R.nv*9);for(let i=0;i<O.n;i++)if(lab[i]<9)h[R.pv[i]*9+lab[i]]++;
 const y=new Uint8Array(R.nv);for(let j=0;j<R.nv;j++){let b=0;for(let k=1;k<9;k++)if(h[j*9+k]>h[j*9+b])b=k;y[j]=b;}
 fs.writeFileSync(out+'.f32',Buffer.from(R.F.buffer));fs.writeFileSync(out+'.y9',Buffer.from(y.buffer));fs.writeFileSync(out+'.xyz',Buffer.from(Float32Array.from([...R.X].flatMap((x,j)=>[x,R.Y[j],R.Z[j]])).buffer));
 fs.writeFileSync(out+'.meta.json',JSON.stringify({dk,gr,skew:S.skew||0,nv:R.nv}));console.log(f.split('/').pop(),R.nv);})();
