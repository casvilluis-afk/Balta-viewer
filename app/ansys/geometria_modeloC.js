/* Exporta la geometría del modelo C de la plataforma (la misma función mcBuild de la app) a JSON, para el generador 3D */
const fs=require('fs');const [, , htmlF, jsonF, outF]=process.argv;const H=fs.readFileSync(htmlF,'utf8');
const grab=name=>{const i=H.indexOf(name);let d=0,j=H.indexOf('{',i);for(let k=j;k<H.length;k++){if(H[k]==='{')d++;else if(H[k]==='}'){d--;if(!d)return H.slice(i,k+1);}}};
const M=new Function(['const MC_NSEG=24;',grab('function mcRibSection('),grab('function mcPolyval('),grab('function mcBuild(')].join('\n')+'\nreturn {mcBuild};')();
const D=JSON.parse(fs.readFileSync(jsonF,'utf8'));const fr=M.mcBuild(D,{});
fs.writeFileSync(outF,JSON.stringify({p:fr.p,arches:fr.arches.map(a=>({k:a.k,ys:a.ys,zs:a.zs})),ydeck:fr.ydeck,zdeck:D.z_deck_axis,zbase:D.z_base,faces:D.faces,
 pier_top:fr.nodes.slice(-4).filter((_,i)=>i%2===0),nodes2d:fr.nodes.length}));
console.log('ok',fr.nodes.slice(-4));
