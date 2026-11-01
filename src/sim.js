import {icon} from './icons.js';
import {SECTIONS, sectionOf} from './forecast-map.js';

// Dashboard of the 5-day simulation for the chosen city: conditions at the selected hour, a
// day × moment-of-day matrix and an hour-by-hour chart. The selected hour is shared with the
// globe through 'mw:forecast-time' (globe → here) and 'mw:forecast-goto' (here → globe).
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const number=(value,digits=0)=>finite(value)?value.toLocaleString('es-AR',{maximumFractionDigits:digits}):'—';
const HOURS=120;
const compass=degrees=>finite(degrees)?['N','NE','E','SE','S','SO','O','NO'][Math.round(degrees/45)%8]:'—';
const TEMP_COLORS=[[-10,[82,105,196]],[0,[102,201,233]],[12,[96,181,131]],[22,[234,210,99]],[32,[219,100,78]]];
function tempTint(value){
 if(!finite(value))return 'transparent';
 let color=TEMP_COLORS.at(-1)[1];
 for(let i=1;i<TEMP_COLORS.length;i++)if(value<=TEMP_COLORS[i][0]){
  const [v0,c0]=TEMP_COLORS[i-1],[v1,c1]=TEMP_COLORS[i],t=Math.max(0,(value-v0)/(v1-v0));
  color=c0.map((c,k)=>Math.round(c+(c1[k]-c)*t));break;
 }
 return `rgba(${color.join(',')},.22)`;
}

let state=null,helpers=null,selected=null,pendingGoto=null;

function buildSlots(data){
 const h=data.hourly,start=Math.floor(data.current.time/3600)*3600;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
 const slots=[];
 h.time.forEach((time,index)=>{
  if(time<start||time>=start+HOURS*3600)return;
  const p=Object.fromEntries(parts.formatToParts(new Date(time*1000)).map(part=>[part.type,part.value]));
  slots.push({time,index,day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour)});
 });
 return slots;
}
const value=(key,index)=>state.data.hourly[key]?.[index];

function renderNow(slot){
 const {weatherInfo,temperature}=helpers,i=slot.index;
 const info=weatherInfo(value('weather_code',i),value('is_day',i)!==0);
 const tz=state.data.timezone||'UTC';
 const moment=new Intl.DateTimeFormat('es-AR',{timeZone:tz,weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(slot.time*1000))+` · ${sectionOf(slot.hour).label.toLowerCase()}`;
 $('sim-moment').textContent=moment.charAt(0).toUpperCase()+moment.slice(1);
 const gust=value('wind_gusts_10m',i);
 const cards=[
  ['Lluvia','rain',`${number(value('precipitation_probability',i))}%`,`${number(value('precipitation',i),1)} mm en la hora`],
  ['Viento','wind',`${number(value('wind_speed_10m',i))} km/h`,`Del ${compass(value('wind_direction_10m',i))}${finite(gust)?` · ráfagas ${number(gust)}`:''}`],
  ['Humedad','drop',`${number(value('relative_humidity_2m',i))}%`,'Relativa'],
  ['Nubosidad','cloud',`${number(value('cloud_cover',i))}%`,'Cielo cubierto'],
  ['Presión','gauge',`${number(value('pressure_msl',i))} hPa`,'Al nivel del mar'],
  ['Índice UV','sun',number(value('uv_index',i),1),'En esa hora'],
  ['Visibilidad','eye',`${number(finite(value('visibility',i))?value('visibility',i)/1000:null,1)} km`,'Horizontal']
 ];
 $('sim-now').innerHTML=`<div class="sim-hero">${icon(info.kind)}<div><p class="sim-temp">${escape(temperature(value('temperature_2m',i)))}</p><p class="sim-condition">${escape(info.text)}</p><p class="muted">Sensación ${escape(temperature(value('apparent_temperature',i)))}</p></div></div>`+
  `<div class="sim-cards">${cards.map(([name,glyph,main,detail])=>`<div class="metric"><p class="metric-name">${icon(glyph)}${name}</p><p class="metric-value">${escape(main)}</p><p class="metric-description">${escape(detail)}</p></div>`).join('')}</div>`;
}

function renderMatrix(slot){
 const {weatherInfo,temperature}=helpers,slots=state.slots;
 const days=[...new Set(slots.map(s=>s.day))].slice(0,5);
 const dayLabel=new Intl.DateTimeFormat('es-AR',{timeZone:'UTC',weekday:'short',day:'numeric'});
 let html=`<div class="sim-row sim-head"><span></span>${SECTIONS.map(section=>`<span>${section.label}</span>`).join('')}</div>`;
 days.forEach((day,d)=>{
  html+=`<div class="sim-row" role="row"><span class="sim-day">${d===0?'Hoy':escape(dayLabel.format(new Date(`${day}T12:00:00Z`)))}</span>`;
  for(const section of SECTIONS){
   const hours=slots.filter(s=>s.day===day&&sectionOf(s.hour)===section);
   if(!hours.length){html+='<span class="sim-cell empty" role="gridcell">—</span>';continue;}
   const temps=hours.map(s=>value('temperature_2m',s.index)).filter(finite);
   const codes=hours.map(s=>value('weather_code',s.index)).filter(finite);
   const rain=Math.max(0,...hours.map(s=>value('precipitation_probability',s.index)).filter(finite));
   const wind=Math.max(0,...hours.map(s=>value('wind_speed_10m',s.index)).filter(finite));
   const middle=hours[Math.floor(hours.length/2)];
   const info=weatherInfo(codes.length?Math.max(...codes):null,value('is_day',middle.index)!==0);
   const avg=temps.length?temps.reduce((a,b)=>a+b,0)/temps.length:null;
   const isSelected=hours.some(s=>s.time===slot.time);
   html+=`<button type="button" role="gridcell" class="sim-cell${isSelected?' selected':''}" data-time="${middle.time}" style="--tint:${tempTint(avg)}" title="${escape(info.text)}">${icon(info.kind)}<b>${escape(temperature(Math.max(...temps)))}</b><small>${escape(temperature(Math.min(...temps)))}</small><span class="sim-rain${rain>=50?' high':''}">${icon('drop')}${number(rain)}%</span><span class="sim-wind">${icon('wind')}${number(wind)}</span></button>`;
  }
  html+='</div>';
 });
 $('sim-matrix').innerHTML=html;
}

// 24-hour window around the selected hour (6 h before, 18 h after), so it is always full even late at night.
function renderChart(slot){
 const {temperature}=helpers,slots=state.slots,at=slots.indexOf(slot);
 const from=Math.max(0,Math.min(slots.length-24,at-6)),hours=slots.slice(from,from+24);
 const dayName=day=>new Intl.DateTimeFormat('es-AR',{timeZone:'UTC',weekday:'short',day:'numeric'}).format(new Date(`${day}T12:00:00Z`));
 $('sim-day-title').innerHTML=`Hora por hora <span class="muted">· ${escape(dayName(hours[0].day))}${hours.at(-1).day!==hours[0].day?` a ${escape(dayName(hours.at(-1).day))}`:''}</span>`;
 const width=520,height=210,left=34,right=40,top=20,bottom=34,plot=height-top-bottom,step=(width-left-right)/hours.length;
 const temps=hours.map(s=>value('temperature_2m',s.index)).filter(finite);
 if(!temps.length){$('sim-chart').innerHTML='';return;}
 const low=Math.min(...temps)-2,high=Math.max(...temps)+2,rainMax=Math.max(2,...hours.map(s=>value('precipitation',s.index)).filter(finite));
 const x=i=>left+i*step+step/2,y=v=>top+plot-(v-low)/(high-low)*plot;
 // Night-time sections shaded hour by hour; a label where each section starts.
 const bands=hours.map((s,i)=>{
  const section=sectionOf(s.hour),start=i===0||sectionOf(hours[i-1].hour)!==section;
  // A section cut short at the window's edge gets no label, so labels never overlap.
  const span=hours.slice(i).findIndex(next=>sectionOf(next.hour)!==section);
  return `${['madrugada','noche'].includes(section.key)?`<rect x="${(left+i*step).toFixed(1)}" y="${top}" width="${(step+.5).toFixed(1)}" height="${plot}" class="sim-shade"/>`:''}${start&&(span<0?hours.length-i:span)>=4?`<text x="${(left+i*step+2).toFixed(1)}" y="${top-6}" class="sim-band">${section.label}</text>`:''}`;
 }).join('');
 const bars=hours.map((s,i)=>{const v=value('precipitation',s.index);if(!finite(v)||v<=0)return '';const h=v/rainMax*plot*.6;return `<rect x="${(x(i)-step*.32).toFixed(1)}" y="${(top+plot-h).toFixed(1)}" width="${(step*.64).toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="sim-bar"/>`;}).join('');
 const prob=hours.map((s,i)=>`${x(i).toFixed(1)},${(top+plot-(value('precipitation_probability',s.index)||0)/100*plot).toFixed(1)}`).join(' ');
 const line=hours.map((s,i)=>finite(value('temperature_2m',s.index))?`${x(i).toFixed(1)},${y(value('temperature_2m',s.index)).toFixed(1)}`:null).filter(Boolean).join(' ');
 const hits=hours.map((s,i)=>`<rect x="${(x(i)-step/2).toFixed(1)}" y="${top}" width="${step.toFixed(1)}" height="${plot}" class="sim-hit" data-time="${s.time}"><title>${s.hour} h · ${temperature(value('temperature_2m',s.index))} · lluvia ${number(value('precipitation_probability',s.index))}% · ${number(value('precipitation',s.index),1)} mm</title></rect>`).join('');
 const ticks=hours.map((s,i)=>s.hour%3===0?`<text x="${x(i).toFixed(1)}" y="${height-18}" class="sim-tick">${s.hour} h</text>${s.hour===0?`<text x="${x(i).toFixed(1)}" y="${height-6}" class="sim-tick day">${escape(dayName(s.day))}</text><line x1="${(x(i)-step/2).toFixed(1)}" x2="${(x(i)-step/2).toFixed(1)}" y1="${top}" y2="${top+plot}" class="sim-midnight"/>`:''}`:'').join('');
 const cx=x(hours.indexOf(slot)),selectedTemp=value('temperature_2m',slot.index);
 $('sim-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Temperatura, probabilidad de lluvia y lluvia por hora">${bands}
  <text x="${left-6}" y="${top+8}" class="sim-axis-temp">${temperature(high-2)}</text><text x="${left-6}" y="${top+plot}" class="sim-axis-temp">${temperature(low+2)}</text><text x="${width-right+6}" y="${top+8}" class="sim-axis-rain">${number(rainMax,1)} mm</text>
  ${bars}<polyline points="${prob}" class="sim-prob"/><polyline points="${line}" class="sim-line"/>
  <line x1="${cx}" x2="${cx}" y1="${top}" y2="${top+plot}" class="sim-cursor"/>${finite(selectedTemp)?`<circle cx="${cx}" cy="${y(selectedTemp)}" r="4.5" class="sim-cursor-dot"/>`:''}
  ${ticks}${hits}</svg><div class="sim-legend"><span><i class="swatch temp"></i>Temperatura</span><span><i class="swatch prob"></i>Probabilidad de lluvia</span><span><i class="swatch rain"></i>Lluvia (mm)</span></div>`;
}

function render(){
 if(!state?.slots.length)return;
 const slot=state.slots.find(s=>s.time===selected)||state.slots[0];
 selected=slot.time;
 renderNow(slot);renderMatrix(slot);renderChart(slot);
}
function pick(time,fromGlobe=false){
 if(!state)return;
 let best=state.slots[0];
 for(const s of state.slots)if(Math.abs(s.time-time)<Math.abs(best.time-time))best=s;
 if(best.time===selected&&fromGlobe)return;
 selected=best.time;render();
 if(fromGlobe)return;
 // If the globe is still loading nobody handles the request; it is replayed by takePendingGoto().
 const detail={time:best.time,handled:false};
 window.dispatchEvent(new CustomEvent('mw:forecast-goto',{detail}));
 pendingGoto=detail.handled?null:best.time;
}

export function initSimulation(options){
 helpers=options;
 $('sim-matrix').addEventListener('click',event=>{const cell=event.target.closest('[data-time]');if(cell)pick(Number(cell.dataset.time));});
 $('sim-chart').addEventListener('click',event=>{const hit=event.target.closest('[data-time]');if(hit)pick(Number(hit.dataset.time));});
 window.addEventListener('mw:forecast-time',event=>pick(event.detail.time,true));
}
export function updateSimulation(city,data){
 const changed=!state||state.city.lat!==city.lat||state.city.lon!==city.lon;
 state={city,data,slots:buildSlots(data)};
 if(changed||!state.slots.some(s=>s.time===selected))selected=state.slots[0]?.time??null;
 $('sim-panel').hidden=!state.slots.length;
 render();
}
export const refreshSimulation=render;
export function takePendingGoto(){const time=pendingGoto;pendingGoto=null;return time;}
