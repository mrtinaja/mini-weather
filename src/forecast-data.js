const VARIABLES=['temperature_2m','precipitation','wind_speed_10m','wind_direction_10m','cloud_cover'];
// 13 × 13 points every 0.9° (about 1,200 km across) for the next 5 days, hour by hour:
// fine enough for clouds and rain bands to visibly move between frames.
export const GRID=13,SPACING=0.9,HOURS=120;
export const wrapLongitude=value=>((value+180)%360+360)%360-180;

export function forecastPoints(city){
 const half=(GRID-1)/2,limit=90-half*SPACING;
 const centerLat=Math.max(-limit,Math.min(limit,city.lat));
 return Array.from({length:GRID*GRID},(_,index)=>({lat:centerLat+(half-Math.floor(index/GRID))*SPACING,lon:wrapLongitude(city.lon+(index%GRID-half)*SPACING)}));
}

export function forecastURL(points){
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.search=new URLSearchParams({latitude:points.map(point=>point.lat.toFixed(5)).join(','),longitude:points.map(point=>point.lon.toFixed(5)).join(','),hourly:VARIABLES.join(','),forecast_hours:String(HOURS+1),timezone:'GMT',timeformat:'unixtime',temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm',cell_selection:'nearest'});
 return url;
}

export function parseForecast(data,points,now=Date.now()){
 const rows=Array.isArray(data)?data:[data];
 if(rows.length!==points.length)throw new Error('El modelo no devolvio toda la region.');
 const start=Math.floor(now/3600000)*3600;
 const times=rows[0]?.hourly?.time?.filter(time=>Number.isFinite(time)&&time>=start&&time<=start+HOURS*3600);
 if(!times?.length)throw new Error('El modelo no devolvio horas de pronostico vigentes.');
 const cells=rows.map((row,index)=>{
  const hourly=row?.hourly;
  if(!Array.isArray(hourly?.time)||VARIABLES.some(key=>!Array.isArray(hourly[key])||hourly[key].length!==hourly.time.length))throw new Error('El modelo devolvio datos incompletos.');
  const indices=new Map(hourly.time.map((time,i)=>[time,i]));
  return {...points[index],values:Object.fromEntries(VARIABLES.map(key=>[key,times.map(time=>{const value=hourly[key][indices.get(time)];return Number.isFinite(value)?value:null;})]))};
 });
 return {times,cells};
}
