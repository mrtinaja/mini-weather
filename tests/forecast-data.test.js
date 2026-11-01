import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forecastPoints,forecastURL,parseForecast,GRID,HOURS} from '../src/forecast-data.js';

test('regional grid wraps the date line and stays within both poles',()=>{
 for(const city of [{lat:90,lon:180},{lat:-90,lon:-180},{lat:0,lon:179.9}]){
  const points=forecastPoints(city);
  assert.equal(points.length,GRID*GRID);
  assert.ok(points.every(p=>p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<180));
 }
 const points=forecastPoints({lat:-34.6,lon:-58.38});
 const center=points[(GRID*GRID-1)/2];
 assert.equal(center.lat,-34.6);assert.ok(Math.abs(center.lon+58.38)<1e-9);
 assert.ok(points[0].lat>points.at(-1).lat,'rows run north to south');
 const url=forecastURL(points);
 assert.equal(url.searchParams.get('forecast_hours'),String(HOURS+1));
 assert.equal(url.searchParams.get('latitude').split(',').length,GRID*GRID);
});

function row(times,values){return {hourly:{time:times,temperature_2m:values,precipitation:values,wind_speed_10m:values,wind_direction_10m:values,cloud_cover:values}};}
test('forecasts align by time, preserve zero and keep missing values missing',()=>{
 const start=Date.UTC(2026,9,30,12)/1000;
 const points=[{lat:0,lon:0},{lat:1,lon:1}];
 const result=parseForecast([row([start-3600,start,start+3600],[5,0,null]),row([start+3600,start],[7,8])],points,start*1000);
 assert.deepEqual(result.times,[start,start+3600]);
 assert.deepEqual(result.cells[0].values.precipitation,[0,null]);
 assert.deepEqual(result.cells[1].values.precipitation,[8,7]);
});
test('partial, expired and malformed provider responses are rejected',()=>{
 assert.throws(()=>parseForecast([], [{lat:0,lon:0}]));
 assert.throws(()=>parseForecast(row([0],[1]),[{lat:0,lon:0}]));
 const start=Math.floor(Date.now()/3600000)*3600,invalid=row([start],[1]);
 invalid.hourly.cloud_cover=[];
 assert.throws(()=>parseForecast(invalid,[{lat:0,lon:0}]));
});
