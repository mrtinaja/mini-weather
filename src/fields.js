// Current wind and sea-level pressure on a 15° world grid (Open-Meteo model), drawn as images for the globe.
// Open-Meteo counts one call per point (free limit: 600 per minute), so the grid stays at 264 points
// and the result is kept in localStorage for 30 minutes.
const API='https://api.open-meteo.com/v1/forecast';
const STEP=15,LATS=[],LONS=[];
for(let lat=-75;lat<=75;lat+=STEP)LATS.push(lat);
for(let lon=-180;lon<180;lon+=STEP)LONS.push(lon);
const TTL=30*60*1000,STORE='mini-weather:campos-v1';
let cache=null,pending=null;
try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved?.grid?.length===LATS.length&&Date.now()-saved.at<TTL)cache=saved;}catch{/* Works without storage. */}

async function fetchGrid(){
 const points=LATS.flatMap(lat=>LONS.map(lon=>({lat,lon})));
 const chunks=[];
 for(let index=0;index<points.length;index+=310)chunks.push(points.slice(index,index+310));
 const results=await Promise.all(chunks.map(async chunk=>{
  const url=`${API}?latitude=${chunk.map(p=>p.lat).join(',')}&longitude=${chunk.map(p=>p.lon).join(',')}&current=wind_speed_10m,wind_direction_10m,pressure_msl&wind_speed_unit=kmh`;
  const response=await fetch(url);
  if(!response.ok)throw new Error(response.status===429?'Open-Meteo está ocupado; probá en unos minutos.':'Open-Meteo no respondió.');
  const data=await response.json();
  return Array.isArray(data)?data:[data];
 }));
 const rows=results.flat();
 const grid=LATS.map(()=>LONS.map(()=>null));
 rows.forEach((row,index)=>{
  const c=row?.current;if(!c)return;
  // u/v components (towards east/north) so directions can be interpolated between grid points.
  const radians=c.wind_direction_10m*Math.PI/180;
  grid[Math.floor(index/LONS.length)][index%LONS.length]={speed:c.wind_speed_10m,direction:c.wind_direction_10m,pressure:c.pressure_msl,u:-c.wind_speed_10m*Math.sin(radians),v:-c.wind_speed_10m*Math.cos(radians)};
 });
 return {grid,time:rows.find(row=>row?.current)?.current.time};
}
export async function loadFields(){
 if(cache&&Date.now()-cache.at<TTL)return cache;
 pending??=fetchGrid().then(result=>{
  cache={...result,at:Date.now()};
  try{localStorage.setItem(STORE,JSON.stringify(cache));}catch{/* Works without storage. */}
  return cache;
 }).finally(()=>{pending=null;});
 return pending;
}

function sample(grid,key,lat,lon){
 const y=Math.max(0,Math.min(LATS.length-1.001,(lat-LATS[0])/STEP));
 const x=((lon-LONS[0])/STEP+LONS.length)%LONS.length;
 const y0=Math.floor(y),x0=Math.floor(x),x1=(x0+1)%LONS.length,fy=y-y0,fx=x-x0;
 const v=(r,c)=>grid[r]?.[c]?.[key];
 const corners=[[v(y0,x0),(1-fx)*(1-fy)],[v(y0,x1),fx*(1-fy)],[v(y0+1,x0),(1-fx)*fy],[v(y0+1,x1),fx*fy]].filter(([value])=>Number.isFinite(value));
 const weight=corners.reduce((sum,[,w])=>sum+w,0);
 return weight?corners.reduce((sum,[value,w])=>sum+value*w,0)/weight:NaN;
}
function ramp(stops,value){
 if(!Number.isFinite(value))return [0,0,0,0];
 if(value<=stops[0][0])return stops[0][1];
 for(let index=1;index<stops.length;index++){
  const [v1,c1]=stops[index];
  if(value<=v1){const [v0,c0]=stops[index-1],t=(value-v0)/(v1-v0);return c0.map((c,i)=>c+(c1[i]-c)*t);}
 }
 return stops.at(-1)[1];
}
export const SCALES={
 wind:{min:0,max:100,unit:'km/h',stops:[[0,[40,70,140,120]],[15,[50,150,170,150]],[30,[90,190,100,165]],[50,[230,200,70,180]],[70,[235,120,50,190]],[100,[200,40,90,200]]]},
 pressure:{min:970,max:1040,unit:'hPa',stops:[[970,[110,40,150,150]],[990,[50,90,190,140]],[1005,[70,170,170,120]],[1013,[120,190,120,110]],[1022,[230,190,90,130]],[1040,[210,70,60,160]]]}
};
// One map tile of the field for the rectangle [west, south, east, north] in degrees, so the globe
// draws it at the resolution of the current zoom. Pressure adds isobars every 4 hPa where a pixel
// and a neighbour fall in different bands; one extra row and column keep lines continuous across tiles.
export function fieldTile(fields,kind,[west,south,east,north],size=256){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const context=canvas.getContext('2d'),image=context.createImageData(size,size),scale=SCALES[kind];
 const key=kind==='wind'?'speed':'pressure',span=size+1,values=new Float32Array(span*span);
 for(let py=0;py<span;py++){
  const lat=north-(py+.5)/size*(north-south);
  for(let px=0;px<span;px++)values[py*span+px]=sample(fields.grid,key,lat,west+(px+.5)/size*(east-west));
 }
 const band=value=>Math.floor(value/4);
 for(let py=0;py<size;py++)for(let px=0;px<size;px++){
  const value=values[py*span+px];
  let color=ramp(scale.stops,value);
  if(kind==='pressure'&&Number.isFinite(value)){
   const crossing=[values[py*span+px+1],values[(py+1)*span+px]].find(next=>Number.isFinite(next)&&band(next)!==band(value));
   if(crossing!==undefined)color=[255,255,255,Math.max(band(value),band(crossing))*4===1012?235:185];
  }
  image.data.set(color.map(Math.round),(py*size+px)*4);
 }
 context.putImageData(image,0,0);
 return canvas;
}

// Arrows every `step` degrees, interpolated from the grid. Polar rows are skipped: they pile up around the pole.
export function windArrows(fields,step=STEP){
 const arrows=[];
 for(let lat=-70;lat<=70;lat+=step)for(let lon=-180;lon<180;lon+=step){
  const u=sample(fields.grid,'u',lat,lon),v=sample(fields.grid,'v',lat,lon);
  if(Number.isFinite(u)&&Number.isFinite(v))arrows.push({lat,lon,speed:Math.hypot(u,v),direction:(Math.atan2(-u,-v)*180/Math.PI+360)%360});
 }
 return arrows;
}
export function legendGradient(kind){
 const scale=SCALES[kind];
 return `linear-gradient(90deg,${scale.stops.map(([value,color])=>`rgba(${color[0]},${color[1]},${color[2]},1) ${((value-scale.min)/(scale.max-scale.min)*100).toFixed(0)}%`).join(',')})`;
}
