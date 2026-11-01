import {forecastPoints,forecastURL,parseForecast,GRID,SPACING} from './forecast-data.js';

// 5-day simulation on the globe, frame by frame: the chosen variable is drawn over a 13 × 13
// regional grid and interpolated between forecast hours, so clouds and rain move instead of
// jumping; wind particles show how the air flows. Talks to the dashboard (sim.js) through two
// window events: 'mw:forecast-time' (this map reached an hour) and 'mw:forecast-goto' (the
// dashboard asks for an hour).
const $=id=>document.getElementById(id);
const METRICS={
 weather:{label:'Nubes y lluvia',unit:'mm',digits:1,key:'precipitation'},
 temperature_2m:{label:'Temperatura',unit:'°C',digits:0,stops:[[-20,'#5269c4'],[0,'#66c9e9'],[15,'#60b583'],[25,'#ead263'],[40,'#db644e']]},
 precipitation:{label:'Precipitación por hora',unit:'mm',digits:1,stops:[[0,'#466a79'],[.5,'#64b5dc'],[2,'#54bd95'],[8,'#e4c454'],[20,'#cb548d']]},
 wind_speed_10m:{label:'Viento a 10 m',unit:'km/h',digits:0,stops:[[0,'#567b94'],[15,'#5cbeb1'],[30,'#adca6d'],[60,'#e8a45e'],[100,'#c35a70']]},
 cloud_cover:{label:'Nubosidad',unit:'%',digits:0,stops:[[0,'#285d7b'],[25,'#5b8194'],[60,'#a3b2bc'],[100,'#e4ebee']]}
};
// Rain over clouds, radar style: light blue drizzle to magenta downpour (mm per hour).
const RAIN=[[.1,'#7fd3f0'],[1,'#3fa9e0'],[3,'#2fbf71'],[8,'#f2d14b'],[15,'#f08a3c'],[30,'#d6407a']];
export const SECTIONS=[{key:'madrugada',label:'Madrugada',from:0,hour:3},{key:'manana',label:'Mañana',from:6,hour:9},{key:'tarde',label:'Tarde',from:12,hour:15},{key:'noche',label:'Noche',from:18,hour:21}];
export const sectionOf=hour=>SECTIONS[Math.min(3,Math.floor(hour/6))];
const rgb=hex=>[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16));
function colorAt(stops,value){
 if(value<=stops[0][0])return rgb(stops[0][1]);
 for(let i=1;i<stops.length;i++)if(value<=stops[i][0]){
  const [low,a]=stops[i-1],[high,b]=stops[i],ratio=(value-low)/(high-low),ca=rgb(a),cb=rgb(b);
  return ca.map((c,k)=>Math.round(c*(1-ratio)+cb[k]*ratio));
 }
 return rgb(stops.at(-1)[1]);
}

// Value of a variable at grid position (x across, y down) and fractional time t, interpolated in space and time.
function sampler(cells,t){
 const i0=Math.floor(t),i1=Math.min(i0+1,cells[0].values.temperature_2m.length-1),ft=t-i0;
 return (key,x,y)=>{
  const c0=Math.max(0,Math.min(GRID-2,Math.floor(x))),r0=Math.max(0,Math.min(GRID-2,Math.floor(y))),fx=x-c0,fy=y-r0;
  let sum=0,weight=0;
  for(const [r,c,w] of [[r0,c0,(1-fx)*(1-fy)],[r0,c0+1,fx*(1-fy)],[r0+1,c0,(1-fx)*fy],[r0+1,c0+1,fx*fy]]){
   const list=cells[r*GRID+c].values[key],a=list[i0],b=list[i1];
   if(a===null||a===undefined)continue;
   sum+=(b===null||b===undefined?a:a+(b-a)*ft)*w;weight+=w;
  }
  return weight?sum/weight:NaN;
 };
}
const SIZE=200,fade=(px,py)=>Math.min(1,Math.min(px,py,SIZE-1-px,SIZE-1-py)/(SIZE*.08));
// Edges fade out so the region blends into the globe.
function fieldCanvas(sample,key,scale){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;
 const context=canvas.getContext('2d'),image=context.createImageData(SIZE,SIZE);
 for(let py=0;py<SIZE;py++)for(let px=0;px<SIZE;px++){
  const x=px/(SIZE-1)*(GRID-1),y=py/(SIZE-1)*(GRID-1);
  if(key==='weather'){
   const cloud=sample('cloud_cover',x,y),rain=sample('precipitation',x,y);
   // Clouds: white, more opaque the more covered the sky. Rain on top: drizzle stays see-through,
   // heavy rain is solid.
   let color=[238,243,246],alpha=Number.isFinite(cloud)?Math.max(0,cloud-10)/90*205:0;
   if(Number.isFinite(rain)&&rain>=.1){color=colorAt(RAIN,rain);alpha=Math.max(alpha*.6,Math.min(235,95+Math.sqrt(rain)*55));}
   if(alpha>0)image.data.set([...color,Math.round(alpha*fade(px,py))],(py*SIZE+px)*4);
   continue;
  }
  const value=sample(key,x,y);
  if(Number.isFinite(value))image.data.set([...colorAt(scale.stops,value),Math.round(170*fade(px,py))],(py*SIZE+px)*4);
 }
 context.putImageData(image,0,0);
 return canvas;
}

// Wind particles in grid coordinates. Each frame they move with the interpolated wind and leave a
// fading trail. The trail lives on `trail`; a copy goes to one of two output canvases so the globe
// sees a new image every frame.
function createFlow(){
 const size=420,trail=document.createElement('canvas'),outputs=[0,1].map(()=>{const c=document.createElement('canvas');c.width=c.height=size;return c;});
 trail.width=trail.height=size;
 const context=trail.getContext('2d');
 const spawn=()=>({x:Math.random()*(GRID-1),y:Math.random()*(GRID-1),age:Math.floor(Math.random()*90)});
 let particles=Array.from({length:650},spawn),flip=0;
 return {
  reset(){context.clearRect(0,0,size,size);particles=Array.from({length:650},spawn);},
  step(sample,speedFactor){
   context.globalCompositeOperation='destination-in';context.fillStyle='rgba(0,0,0,.9)';context.fillRect(0,0,size,size);
   context.globalCompositeOperation='source-over';context.lineWidth=1.3;context.lineCap='round';
   const scale=size/(GRID-1);
   for(const p of particles){
    const u=sample('u',p.x,p.y),v=sample('v',p.x,p.y),speed=Math.hypot(u,v);
    if(!Number.isFinite(speed)||++p.age>100){Object.assign(p,spawn(),{age:0});continue;}
    // Rows run north to south, so a northward wind moves the particle up the canvas.
    const move=.0009*speedFactor,nx=p.x+u*move,ny=p.y-v*move;
    if(nx<0||ny<0||nx>GRID-1||ny>GRID-1){Object.assign(p,spawn(),{age:0});continue;}
    context.strokeStyle=`rgba(255,255,255,${Math.min(.85,.35+speed/60)})`;
    context.beginPath();context.moveTo(p.x*scale,p.y*scale);context.lineTo(nx*scale,ny*scale);context.stroke();
    p.x=nx;p.y=ny;
   }
   const out=outputs[flip^=1],g=out.getContext('2d');
   g.clearRect(0,0,size,size);g.drawImage(trail,0,0);
   return out;
  }
 };
}

// The regional download (169 points, about 800 KB) is kept for 20 minutes per city, for the
// last two cities, so coming back to a city does not spend Open-Meteo calls again.
const STORE='mini-weather:simulacion-v2',TTL=20*60*1000;
const cityKey=city=>`${city.lat.toFixed(2)},${city.lon.toFixed(2)}`;
function readStored(city){
 try{
  const entry=(JSON.parse(localStorage.getItem(STORE))||[]).find(item=>item.key===cityKey(city)&&Date.now()-item.at<TTL);
  if(!entry)return null;
  // Drop the hours that already went by.
  const start=Math.floor(Date.now()/3600000)*3600,keep=entry.data.times.map((time,i)=>time>=start?i:-1).filter(i=>i>=0);
  if(keep.length<24)return null;
  return {at:entry.at,data:{times:keep.map(i=>entry.data.times[i]),cells:entry.data.cells.map(cell=>({...cell,values:Object.fromEntries(Object.entries(cell.values).map(([key,list])=>[key,keep.map(i=>list[i])]))}))}};
 }catch{return null;}
}
function store(city,data){
 try{
  const others=(JSON.parse(localStorage.getItem(STORE))||[]).filter(item=>item.key!==cityKey(city)&&Date.now()-item.at<TTL);
  localStorage.setItem(STORE,JSON.stringify([{key:cityKey(city),at:Date.now(),data},...others].slice(0,2)));
 }catch{/* Works without storage (or when it is full). */}
}

export function initForecastMap(globe){
 let city=null,active=false,controller=null,sequence=0,data=null,cachedAt=0,previousLayer='',slots=[],pendingTime=null;
 let t=0,shownHour=-1,playing=false,frame=null,lastTick=0,lastImage=0;
 const flow=createFlow();
 const slider=$('forecast-hour'),metric=$('forecast-metric'),status=$('forecast-status'),play=$('forecast-play'),speed=$('forecast-speed'),flowToggle=$('forecast-flow');
 const controls=[$('forecast-prev'),$('forecast-next'),slider,play,speed];
 const historyNodes=Array.from(document.querySelectorAll('.world-layers,.world-layer-info,#world-panel > .source-note'));
 const last=()=>data.times.length-1;
 function setPlaying(next){
  playing=next;
  play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?'Pausar simulación':'Reproducir simulación');play.setAttribute('aria-pressed',String(playing));
  loop();
 }
 const stop=()=>setPlaying(false);
 function available(value){controls.forEach(control=>control.disabled=!value);document.querySelectorAll('#forecast-days button,#forecast-sections button').forEach(button=>button.disabled=!value);}
 // Day and hour of every forecast step in the city's own time zone.
 function buildSlots(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:city.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  slots=data.times.map(time=>{const p=Object.fromEntries(parts.formatToParts(new Date(time*1000)).map(part=>[part.type,part.value]));return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour)};});
  const days=[...new Set(slots.map(slot=>slot.day))].slice(0,5);
  const label=new Intl.DateTimeFormat('es-AR',{timeZone:'UTC',weekday:'short',day:'numeric'});
  $('forecast-days').innerHTML=days.map((day,i)=>`<button type="button" data-day="${day}">${i===0?'Hoy':label.format(new Date(`${day}T12:00:00Z`))}</button>`).join('');
  $('forecast-sections').innerHTML=SECTIONS.map(section=>`<button type="button" data-section="${section.key}">${section.label}</button>`).join('');
 }
 function goTo(day,section){
  let best=-1,score=Infinity;
  slots.forEach((slot,i)=>{if(slot.day!==day)return;const d=Math.abs(slot.hour-section.hour);if(d<score){score=d;best=i;}});
  if(best>=0){stop();seek(best);}
 }
 function seek(value){t=Math.max(0,Math.min(last(),value));shownHour=-1;render(true);}
 const format=(scale,value)=>value===null||value===undefined||!Number.isFinite(value)?'':`${value.toLocaleString('es-AR',{maximumFractionDigits:scale.digits})} ${scale.unit}`;
 // Everything that only changes once per forecast hour: labels, chips, texts, legend, dashboard.
 function hourChanged(index){
  const key=metric.value,scale=METRICS[key],valueKey=scale.key||key;
  const time=data.times[index],slot=slots[index];
  const stamp=new Intl.DateTimeFormat('es-AR',{timeZone:city.timezone||'UTC',weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time*1000));
  $('forecast-date').textContent=`${stamp} · ${sectionOf(slot.hour).label.toLowerCase()} · hora ${index+1} de ${data.times.length}`;
  slider.value=String(index);slider.setAttribute('aria-valuetext',stamp);
  $('forecast-prev').disabled=index===0;$('forecast-next').disabled=index===last();
  for(const button of document.querySelectorAll('#forecast-days button'))button.classList.toggle('selected',button.dataset.day===slot.day);
  for(const button of document.querySelectorAll('#forecast-sections button'))button.classList.toggle('selected',button.dataset.section===sectionOf(slot.hour).key);
  const first=data.cells[0],lastCell=data.cells.at(-1),centerIndex=(GRID*GRID-1)/2,central=data.cells[centerIndex];
  // Labels every third point, so the numbers stay readable on the finer grid.
  const labels=key==='weather'?[]:data.cells.filter((cell,i)=>Math.floor(i/GRID)%3===0&&i%GRID%3===0&&i!==centerIndex).map(cell=>({lat:cell.lat,lon:cell.lon,text:format(scale,cell.values[valueKey][index])})).filter(label=>label.text);
  const centerText=key==='weather'?`${city.nombre} · ${Math.round(central.values.cloud_cover[index]??0)}% nubes${central.values.precipitation[index]>=.1?` · ${format(scale,central.values.precipitation[index])}`:''}`:`${city.nombre} · ${format(scale,central.values[valueKey][index])||'sin dato'}`;
  globe.showForecast({rectangle:[first.lon-SPACING/2,lastCell.lat-SPACING/2,lastCell.lon+SPACING/2,first.lat+SPACING/2],image:null,flow:null,labels,arrows:[],center:{lat:city.lat,lon:city.lon,text:centerText}});
  $('forecast-value').textContent=centerText;
  const legend=$('forecast-legend');legend.replaceChildren();
  const stops=key==='weather'?[[0,'#eceff1','nubes'],...RAIN.map(([v,c])=>[v,c,'mm/h'])]:scale.stops.map(([v,c])=>[v,c,scale.unit]);
  for(const [value,color,unit] of stops){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.backgroundColor=color;item.append(swatch,unit==='nubes'?'Nubes':`${value} ${unit}`);legend.append(item);}
  status.textContent=`Open-Meteo · ${scale.label} · región de ${Math.round(GRID*SPACING*111)} km alrededor de ${city.nombre}`;
  window.dispatchEvent(new CustomEvent('mw:forecast-time',{detail:{time}}));
 }
 // One animation frame: the field image (at most every 120 ms) and the wind particles.
 function render(force=false){
  if(!active||!data)return;
  const index=Math.round(t);
  if(index!==shownHour){shownHour=index;hourChanged(index);force=true;}
  const now=performance.now(),sample=sampler(data.cells,t);
  const image=force||playing&&now-lastImage>120?fieldCanvas(sample,metric.value,METRICS[metric.value]):undefined;
  if(image)lastImage=now;
  const flowImage=flowToggle.checked?flow.step(sample,playing?1+Number(speed.value)*.25:1):null;
  globe.forecastFrame({image,flow:flowImage});
 }
 // Runs while the simulation is on screen: advances time when playing, always moves particles.
 function loop(){
  cancelAnimationFrame(frame);frame=null;
  if(!active||!data||document.hidden||!(playing||flowToggle.checked))return;
  frame=requestAnimationFrame(now=>{
   const elapsed=lastTick?Math.min(.1,(now-lastTick)/1000):0;lastTick=now;
   if(playing){
    t+=elapsed*Number(speed.value);
    if(t>=last()){t=last();setPlaying(false);}
   }
   render();loop();
  });
 }
 function nearestIndex(time){
  let best=0;data.times.forEach((value,i)=>{if(Math.abs(value-time)<Math.abs(data.times[best]-time))best=i;});return best;
 }
 // Wind as u/v components (towards east/north): directions cannot be interpolated in degrees
 // (between 350° and 10° the average would point south).
 function addWindComponents(){
  for(const cell of data.cells){
   const {wind_speed_10m:speeds,wind_direction_10m:directions}=cell.values;
   cell.values.u=speeds.map((s,i)=>s===null||directions[i]===null?null:-s*Math.sin(directions[i]*Math.PI/180));
   cell.values.v=speeds.map((s,i)=>s===null||directions[i]===null?null:-s*Math.cos(directions[i]*Math.PI/180));
  }
 }
 function ready(){
  addWindComponents();buildSlots();slider.max=String(last());
  t=pendingTime===null?0:nearestIndex(pendingTime);pendingTime=null;shownHour=-1;flow.reset();
  available(true);render(true);lastTick=0;loop();
 }
 async function load(){
  if(!active||!city)return;
  if(data&&Date.now()-cachedAt<TTL){available(true);if(pendingTime!==null){t=nearestIndex(pendingTime);pendingTime=null;}shownHour=-1;render(true);loop();return;}
  const stored=readStored(city);
  if(stored){data=stored.data;cachedAt=stored.at;ready();return;}
  const run=++sequence;controller?.abort();controller=new AbortController();const request=controller;
  available(false);globe.showForecast(null);status.textContent=`Cargando la simulación de 5 días de ${city.nombre}…`;
  $('forecast-retry').hidden=true;
  const timer=setTimeout(()=>request.abort(),30000);
  try{
   const points=forecastPoints(city),response=await fetch(forecastURL(points),{signal:request.signal});
   if(!response.ok)throw new Error(response.status===429?'El proveedor está ocupado. Reintentá en unos minutos.':'No se pudo cargar el pronóstico regional.');
   const result=parseForecast(await response.json(),points);
   if(run!==sequence||!active)return;
   data=result;cachedAt=Date.now();store(city,data);ready();
  }catch(error){if(run===sequence&&active){status.textContent=error.name==='AbortError'?'La consulta tardó demasiado.':error.message;$('forecast-retry').hidden=false;}}
  finally{clearTimeout(timer);}
 }
 function mode(next){
  active=next;stop();sequence++;controller?.abort();
  $('forecast-panel').hidden=!active;historyNodes.forEach(node=>node.hidden=active);
  for(const button of document.querySelectorAll('[data-map-mode]')){const selected=(button.dataset.mapMode==='forecast')===active;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('green',selected);}
  $('globe-layer').disabled=active;
  if(active){previousLayer=$('globe-layer').value;$('globe-layer').value='';$('globe-layer').dispatchEvent(new Event('change'));if(city)globe.flyToCity(city);load();}
  else{globe.showForecast(null);$('globe-layer').value=previousLayer;$('globe-layer').dispatchEvent(new Event('change'));}
 }
 document.querySelectorAll('[data-map-mode]').forEach(button=>{button.disabled=false;button.addEventListener('click',()=>{const next=button.dataset.mapMode==='forecast';if(next!==active)mode(next);});});
 slider.addEventListener('input',()=>{stop();seek(Number(slider.value));});
 metric.addEventListener('change',()=>{if(data){shownHour=-1;render(true);}});
 flowToggle.addEventListener('change',()=>{flow.reset();if(data)render(true);loop();});
 $('forecast-prev').addEventListener('click',()=>{stop();seek(Math.round(t)-1);});
 $('forecast-next').addEventListener('click',()=>{stop();seek(Math.round(t)+1);});
 $('forecast-days').addEventListener('click',event=>{const button=event.target.closest('[data-day]');if(button)goTo(button.dataset.day,sectionOf(slots[Math.round(t)].hour));});
 $('forecast-sections').addEventListener('click',event=>{const button=event.target.closest('[data-section]');if(button)goTo(slots[Math.round(t)].day,SECTIONS.find(section=>section.key===button.dataset.section));});
 play.addEventListener('click',()=>{
  if(playing){stop();return;}
  if(t>=last())seek(0);
  lastTick=0;setPlaying(true);
 });
 $('forecast-retry').addEventListener('click',load);
 window.addEventListener('mw:forecast-goto',event=>{
  const time=event.detail?.time;if(!Number.isFinite(time))return;
  event.detail.handled=true;
  $('world-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  if(!active){pendingTime=time;mode(true);return;}
  if(!data){pendingTime=time;return;}
  stop();seek(nearestIndex(time));
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else{lastTick=0;loop();}});
 window.addEventListener('beforeunload',()=>{stop();cancelAnimationFrame(frame);sequence++;controller?.abort();},{once:true});
 available(false);
 return {setCity(next){
  const changed=!city||next.lat!==city.lat||next.lon!==city.lon;city=next;
  if(changed){stop();data=null;sequence++;controller?.abort();$('forecast-date').textContent='—';$('forecast-value').textContent=city.nombre;globe.showForecast(null);}
  if(active)load();
 }};
}
