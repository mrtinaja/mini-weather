import {icon, weatherArt} from './icons.js';
import {initWorldGlobe} from './globe.js';
import {loadClimate, setClimateUnits} from './climate.js';
import {initAlerts, updateAlerts, refreshEvents} from './alerts.js';
import {initForecastMap} from './forecast-map.js';
import {initSimulation, updateSimulation, takePendingGoto} from './sim.js';

const API='https://api.open-meteo.com/v1/forecast';
const GEO='https://geocoding-api.open-meteo.com/v1/search';
const KEYS={city:'mini-weather:ultima-ciudad',favorites:'mini-weather:favoritas',cache:'mini-weather:pronosticos-v3',units:'mini-weather:unidades'};
const DEFAULT_CITY={nombre:'Buenos Aires',provincia:'Ciudad Autónoma de Buenos Aires',pais:'Argentina',lat:-34.6037,lon:-58.3816};
const PERIOD=10*60*1000;
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* The app also works without persistent storage. */}}
function validCity(city){return city&&typeof city.nombre==='string'&&finite(city.lat)&&finite(city.lon)&&Math.abs(city.lat)<=90&&Math.abs(city.lon)<=180;}
function cityKey(city){return `${city.lat.toFixed(3)},${city.lon.toFixed(3)}`;}
function validForecast(data){return data&&finite(data.current?.time)&&finite(data.current?.temperature_2m)&&Array.isArray(data.hourly?.time)&&data.hourly.time.length>0&&Array.isArray(data.daily?.time)&&data.daily.time.length>0;}
const storedFavorites=read(KEYS.favorites,[]);
let favorites=(Array.isArray(storedFavorites)?storedFavorites:[]).filter(validCity).slice(0,6);
let units=read(KEYS.units,'C')==='F'?'F':'C';
let current=null;
let requestedCity=read(KEYS.city,DEFAULT_CITY);
if(!validCity(requestedCity)) requestedCity=DEFAULT_CITY;
let forecastController=null,searchController=null;
let requestNumber=0,searchNumber=0;
let lastRequestAt=0;
let worldGlobe=null;
let forecastMap=null;
let searchTimer=null,searchActive=-1,searchOptions=[],searchComposing=false;

function closeSearch(){
 clearTimeout(searchTimer);searchController?.abort();searchNumber++;
 searchOptions=[];searchActive=-1;$('search-results').hidden=true;
 $('city-input').setAttribute('aria-expanded','false');$('city-input').removeAttribute('aria-activedescendant');
}
function activateSearch(index){
 searchActive=index;
 const buttons=$('search-results').querySelectorAll('.search-result');
 buttons.forEach((button,i)=>{button.classList.toggle('is-active',i===index);button.setAttribute('aria-selected',String(i===index));});
 if(buttons[index]){$('city-input').setAttribute('aria-activedescendant',buttons[index].id);buttons[index].scrollIntoView({block:'nearest'});}
}
function queueSearch(){
 closeSearch();
 const query=$('city-input').value.trim();
 if(!searchComposing&&query.length>=2)searchTimer=setTimeout(()=>searchCities(query),300);
}

function selectCity(city){loadCity(city);worldGlobe?.flyToCity(city);}

function weatherInfo(code,day=true){
 if(code===0) return {kind:day?'sun':'moon',text:day?'Despejado':'Noche despejada'};
 if(code===1) return {kind:day?'sun':'moon',text:'Mayormente despejado'};
 if([2,3].includes(code)) return {kind:'cloud',text:code===2?'Parcialmente nublado':'Nublado'};
 if([45,48].includes(code)) return {kind:'fog',text:'Niebla'};
 if([51,53,55,56,57].includes(code)) return {kind:'rain',text:'Llovizna'};
 if([61,63,65,66,67,80,81,82].includes(code)) return {kind:'rain',text:[65,67,82].includes(code)?'Lluvia intensa':'Lluvia'};
 if([71,73,75,77,85,86].includes(code)) return {kind:'snow',text:'Nieve'};
 if([95,96,99].includes(code)) return {kind:'storm',text:code===95?'Tormenta':'Tormenta con granizo'};
 return {kind:'cloud',text:'Condición no disponible'};
}
function temperature(value){return finite(value)?`${Math.round(units==='F'?value*9/5+32:value)}°`:'—';}
function number(value,digits=0){return finite(value)?value.toLocaleString('es-AR',{maximumFractionDigits:digits}):'—';}
function dateFormat(epoch,options={hour:'2-digit',minute:'2-digit'}){
 if(!finite(epoch))return '—';
 try{return new Intl.DateTimeFormat('es-AR',{hourCycle:'h23',...options,timeZone:current?.data.timezone||'UTC'}).format(new Date(epoch*1000));}catch{return '—';}
}
function setStatus(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
async function getJSON(url,signal){
 const controller=new AbortController();
 const abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch(url,{signal:controller.signal});
  if(!response.ok)throw new Error(response.status===429?'El servicio está ocupado. Probá nuevamente en unos minutos.':'El servicio meteorológico no respondió.');
  const data=await response.json();
  if(data.error)throw new Error('El proveedor no pudo completar la consulta.');
  return data;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function forecastURL(city){
 return `${API}?${new URLSearchParams({latitude:city.lat,longitude:city.lon,
  current:'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
  hourly:'temperature_2m,apparent_temperature,weather_code,precipitation_probability,precipitation,visibility,is_day,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,pressure_msl,uv_index',
  daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_gusts_10m_max',
  temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm',timezone:'auto',timeformat:'unixtime',forecast_days:'8'
 })}`;
}
function getCache(city){const cache=read(KEYS.cache,[]);return Array.isArray(cache)?cache.find(item=>validCity(item?.city)&&cityKey(item.city)===cityKey(city)&&validForecast(item.data)&&finite(item.savedAt)):null;}
function saveCache(city,data){const cache=read(KEYS.cache,[]);write(KEYS.cache,[{city,data,savedAt:Date.now()},...(Array.isArray(cache)?cache:[]).filter(item=>validCity(item?.city)&&cityKey(item.city)!==cityKey(city))].slice(0,6));}
function commitForecast(city,data,savedAt,fromCache=false){
 current={city,data,savedAt,fromCache};
 worldGlobe?.setCity(city);
 forecastMap?.setCity({...city,timezone:data.timezone});
 loadClimate(city);
 write(KEYS.city,city);
 render();
 $('weather-content').hidden=false;
 $('empty-state').hidden=true;
}
async function loadCity(city){
 if(!validCity(city))return;
 const sequence=++requestNumber;
 forecastController?.abort();
 forecastController=new AbortController();
 requestedCity=city;
 lastRequestAt=Date.now();
 document.body.classList.add('loading');
 $('refresh').disabled=true;
 if(document.activeElement!==$('city-input')||searchOptions.length)$('city-input').value=city.nombre;
 closeSearch();
 setStatus('Actualizando el pronóstico…');
 const cached=getCache(city);
 if(cached)commitForecast(city,cached.data,cached.savedAt,true);
 try{
  const data=await getJSON(forecastURL(city),forecastController.signal);
  if(sequence!==requestNumber)return;
  if(!validForecast(data))throw new Error('El proveedor devolvió datos incompletos.');
  commitForecast(city,data,Date.now());
  saveCache(city,data);
  if(Date.now()/1000-data.current.time>7200)setStatus(`Proveedor con demora · datos del ${dateFormat(data.current.time,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`,true);
  else setStatus(`Datos de las ${dateFormat(data.current.time)} · ${data.timezone_abbreviation||'hora local'}`);
 }catch(error){
  if(sequence!==requestNumber)return;
  if(cached){
   setStatus(`Sin conexión · último pronóstico guardado del ${dateFormat(cached.savedAt/1000,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`,true);
   $('last-sync').textContent='Datos guardados · pueden estar desactualizados';
  }else if(current){
   setStatus(`No se pudo cargar ${city.nombre}. Se conserva el pronóstico anterior.`,true);
  }else{
   $('empty-state').hidden=false;$('weather-content').hidden=true;
   setStatus(error.name==='AbortError'?'La consulta tardó demasiado. Reintentá.':error.message||'No hay conexión con el servicio.',true);
  }
 }finally{
  if(sequence===requestNumber){document.body.classList.remove('loading');$('refresh').disabled=false;}
 }
}
async function searchCities(query){
 clearTimeout(searchTimer);
 const sequence=++searchNumber;
 searchController?.abort();searchController=new AbortController();
 const results=$('search-results');results.hidden=false;results.innerHTML='<p class="search-message">Buscando ciudades…</p>';
 searchOptions=[];searchActive=-1;$('city-input').removeAttribute('aria-activedescendant');$('city-input').setAttribute('aria-expanded','true');
 try{
  const data=await getJSON(`${GEO}?${new URLSearchParams({name:query,count:'10',language:'es',format:'json'})}`,searchController.signal);
  if(sequence!==searchNumber)return;
  const cities=(data.results||[]).map(item=>({nombre:item.name,provincia:item.admin1||'',pais:item.country||'',lat:item.latitude,lon:item.longitude,poblacion:item.population})).filter(validCity);
  results.replaceChildren();
  if(!cities.length){results.innerHTML='<p class="search-message">No encontramos esa ciudad. Probá con otro nombre.</p>';return;}
  searchOptions=cities;
  for(const city of cities){
   const button=document.createElement('button');button.type='button';button.className='search-result';
   button.id=`city-option-${results.children.length}`;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.tabIndex=-1;
   // Population and coordinates tell apart places with the same name.
   const people=finite(city.poblacion)&&city.poblacion>0?(city.poblacion>=1e6?`${number(city.poblacion/1e6,1)} M hab.`:`${number(city.poblacion)} hab.`):'';
   const where=`${Math.abs(city.lat).toFixed(1)}° ${city.lat<0?'S':'N'} · ${Math.abs(city.lon).toFixed(1)}° ${city.lon<0?'O':'E'}`;
   button.innerHTML=`${icon('pin')}<span class="search-name">${escape(city.nombre)}<small>${escape([city.provincia,city.pais].filter(Boolean).join(' · '))}</small></span><span class="search-meta">${escape(people)}<small>${escape(where)}</small></span>`;
   button.addEventListener('click',()=>{selectCity(city);$('city-input').focus();});results.appendChild(button);
  }
 }catch(error){if(sequence===searchNumber&&error.name!=='AbortError')results.innerHTML='<p class="search-message">No se pudo buscar. Revisá tu conexión e intentá otra vez.</p>';else if(sequence===searchNumber)results.innerHTML='<p class="search-message">La búsqueda tardó demasiado. Intentá otra vez.</p>';}
}
function renderFavorites(){
 const container=$('favorites');container.replaceChildren();
 for(const city of favorites){
  const button=document.createElement('button');button.type='button';button.className='favorite-city';button.textContent=city.nombre;
  button.classList.toggle('active',!!current&&cityKey(city)===cityKey(current.city));
  button.setAttribute('aria-label',`Ver clima de ${city.nombre}`);button.addEventListener('click',()=>selectCity(city));container.appendChild(button);
 }
 const selected=!!current&&favorites.some(city=>cityKey(city)===cityKey(current.city));
 $('favorite-toggle').setAttribute('aria-pressed',String(selected));
 $('favorite-toggle').setAttribute('aria-label',selected?'Quitar ciudad de favoritos':'Agregar ciudad a favoritos');
}
function render(){
 if(!current)return;
 const {city,data}=current,c=data.current,d=data.daily,h=data.hourly;
 const info=weatherInfo(c.weather_code,c.is_day!==0);
 $('city-name').textContent=city.nombre;
 $('city-region').textContent=[city.provincia,city.pais].filter(Boolean).join(' · ');
 $('condition-time').textContent=`Condiciones de las ${dateFormat(c.time)}`;
 const temp=temperature(c.temperature_2m);
 $('current-temp').innerHTML=`${escape(temp.replace('°',''))}<span>°${units}</span>`;
 $('condition').textContent=info.text;
 $('feels').textContent=`Sensación térmica ${temperature(c.apparent_temperature)}`;
 $('weather-art').innerHTML=weatherArt(info.kind,c.is_day===0);
 $('high-low').textContent=`Máx. ${temperature(d.temperature_2m_max?.[0])} · Mín. ${temperature(d.temperature_2m_min?.[0])}`;
 $('rain-today').textContent=`Lluvia hoy ${number(d.precipitation_probability_max?.[0])}%`;
 $('units').textContent=`°${units}`;
 $('units').setAttribute('aria-label',`Cambiar a grados ${units==='C'?'Fahrenheit':'Celsius'}`);
 $('last-sync').textContent=current.fromCache?`Datos guardados del ${dateFormat(current.savedAt/1000,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:`Consultado ${dateFormat(current.savedAt/1000)} · actualización cada 10 min`;
 renderFavorites();renderHourly();renderDaily();renderMetrics();
 updateSimulation(city,data);
 updateAlerts({city,data,temperature});
}
function renderHourly(){
 const {hourly:h,current:c}=current.data;
 const first=h.time.findIndex(time=>time>=Math.floor(c.time/3600)*3600);
 const container=$('hourly');container.replaceChildren();
 if(first<0){container.textContent='Sin pronóstico horario disponible.';return;}
 for(let i=first;i<Math.min(first+24,h.time.length);i++){
  const info=weatherInfo(h.weather_code?.[i],h.is_day?.[i]!==0);
  const hour=document.createElement('div');hour.className='hour';hour.setAttribute('aria-label',`${dateFormat(h.time[i])}, ${info.text}, ${temperature(h.temperature_2m?.[i])}, lluvia ${number(h.precipitation_probability?.[i])}%`);
  hour.innerHTML=`<span class="hour-time">${i===first?'Ahora':dateFormat(h.time[i])}</span>${icon(info.kind)}<span class="hour-temp">${temperature(i===first?c.temperature_2m:h.temperature_2m?.[i])}</span><span class="hour-rain">${number(h.precipitation_probability?.[i])}%</span>`;
  container.appendChild(hour);
 }
}
function renderDaily(){
 const d=current.data.daily,container=$('daily');container.replaceChildren();
 const lows=(d.temperature_2m_min||[]).slice(0,7).filter(finite),highs=(d.temperature_2m_max||[]).slice(0,7).filter(finite);
 const min=lows.length?Math.min(...lows):0,max=highs.length?Math.max(...highs):min+1,spread=Math.max(1,max-min);
 for(let i=0;i<Math.min(7,d.time.length);i++){
  const info=weatherInfo(d.weather_code?.[i]);const row=document.createElement('div');row.className='day';
  const low=d.temperature_2m_min?.[i],high=d.temperature_2m_max?.[i];
  const left=finite(low)?Math.max(0,Math.min(100,(low-min)/spread*100)):0;
  const width=finite(high)&&finite(low)?Math.max(3,Math.min(100-left,(high-low)/spread*100)):0;
  row.innerHTML=`<span class="day-name">${i===0?'Hoy':dateFormat(d.time[i],{weekday:'short'}).replace('.','')}</span><span title="${escape(info.text)}">${icon(info.kind)}</span><span class="day-rain">${number(d.precipitation_probability_max?.[i])}%</span><span class="temp-range" aria-hidden="true"><span style="left:${left}%;width:${width}%"></span></span><span class="temp-low">${temperature(low)}</span><span class="temp-high">${temperature(high)}</span>`;
  container.appendChild(row);
 }
}
function renderMetrics(){
 const {current:c,daily:d,hourly:h}=current.data;
 const index=Math.max(0,h.time.findIndex(time=>time>=Math.floor(c.time/3600)*3600));
 const uv=d.uv_index_max?.[0];
 const uvLabel=!finite(uv)?'Sin dato':uv<3?'Bajo':uv<6?'Moderado':uv<8?'Alto':uv<11?'Muy alto':'Extremo';
 const direction=finite(c.wind_direction_10m)?['N','NE','E','SE','S','SO','O','NO'][Math.round(c.wind_direction_10m/45)%8]:'—';
 const metrics=[
  ['Humedad','drop',number(c.relative_humidity_2m),'%','Humedad relativa'],
  ['Viento','wind',number(c.wind_speed_10m),'km/h',`Desde el ${direction}`],
  ['Ráfagas','wind',number(c.wind_gusts_10m),'km/h','Ráfaga del modelo'],
  ['Presión','gauge',number(c.pressure_msl),'hPa','Al nivel del mar'],
  ['Índice UV','sun',number(uv,1),'',`${uvLabel} · máximo del día`],
  ['Visibilidad','eye',number(finite(h.visibility?.[index])?h.visibility[index]/1000:null,1),'km','Pronóstico horario'],
  ['Amanecer','sunrise',dateFormat(d.sunrise?.[0]),'','Hora local de la ciudad'],
  ['Atardecer','sunset',dateFormat(d.sunset?.[0]),'','Hora local de la ciudad'],
  ['Nubosidad','cloud',number(c.cloud_cover),'%','Cobertura total'],
  ['Precipitación','rain',number(d.precipitation_sum?.[0],1),'mm','Acumulado previsto hoy']
 ];
 $('metrics').innerHTML=metrics.map(([name,glyph,value,unit,description])=>`<div class="metric"><p class="metric-name">${icon(glyph)}${name}</p><p class="metric-value">${escape(value)} <small>${unit}</small></p><p class="metric-description">${escape(description)}</p></div>`).join('');
}
async function openURL(url){
 try{if(window.__TAURI__?.core?.invoke)await window.__TAURI__.core.invoke('plugin:opener|open_url',{url});else window.open(url,'_blank','noopener,noreferrer');}catch{setStatus('No se pudo abrir el enlace en el navegador.',true);}
}
async function openSource(key){
 const url=key==='earth'?'https://nasa-gibs.github.io/gibs-api-docs/':key==='power'?'https://power.larc.nasa.gov/':key==='alerts'?'https://eonet.gsfc.nasa.gov/':'https://open-meteo.com/';
 try{if(window.__TAURI__?.core?.invoke)await window.__TAURI__.core.invoke('plugin:opener|open_url',{url});else window.open(url,'_blank','noopener,noreferrer');}catch{setStatus('No se pudo abrir la fuente en el navegador.',true);}
}
document.querySelectorAll('[data-icon]').forEach(element=>element.innerHTML=icon(element.dataset.icon));
$('city-input').setAttribute('role','combobox');$('city-input').setAttribute('aria-autocomplete','list');$('city-input').setAttribute('aria-controls','search-results');$('city-input').setAttribute('aria-expanded','false');
$('city-input').placeholder='Buscar ciudad en el mundo';
$('search-results').setAttribute('role','listbox');
$('search-form').addEventListener('submit',event=>{event.preventDefault();if(searchComposing)return;if(searchOptions[searchActive]){selectCity(searchOptions[searchActive]);return;}const query=$('city-input').value.trim();if(query.length>=2)searchCities(query);else setStatus('Escribí al menos dos letras para buscar una ciudad.');});
$('city-input').addEventListener('input',queueSearch);
$('city-input').addEventListener('compositionstart',()=>{searchComposing=true;closeSearch();});
$('city-input').addEventListener('compositionend',()=>{searchComposing=false;queueSearch();});
$('city-input').addEventListener('keydown',event=>{
 if(event.isComposing)return;
 if(event.key==='Escape'){event.preventDefault();closeSearch();}
 else if(event.key==='Tab')closeSearch();
 else if(['ArrowDown','ArrowUp'].includes(event.key)&&searchOptions.length){event.preventDefault();activateSearch((searchActive+(event.key==='ArrowDown'?1:searchActive<0?0:-1)+searchOptions.length)%searchOptions.length);}
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.search-area'))closeSearch();});
$('refresh').addEventListener('click',()=>loadCity(requestedCity));
$('retry').addEventListener('click',()=>loadCity(requestedCity));
$('units').textContent=`°${units}`;
setClimateUnits(units);
initSimulation({weatherInfo,temperature});
$('units').addEventListener('click',()=>{units=units==='C'?'F':'C';write(KEYS.units,units);setClimateUnits(units);render();});
$('favorite-toggle').addEventListener('click',()=>{
 if(!current)return;
 const key=cityKey(current.city),exists=favorites.some(city=>cityKey(city)===key);
 if(exists)favorites=favorites.filter(city=>cityKey(city)!==key);
 else if(favorites.length<6)favorites.push(current.city);
 else{setStatus('Podés guardar hasta 6 ciudades. Quitá una favorita para agregar otra.');return;}
 write(KEYS.favorites,favorites);renderFavorites();
});
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>openSource(button.dataset.source)));
document.querySelectorAll('[data-target]').forEach(button=>button.addEventListener('click',()=>{
 const target=$(button.dataset.target);if(!target||(button.dataset.target!=='world-panel'&&$('weather-content').hidden))return;
 document.querySelectorAll('[data-target]').forEach(item=>item.classList.toggle('active',item===button));
 target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}));
setInterval(()=>{if(!document.hidden)loadCity(requestedCity);},PERIOD);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(Date.now()-lastRequestAt>PERIOD)loadCity(requestedCity);}});
window.addEventListener('beforeunload',()=>{forecastController?.abort();searchController?.abort();});
renderFavorites();
loadCity(requestedCity);
initAlerts({onShowEvent:item=>worldGlobe?.showEvent(item),onOpenLink:openURL});
const loadEvents=()=>refreshEvents().then(list=>worldGlobe?.setEvents(list));
setInterval(()=>{if(!document.hidden)loadEvents();},PERIOD);
initWorldGlobe({
 onOpenLink:openURL,
 onPointSelected(city){loadCity(city);$('summary').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});},
 async onOpenGoogleMaps(point){
  const url=`https://www.google.com/maps/@?${new URLSearchParams({api:'1',map_action:'map',center:`${point.lat.toFixed(5)},${point.lon.toFixed(5)}`,zoom:'5',basemap:'satellite'})}`;
  try{if(window.__TAURI__?.core?.invoke)await window.__TAURI__.core.invoke('plugin:opener|open_url',{url});else window.open(url,'_blank','noopener,noreferrer');}catch{setStatus('No se pudo abrir Google Maps.',true);}
 }
}).then(controller=>{worldGlobe=controller;if(controller){forecastMap=initForecastMap(controller);if(current){controller.setCity(current.city);forecastMap.setCity({...current.city,timezone:current.data.timezone});}const pending=takePendingGoto();if(pending!==null)window.dispatchEvent(new CustomEvent('mw:forecast-goto',{detail:{time:pending}}));}loadEvents();});
