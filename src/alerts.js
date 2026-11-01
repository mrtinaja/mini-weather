import {icon} from './icons.js';

// Alerts: forecast warnings for the chosen city (derived from Open-Meteo, not official),
// plus world events from NASA EONET, GDACS (cyclones, floods, big fires) and USGS (earthquakes).
// level: 0 info · 1 amarillo · 2 naranja · 3 rojo.
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const number=(value,digits=0)=>finite(value)?value.toLocaleString('es-AR',{maximumFractionDigits:digits}):'—';
const TTL=15*60*1000,NEAR_KM=1500;
const LEVELS=['Info','Amarillo','Naranja','Rojo'];
const GROUPS={all:'Todo',storm:'Tormentas y ciclones',fire:'Incendios',quake:'Sismos',flood:'Inundaciones',volcano:'Volcanes',other:'Otros'};
const EONET_KINDS={
 wildfires:['Incendio','fire',1],severeStorms:['Tormenta severa','storm',2],volcanoes:['Volcán','volcano',2],floods:['Inundación','flood',2],
 earthquakes:['Sismo','quake',1],landslides:['Deslizamiento','other',1],drought:['Sequía','other',1],dustHaze:['Polvo y bruma','other',1],
 tempExtremes:['Temperatura extrema','other',2],snow:['Nevada','other',1],seaLakeIce:['Hielo marino','other',0],waterColor:['Color del agua','other',0],manmade:['Origen humano','other',1]
};
const GDACS_KINDS={TC:['Ciclón tropical','storm'],FL:['Inundación','flood'],WF:['Incendio forestal','fire']};
const GDACS_LEVELS={Green:1,Orange:2,Red:3};
let events=[],eventsAt=0,pending=null,group='all',context=null,handlers={};

const when=time=>{
 const date=new Date(time);
 if(Number.isNaN(date.getTime()))return '';
 const hours=(Date.now()-date.getTime())/3600000;
 if(hours<1)return 'hace minutos';
 if(hours<24)return `hace ${Math.round(hours)} h`;
 return date.toLocaleDateString('es-AR',{day:'numeric',month:'short'});
};
function centroid(geometry){
 if(geometry.type==='Point')return geometry.coordinates;
 const ring=geometry.type==='Polygon'?geometry.coordinates[0]:geometry.coordinates?.[0]?.[0];
 if(!Array.isArray(ring)||!ring.length)return null;
 return [ring.reduce((sum,point)=>sum+point[0],0)/ring.length,ring.reduce((sum,point)=>sum+point[1],0)/ring.length];
}
async function json(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(String(response.status));return await response.json();}
 finally{clearTimeout(timer);}
}
async function fromEONET(){
 const data=await json('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30');
 return (data.events||[]).map(item=>{
  const geometry=item.geometry?.at(-1),point=geometry&&centroid(geometry),category=item.categories?.[0]?.id;
  if(!point)return null;
  const [kind,type,level]=EONET_KINDS[category]||['Evento natural','other',1];
  let detail='';
  if(finite(geometry.magnitudeValue)){
   detail=geometry.magnitudeUnit==='acres'?`${number(geometry.magnitudeValue*.4047)} ha`:geometry.magnitudeUnit==='kts'?`Vientos de ${number(geometry.magnitudeValue*1.852)} km/h`:`${number(geometry.magnitudeValue,1)} ${geometry.magnitudeUnit||''}`.trim();
  }
  const stormLevel=type==='storm'&&finite(geometry.magnitudeValue)?(geometry.magnitudeValue>=96?3:geometry.magnitudeValue>=64?2:1):level;
  return {id:item.id,source:'NASA EONET',kind,group:type,level:stormLevel,title:item.title,detail,time:geometry.date,lon:point[0],lat:point[1],url:item.sources?.[0]?.url||item.link};
 }).filter(Boolean);
}
async function fromUSGS(){
 const data=await json('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
 return (data.features||[]).map(item=>{
  const p=item.properties,[lon,lat,depth]=item.geometry?.coordinates||[];
  const level=p.mag>=7?3:p.mag>=6?2:p.mag>=5?1:0;
  return {id:item.id,source:'USGS',kind:'Sismo',group:'quake',level:p.tsunami?Math.max(level,2):level,title:p.place||'Sismo',detail:`Magnitud ${number(p.mag,1)} · ${number(depth)} km de profundidad${p.tsunami?' · aviso de tsunami':''}`,time:p.time,lon,lat,url:p.url};
 });
}
async function fromGDACS(type){
 const data=await json(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=${type}`);
 const seen=new Set();
 return (data.features||[]).filter(item=>item.geometry?.type==='Point'&&String(item.properties?.iscurrent)==='true').map(item=>{
  const p=item.properties,id=`${type}-${p.eventid}`;
  if(seen.has(id))return null;seen.add(id);
  const [kind,typeGroup]=GDACS_KINDS[type];
  return {id,source:'GDACS',kind,group:typeGroup,level:GDACS_LEVELS[p.alertlevel]??1,title:[p.name,p.country].filter(Boolean).filter((v,i,a)=>!(i===1&&a[0].includes(v))).join(' · '),detail:p.severitydata?.severitytext?.trim()||'',time:p.todate||p.fromdate,lon:item.geometry.coordinates[0],lat:item.geometry.coordinates[1],url:p.url?.report};
 }).filter(Boolean);
}
export async function loadEvents(){
 if(events.length&&Date.now()-eventsAt<TTL)return events;
 pending??=Promise.allSettled([fromEONET(),fromUSGS(),...Object.keys(GDACS_KINDS).map(fromGDACS)]).then(results=>{
  const ok=results.filter(result=>result.status==='fulfilled');
  if(!ok.length)throw new Error('No respondieron los servicios de alertas.');
  events=ok.flatMap(result=>result.value).filter(item=>finite(item.lat)&&finite(item.lon));
  eventsAt=Date.now();
  return events;
 }).finally(()=>{pending=null;});
 return pending;
}

function distanceKm(a,b){
 const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
 const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
 return 12742*Math.asin(Math.sqrt(h));
}
// Thresholds roughly follow SMN's yellow/orange/red criteria; they are forecast-based, not official warnings.
function forecastAlerts(data,timezone){
 const d=data.daily,list=[];
 const dayName=index=>index===0?'Hoy':index===1?'Mañana':new Intl.DateTimeFormat('es-AR',{weekday:'long',timeZone:timezone||'UTC'}).format(new Date(d.time[index]*1000));
 for(let index=0;index<Math.min(3,d.time.length);index++){
  const day=dayName(index),code=d.weather_code?.[index],rain=d.precipitation_sum?.[index],gust=d.wind_gusts_10m_max?.[index],max=d.temperature_2m_max?.[index],min=d.temperature_2m_min?.[index],uv=d.uv_index_max?.[index];
  if([95,96,99].includes(code))list.push({level:[96,99].includes(code)?3:2,glyph:'storm',title:[96,99].includes(code)?'Tormentas con granizo':'Tormentas',day});
  if(finite(rain)&&rain>=20)list.push({level:rain>=60?3:rain>=40?2:1,glyph:'rain',title:`Lluvia intensa · ${number(rain)} mm`,day});
  if(finite(gust)&&gust>=55)list.push({level:gust>=100?3:gust>=75?2:1,glyph:'wind',title:`Ráfagas de ${number(gust)} km/h`,day});
  if(finite(max)&&max>=33)list.push({level:max>=39?3:max>=36?2:1,glyph:'thermometer',temp:max,title:'Calor extremo',day});
  if(finite(min)&&min<=0)list.push({level:min<=-6?3:min<=-3?2:1,glyph:'snow',temp:min,title:'Heladas',day});
  if([71,73,75,77,85,86].includes(code))list.push({level:[75,86].includes(code)?2:1,glyph:'snow',title:'Nevadas',day});
  if(finite(uv)&&uv>=8)list.push({level:uv>=11?2:1,glyph:'sun',title:`Radiación UV ${uv>=11?'extrema':'muy alta'} · índice ${number(uv)}`,day});
 }
 const h=data.hourly,now=data.current.time;
 const foggy=h.time.some((time,index)=>time>=now&&time<now+86400&&finite(h.visibility?.[index])&&h.visibility[index]<1000);
 if(foggy)list.push({level:1,glyph:'fog',title:'Niebla · visibilidad menor a 1 km',day:'Próximas 24 h'});
 return list.sort((a,b)=>b.level-a.level);
}

function eventButton(item,city){
 const distance=city?distanceKm(city,item):null;
 return `<li><button type="button" class="alert-item level-${item.level}" data-alert="${escape(item.id)}"><span class="alert-dot"></span><span class="alert-body"><span class="alert-title">${escape(item.title)}</span><span class="alert-meta">${escape([item.kind,item.detail,distance!==null&&distance<NEAR_KM?`a ${number(distance)} km`:'',when(item.time),item.source].filter(Boolean).join(' · '))}</span></span></button></li>`;
}
function draw(){
 if(!context)return;
 const {city,data,temperature}=context;
 const local=data?forecastAlerts(data,data.timezone):[];
 const official=city&&city.lat<-21&&city.lat>-56&&city.lon>-74&&city.lon<-53?'<button type="button" class="text-button" data-official="smn">Alertas oficiales del SMN '+icon('external')+'</button>':'';
 $('alerts-local').innerHTML=`<h3>En ${escape(city?.nombre||'tu ciudad')} <span class="muted">· próximos 3 días</span></h3>${local.length?`<ul class="alert-list">${local.map(item=>`<li class="alert-item level-${item.level}">${icon(item.glyph)}<span class="alert-body"><span class="alert-title">${escape(item.title)}${item.temp!==undefined?` · ${escape(temperature(item.temp))}`:''}</span><span class="alert-meta">${escape(item.day)} · ${LEVELS[item.level]}</span></span></li>`).join('')}</ul>`:`<p class="alert-ok">${icon('check')}Sin fenómenos fuertes en el pronóstico.</p>`}<p class="source-note">Avisos calculados con el pronóstico de Open-Meteo; no reemplazan las alertas oficiales. ${official}</p>`;
 const near=city?events.map(item=>({item,distance:distanceKm(city,item)})).filter(({distance})=>distance<NEAR_KM).sort((a,b)=>b.item.level-a.item.level||a.distance-b.distance).slice(0,6).map(({item})=>item):[];
 $('alerts-near').innerHTML=events.length?`<h3>Cerca <span class="muted">· menos de ${number(NEAR_KM)} km</span></h3>${near.length?`<ul class="alert-list">${near.map(item=>eventButton(item,city)).join('')}</ul>`:`<p class="alert-ok">${icon('check')}Sin eventos activos en la zona.</p>`}`:'';
 const world=events.filter(item=>group==='all'||item.group===group).sort((a,b)=>b.level-a.level||new Date(b.time)-new Date(a.time)).slice(0,14);
 const counts=Object.fromEntries(Object.keys(GROUPS).map(key=>[key,key==='all'?events.length:events.filter(item=>item.group===key).length]));
 $('alerts-world').innerHTML=events.length?`<h3>En el mundo <span class="muted">· ${events.length} eventos activos</span></h3><div class="alert-filters" role="group" aria-label="Filtrar por tipo">${Object.entries(GROUPS).filter(([key])=>counts[key]).map(([key,label])=>`<button type="button" data-group="${key}" class="${key===group?'selected':''}" aria-pressed="${key===group}">${label} <small>${counts[key]}</small></button>`).join('')}</div><ul class="alert-list">${world.map(item=>eventButton(item,city)).join('')}</ul>`:'';
}
export function initAlerts({onShowEvent,onOpenLink}){
 handlers={onShowEvent,onOpenLink};
 $('alerts-panel').addEventListener('click',event=>{
  const filter=event.target.closest('[data-group]');
  if(filter){group=filter.dataset.group;draw();return;}
  const item=event.target.closest('[data-alert]');
  if(item){const found=events.find(entry=>entry.id===item.dataset.alert);if(found)handlers.onShowEvent?.(found);return;}
  if(event.target.closest('[data-official]'))handlers.onOpenLink?.('https://www.smn.gob.ar/alertas');
 });
}
export function updateAlerts(next){context={...context,...next};draw();}
export async function refreshEvents(){
 $('alerts-state').hidden=false;$('alerts-state').textContent='Buscando eventos activos en NASA, GDACS y USGS…';
 try{
  const list=await loadEvents();
  $('alerts-state').hidden=true;draw();
  return list;
 }catch(error){
  $('alerts-state').textContent=error.message;
  return [];
 }
}
