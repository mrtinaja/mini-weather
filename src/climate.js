import {icon} from './icons.js';

// NASA POWER: 25-year monthly normals plus the latest 30 days with data, for the selected place.
const POWER='https://power.larc.nasa.gov/api/temporal';
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const INITIALS=['E','F','M','A','M','J','J','A','S','O','N','D'];
const MONTH_DAYS=[31,28.25,31,30,31,30,31,31,30,31,30,31];
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value!==-999;
const number=(value,digits=0)=>finite(value)?value.toLocaleString('es-AR',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—';
const compact=date=>date.toISOString().slice(0,10).replaceAll('-','');
const normals=new Map();
let state=null,controller=null,sequence=0,units='C';

async function getJSON(url,signal){
 const timer=setTimeout(()=>controller?.abort(),30000);
 try{
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error('NASA POWER no respondió.');
  return await response.json();
 }finally{clearTimeout(timer);}
}
function pointQuery(city){return `community=AG&latitude=${city.lat.toFixed(3)}&longitude=${city.lon.toFixed(3)}&format=JSON`;}
function temperature(value){return finite(value)?`${number(units==='F'?value*9/5+32:value,0)}°`:'—';}
function difference(value){return finite(value)?number(Math.abs(units==='F'?value*9/5:value),1):'—';}

function recentSummary(daily,normal){
 const temps=daily.T2M||{},rain=daily.PRECTOTCORR||{};
 const days=Object.keys(temps).filter(day=>finite(temps[day])&&finite(rain[day])).sort().slice(-30);
 if(days.length<20)return null;
 let temp=0,expectedTemp=0,total=0,expectedRain=0;
 for(const day of days){
  const month=MONTHS[Number(day.slice(4,6))-1];
  temp+=temps[day];total+=rain[day];
  expectedTemp+=normal.T2M[month];expectedRain+=normal.PRECTOTCORR[month];
 }
 const last=days.at(-1);
 return {days:days.length,until:new Date(Date.UTC(+last.slice(0,4),+last.slice(4,6)-1,+last.slice(6,8),12)),temp:temp/days.length,tempDelta:(temp-expectedTemp)/days.length,rain:total,expectedRain};
}

function chart(normal){
 const width=360,height=176,left=28,right=44,top=16,bottom=24,plot=height-top-bottom,step=(width-left-right)/12;
 const rain=MONTHS.map((month,index)=>normal.PRECTOTCORR[month]*MONTH_DAYS[index]);
 const temps=MONTHS.map(month=>normal.T2M[month]);
 const rainMax=Math.max(10,...rain)*1.1,low=Math.min(...temps)-2,high=Math.max(...temps)+2;
 const y=value=>top+plot-(value-low)/(high-low)*plot;
 const nowMonth=new Date().getMonth();
 const bars=rain.map((value,index)=>{const h=value/rainMax*plot;return `<rect x="${(left+index*step+step*.18).toFixed(1)}" y="${(top+plot-h).toFixed(1)}" width="${(step*.64).toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="${index===nowMonth?'bar now':'bar'}"><title>${INITIALS[index]}: ${number(value)} mm</title></rect>`;}).join('');
 const points=temps.map((value,index)=>`${(left+index*step+step/2).toFixed(1)},${y(value).toFixed(1)}`);
 const dots=temps.map((value,index)=>`<circle cx="${(left+index*step+step/2).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${index===nowMonth?4:2.6}" class="dot"><title>${INITIALS[index]}: ${temperature(value)} de media</title></circle>`).join('');
 const labels=INITIALS.map((label,index)=>`<text x="${(left+index*step+step/2).toFixed(1)}" y="${height-7}" class="${index===nowMonth?'label now':'label'}">${label}</text>`).join('');
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Lluvia mensual normal en barras y temperatura media en línea">
  <text x="${left-4}" y="${top-4}" class="axis start">${temperature(high-2)}</text><text x="${left-4}" y="${top+plot}" class="axis start">${temperature(low+2)}</text>
  <text x="${width-right+4}" y="${top-4}" class="axis end">${number(rainMax/1.1)} mm</text>
  ${bars}<polyline points="${points.join(' ')}" class="line"/>${dots}${labels}</svg>
  <div class="climate-legend"><span><i class="swatch rain"></i>Lluvia del mes</span><span><i class="swatch temp"></i>Temperatura media</span></div>`;
}

function draw(){
 if(!state)return;
 const {normal,recent}=state;
 if(recent){
  const warmer=recent.tempDelta>=0,ratio=recent.expectedRain>0?recent.rain/recent.expectedRain*100:null;
  const until=recent.until.toLocaleDateString('es-AR',{day:'numeric',month:'long',timeZone:'UTC'});
  $('climate-recent').innerHTML=`<p class="kicker">Últimos ${recent.days} días · al ${escape(until)}</p>
   <div class="climate-compare"><div><p class="metric-value">${temperature(recent.temp)}</p><p class="metric-description ${Math.abs(recent.tempDelta)<.5?'':warmer?'warm':'cool'}">${Math.abs(recent.tempDelta)<.5?'Dentro de lo normal':`${difference(recent.tempDelta)}° más ${warmer?'cálido':'frío'} que lo normal`}</p></div>
   <div><p class="metric-value">${number(recent.rain)} <small>mm</small></p><p class="metric-description ${ratio===null||Math.abs(ratio-100)<15?'':ratio>100?'wet':'dry'}">${ratio===null?'Sin lluvia esperada':`${number(ratio)}% de lo normal (${number(recent.expectedRain)} mm)`}</p></div></div>`;
 }else $('climate-recent').innerHTML='';
 $('climate-chart').innerHTML=chart(normal);
 const yearRain=MONTHS.reduce((sum,month,index)=>sum+normal.PRECTOTCORR[month]*MONTH_DAYS[index],0);
 const wettest=MONTHS.reduce((best,month,index)=>normal.PRECTOTCORR[month]*MONTH_DAYS[index]>normal.PRECTOTCORR[MONTHS[best]]*MONTH_DAYS[best]?index:best,0);
 const monthTemps=MONTHS.map(month=>normal.T2M[month]);
 const monthName=index=>new Date(Date.UTC(2000,index,15)).toLocaleDateString('es-AR',{month:'long',timeZone:'UTC'});
 const stats=[
  ['Temperatura media','thermometer',temperature(normal.T2M.ANN),'','Promedio anual'],
  ['Lluvia anual','rain',number(yearRain),'mm',`Mes más lluvioso: ${monthName(wettest)}`],
  ['Radiación solar','sun',number(normal.ALLSKY_SFC_SW_DWN.ANN,1),'kWh/m²','Por día, promedio anual'],
  ['Humedad','drop',number(normal.RH2M.ANN),'%','Relativa, promedio anual'],
  ['Viento','wind',number(normal.WS2M.ANN*3.6),'km/h','A 2 m del suelo, promedio'],
  ['Amplitud','gauge',difference(Math.max(...monthTemps)-Math.min(...monthTemps)),'°','Entre el mes más cálido y el más frío']
 ];
 $('climate-stats').innerHTML=stats.map(([name,glyph,value,unit,description])=>`<div class="metric"><p class="metric-name">${icon(glyph)}${name}</p><p class="metric-value">${escape(value)} <small>${unit}</small></p><p class="metric-description">${escape(description)}</p></div>`).join('');
}

export function setClimateUnits(next){units=next==='F'?'F':'C';draw();}

export async function loadClimate(city){
 const key=`${city.lat.toFixed(2)},${city.lon.toFixed(2)}`;
 if(state?.key===key)return;
 const run=++sequence;
 controller?.abort();controller=new AbortController();
 const signal=controller.signal;
 $('climate-state').hidden=false;$('climate-state').classList.remove('error');
 $('climate-state').textContent=`Consultando a NASA POWER el clima de ${city.nombre}…`;
 try{
  const end=new Date(Date.now()-86400000),start=new Date(Date.now()-50*86400000);
  const normalRequest=normals.has(key)?Promise.resolve(normals.get(key)):getJSON(`${POWER}/climatology/point?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M&${pointQuery(city)}`,signal).then(data=>data.properties?.parameter);
  const dailyRequest=getJSON(`${POWER}/daily/point?parameters=T2M,PRECTOTCORR&start=${compact(start)}&end=${compact(end)}&${pointQuery(city)}`,signal).then(data=>data.properties?.parameter).catch(()=>null);
  const [normal,daily]=await Promise.all([normalRequest,dailyRequest]);
  if(run!==sequence)return;
  if(!normal||!MONTHS.every(month=>finite(normal.T2M?.[month])&&finite(normal.PRECTOTCORR?.[month])))throw new Error('NASA POWER no tiene datos para este lugar.');
  normals.set(key,normal);
  state={key,normal,recent:daily?recentSummary(daily,normal):null};
  draw();
  $('climate-state').hidden=!!state.recent;
  $('climate-state').textContent=state.recent?'':'No hay datos diarios recientes para comparar; se muestran solo las normales.';
 }catch(error){
  if(run!==sequence)return;
  state=null;
  $('climate-recent').innerHTML='';$('climate-chart').innerHTML='';$('climate-stats').innerHTML='';
  $('climate-state').hidden=false;$('climate-state').classList.add('error');
  $('climate-state').textContent=error.name==='AbortError'?'NASA POWER tardó demasiado en responder. Probá actualizar en un rato.':error.message||'No se pudo consultar NASA POWER.';
 }
}
