import {icon} from './icons.js';
import {loadFields, fieldTile, windArrows, legendGradient, SCALES} from './fields.js';

const $=id=>document.getElementById(id);
const ARGENTINA={lat:-38,lon:-64};
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validPoint=point=>point&&Number.isFinite(point.lat)&&Number.isFinite(point.lon)&&Math.abs(point.lat)<=90&&Math.abs(point.lon)<=180;
// NASA GIBS layers (EPSG:3857 tiles). level = GoogleMapsCompatible_LevelN of each layer; parts = several satellites stitched.
// field = model layers (wind, pressure) drawn from fields.js.
// Geostationary satellites overlap at the edge of their disks, where the view is oblique and the
// images disagree; each one is clipped to its own longitude band [west, east] so there are no seams.
const BANDS={east:[-106,10],west:[-178,-106],himawari:[75,180]};
const GIBS='https://gibs.earthdata.nasa.gov';
const LAYERS={
 geocolor:{live:true,ext:'png',parts:[['GOES-East_ABI_GeoColor',7,BANDS.east],['GOES-West_ABI_GeoColor',7,BANDS.west]],label:'Nubes en vivo (color)',note:'GOES-East y GOES-West · GeoColor cada 10 minutos: de día color real, de noche infrarrojo con luces de ciudades. Cubre América y el Pacífico.'},
 infrared:{live:true,ext:'png',parts:[['GOES-East_ABI_Band13_Clean_Infrared',6,BANDS.east],['GOES-West_ABI_Band13_Clean_Infrared',6,BANDS.west],['Himawari_AHI_Band13_Clean_Infrared',6,BANDS.himawari]],legend:'Clean_Longwave_Infrared_Window_Band_H.svg',label:'Nubes en vivo (infrarrojo)',note:'GOES-East, GOES-West y Himawari · cada 10 minutos. Los tonos fríos son topes de nubes altas y tormentas. Europa y África quedan sin cobertura.'},
 wind:{live:true,field:'wind',label:'Viento ahora',note:'Modelo Open-Meteo · velocidad a 10 m (colores) y hacia dónde sopla (flechas), grilla de 10°.'},
 pressure:{live:true,field:'pressure',label:'Presión ahora',note:'Modelo Open-Meteo · presión a nivel del mar. Las líneas blancas son isobaras cada 4 hPa; bajas = mal tiempo, altas = estable.'},
 truecolor:{id:'VIIRS_NOAA20_CorrectedReflectance_TrueColor',ext:'jpg',level:9,label:'Nubes y superficie (color real)',note:'VIIRS NOAA-20 · una pasada diaria. Las franjas oscuras son zonas sin pasada ese día.'},
 rain:{id:'IMERG_Precipitation_Rate',ext:'png',level:6,legend:'GPM_Precipitation_Rate_H.svg',label:'Lluvia',note:'GPM IMERG · tasa de precipitación estimada por satélite.'},
 air:{id:'AIRS_L2_Surface_Air_Temperature_Day',ext:'png',level:6,legend:'AIRS_Temperature_H.svg',label:'Temperatura del aire',note:'AIRS (Aqua) · aire cerca de la superficie, pasada diurna.'},
 land:{id:'MODIS_Terra_Land_Surface_Temp_Day',ext:'png',level:7,legend:'MODIS_Land_Surface_Temp_H.svg',label:'Temperatura del suelo',note:'MODIS Terra · superficie terrestre de día; sin dato bajo nubes.'},
 sea:{id:'GHRSST_L4_MUR_Sea_Surface_Temperature',ext:'png',level:7,legend:'GHRSST_Sea_Surface_Temperature_H.svg',label:'Temperatura del mar',note:'GHRSST MUR · mapa diario completo del océano.'},
 vapor:{id:'MODIS_Terra_Water_Vapor_5km_Day',ext:'png',level:6,legend:'MODIS_Water_Vapor_H.svg',label:'Vapor de agua',note:'MODIS Terra · humedad en la columna de aire.'},
 aerosol:{id:'MODIS_Combined_Value_Added_AOD',ext:'png',level:6,legend:'MODIS_Combined_Value_Added_AOD_H.svg',label:'Humo, polvo y aerosoles',note:'MODIS Terra + Aqua · espesor óptico de aerosoles.'},
 snow:{id:'MODIS_Terra_NDSI_Snow_Cover',ext:'png',level:8,legend:'MODIS_NDSI_Snow_Cover_H.svg',label:'Nieve',note:'MODIS Terra · cobertura de nieve; sin dato bajo nubes.'}
};
const DAY=86400000,MAX_DAYS_BACK=60;
const isoDay=time=>new Date(time).toISOString().slice(0,10);
const latestDay=()=>isoDay(Date.now()-DAY);
let enginePromise;
function loadEngine(){
 if(window.Cesium)return Promise.resolve(window.Cesium);
 if(enginePromise)return enginePromise;
 window.CESIUM_BASE_URL=new URL('./vendor/cesium/',import.meta.url).href;
 enginePromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=new URL('./vendor/cesium/Cesium.js',import.meta.url).href;
  script.onload=()=>window.Cesium?resolve(window.Cesium):reject(new Error('No se cargó el motor 3D.'));
  script.onerror=()=>reject(new Error('No se pudo cargar el motor 3D.'));document.head.appendChild(script);
 });
 return enginePromise;
}
export async function initWorldGlobe({onPointSelected,onOpenGoogleMaps,onOpenLink}={}){
 let viewer,handler,observer,city=null,marker=null,placeholder=null;
 const panel=$('world-panel'),dialog=$('world-dialog'),surface=$('globe-surface');
 const state=$('globe-state'),source=$('globe-source');
 const buttons=['globe-alerts','globe-argentina','globe-world','globe-city','globe-plus','globe-minus','globe-north','globe-expand','globe-google'];
 try{
  const C=await loadEngine();
  // The globe uses local assets and public NASA imagery, without Cesium ion services.
  C.Ion.defaultAccessToken='';
  const base=await C.TileMapServiceImageryProvider.fromUrl(new URL('./vendor/cesium/Assets/Textures/NaturalEarthII/',import.meta.url).href,{credit:'Natural Earth II'});
  viewer=new C.Viewer($('globe-canvas'),{
   baseLayer:new C.ImageryLayer(base),terrainProvider:new C.EllipsoidTerrainProvider(),
   animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,vrButton:false,
   shouldAnimate:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,scene3DOnly:true,showRenderLoopErrors:false,targetFrameRate:60,skyBox:false,
   creditContainer:$('globe-credits'),creditViewport:panel,useBrowserRecommendedResolution:true,
   contextOptions:{webgl:{alpha:true,antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:false}}
  });
  const scene=viewer.scene,camera=viewer.camera,controls=scene.screenSpaceCameraController;
  scene.backgroundColor=C.Color.fromCssColorString('#030806');
  scene.globe.enableLighting=false;
  // Lighter on integrated GPUs: no stars, sun, moon or fog; fewer and coarser tiles kept in video memory.
  if(scene.sun)scene.sun.show=false;if(scene.moon)scene.moon.show=false;scene.fog.enabled=false;
  scene.globe.tileCacheSize=60;scene.globe.maximumScreenSpaceError=3;scene.globe.preloadAncestors=false;
  controls.minimumZoomDistance=5000;controls.maximumZoomDistance=70000000;
  controls.enableRotate=true;controls.enableZoom=true;controls.enableTilt=true;controls.enableLook=true;
  const pointAtCenter=()=>{
   const pixel=new C.Cartesian2(scene.canvas.clientWidth/2,scene.canvas.clientHeight/2);
   const hit=camera.pickEllipsoid(pixel,scene.globe.ellipsoid);
   const cartographic=hit?C.Cartographic.fromCartesian(hit):camera.positionCartographic;
   return{lat:C.Math.toDegrees(cartographic.latitude),lon:C.Math.toDegrees(cartographic.longitude)};
  };
  const updateCoordinates=()=>{
   const point=pointAtCenter();
   $('globe-coordinates').textContent=`${Math.abs(point.lat).toFixed(2)}° ${point.lat<0?'S':'N'} · ${Math.abs(point.lon).toFixed(2)}° ${point.lon<0?'O':'E'}`;
   panel.dataset.latitude=point.lat.toFixed(5);panel.dataset.longitude=point.lon.toFixed(5);
  };
  const fly=(point,height=14000000,duration=.9)=>{
   if(!validPoint(point))return;
   framed=0;camera.cancelFlight();
   camera.flyTo({destination:C.Cartesian3.fromDegrees(point.lon,point.lat,height),orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0},duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:duration,complete:updateCoordinates});scene.requestRender();
  };
  // Height at which the whole globe fills `fill` of the view's smaller side (uses the camera's real FOV).
  const fitHeight=fill=>{
   const frustum=camera.frustum,aspect=surface.clientWidth/Math.max(1,surface.clientHeight);
   const tan=Math.tan(frustum.fov/2),half=Math.atan(aspect>=1?tan/aspect:tan*aspect);
   const radius=scene.globe.ellipsoid.maximumRadius,angle=Math.atan(fill*Math.tan(half));
   return radius/Math.sin(angle)-radius;
  };
  // While the view is a framed whole-globe view (not zoomed by hand), resizing re-frames it.
  let framed=.92,framedCenter=ARGENTINA;
  const frame=(center,fill)=>{fly(center,fitHeight(fill),.9);framed=fill;framedCenter=center;};
  const home=()=>{
   frame(ARGENTINA,.92);
  };
  home();
  camera.moveEnd.addEventListener(updateCoordinates);
  camera.changed.addEventListener(updateCoordinates);camera.percentageChanged=.02;
  let remoteFailed=false;
  const nasa=new C.WebMapServiceImageryProvider({
   url:'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',layers:'BlueMarble_ShadedRelief_Bathymetry',
   parameters:{service:'WMS',version:'1.1.1',styles:'',format:'image/jpeg',transparent:false},
   tilingScheme:new C.GeographicTilingScheme(),maximumLevel:8,enablePickFeatures:false,credit:'NASA GIBS · Blue Marble'
  });
  nasa.errorEvent.addEventListener(error=>{remoteFailed=true;error.retry=false;source.textContent='Alguna imagen NASA no pudo cargar. La base local sigue disponible.';});
  viewer.imageryLayers.addImageryProvider(nasa);
  let overlays=[],layerKey='',layerDate=latestDay(),layerFailed=false,layerRun=0;
  const layerSelect=$('globe-layer'),opacity=$('globe-opacity'),legend=$('globe-legend'),scaleBar=$('globe-scale');
  const arrows=new C.CustomDataSource('viento'),events=new C.CustomDataSource('alertas');
  viewer.dataSources.add(arrows);viewer.dataSources.add(events);
  const forecast=new C.CustomDataSource('pronostico-regional');
  viewer.dataSources.add(forecast);
  // Regional simulation (forecast-map.js): a field image and a wind-flow image draped over the
  // region. showForecast() sets the region, labels and city once per forecast hour; forecastFrame()
  // only swaps the two canvases, so animation frames stay cheap.
  let forecastImage=null,flowImage=null,forecastBounds='';
  const drape=(getImage,zIndex)=>forecast.entities.add({show:false,rectangle:{coordinates:C.Rectangle.fromDegrees(0,0,1,1),zIndex,material:new C.ImageMaterialProperty({image:new C.CallbackProperty(getImage,false),transparent:true})}});
  const forecastArea=drape(()=>forecastImage,1),flowArea=drape(()=>flowImage,2);
  const forecastExtras=new C.CustomDataSource('pronostico-detalle');
  viewer.dataSources.add(forecastExtras);
  const labelStyle={font:'12px Segoe UI',fillColor:C.Color.WHITE,outlineColor:C.Color.fromCssColorString('#06110a'),outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,disableDepthTestDistance:0};
  const forecastFrame=({image,flow})=>{
   // undefined keeps the current canvas; null removes it.
   if(image!==undefined){if(image)forecastImage=image;forecastArea.show=!!forecastImage&&image!==null&&!!forecastBounds;}
   if(flow!==undefined){if(flow)flowImage=flow;flowArea.show=!!flow&&!!forecastBounds;}
   scene.requestRender();
  };
  const showForecast=view=>{
   forecastExtras.entities.removeAll();
   if(view){
    const [west,south,east,north]=view.rectangle,wrap=lon=>((lon+180)%360+360)%360-180;
    const bounds=[wrap(west),Math.max(-90,south),wrap(east),Math.min(90,north)].map(v=>v.toFixed(4)).join(',');
    // Rebuilding a ground rectangle is slow and flickers, so only when the region moves.
    if(bounds!==forecastBounds){
     forecastBounds=bounds;
     const rectangle=C.Rectangle.fromDegrees(...bounds.split(',').map(Number));
     forecastArea.rectangle.coordinates=rectangle;flowArea.rectangle.coordinates=rectangle;
    }
    forecastExtras.entities.suspendEvents();
    for(const item of view.labels)forecastExtras.entities.add({position:C.Cartesian3.fromDegrees(item.lon,item.lat),label:{...labelStyle,text:item.text,distanceDisplayCondition:new C.DistanceDisplayCondition(0,4500000)}});
    for(const item of view.arrows||[])forecastExtras.entities.add({position:C.Cartesian3.fromDegrees(item.lon,item.lat),billboard:{image:arrowImage,scale:.55+Math.min(item.speed,80)/80*.55,rotation:-C.Math.toRadians((item.direction+180)%360),alignedAxis:C.Cartesian3.UNIT_Z,color:C.Color.WHITE.withAlpha(.85),disableDepthTestDistance:0,pixelOffset:new C.Cartesian2(0,14)}});
    forecastExtras.entities.add({position:C.Cartesian3.fromDegrees(view.center.lon,view.center.lat),point:{pixelSize:10,color:C.Color.fromCssColorString('#eaffef'),outlineColor:C.Color.fromCssColorString('#337b50'),outlineWidth:3,disableDepthTestDistance:Infinity},label:{...labelStyle,text:view.center.text,font:'600 13px Segoe UI',pixelOffset:new C.Cartesian2(0,-20),showBackground:true,backgroundColor:C.Color.fromCssColorString('#06110acc'),disableDepthTestDistance:Infinity}});
    forecastExtras.entities.resumeEvents();
   }else{forecastBounds='';forecastImage=flowImage=null;forecastArea.show=flowArea.show=false;}
   if(marker)marker.show=!view;
   scene.requestRender();
  };
  const arrowImage=(()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
   const g=canvas.getContext('2d');g.translate(16,16);g.beginPath();
   g.moveTo(0,-13);g.lineTo(7,-2);g.lineTo(2.2,-2);g.lineTo(2.2,13);g.lineTo(-2.2,13);g.lineTo(-2.2,-2);g.lineTo(-7,-2);g.closePath();
   g.fillStyle='#fff';g.strokeStyle='#0008';g.lineWidth=1.5;g.fill();g.stroke();return canvas;
  })();
  let fieldStatus='';
  const longDate=day=>new Date(`${day}T12:00:00Z`).toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const describe=()=>{
   const layer=LAYERS[layerKey];
   if(!layer){source.textContent=remoteFailed?'Alguna imagen NASA no pudo cargar. La base local sigue disponible.':'Mosaico mundial NASA Blue Marble · base local Natural Earth II';return;}
   if(layer.field){source.textContent=fieldStatus;return;}
   source.textContent=layerFailed?`Faltan imágenes de “${layer.label}” ${layer.live?'en este momento':'para esta fecha. Probá un día anterior'}.`:`NASA GIBS · ${layer.label} · ${layer.live?'última imagen':longDate(layerDate)}`;
  };
  const updateDateControls=()=>{
   const layer=LAYERS[layerKey],fixed=!layer||layer.live;
   $('globe-date').textContent=!layer?'—':layer.live?'Ahora':new Date(`${layerDate}T12:00:00Z`).toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
   $('globe-date-prev').disabled=fixed||layerDate<=isoDay(Date.now()-MAX_DAYS_BACK*DAY);
   $('globe-date-next').disabled=fixed||layerDate>=latestDay();
   opacity.disabled=!layer;
   $('globe-layer-note').textContent=layer?layer.note:'Elegí una capa para ver nubes, lluvia, viento, presión o temperaturas sobre el globo.';
   legend.hidden=!layer?.legend;
   if(layer?.legend){legend.src=`${GIBS}/legends/${layer.legend}`;legend.alt=`Escala de colores de ${layer.label}`;}
   scaleBar.hidden=!layer?.field;
   if(layer?.field){
    const scale=SCALES[layer.field];
    scaleBar.innerHTML=`<span>${scale.min}</span><i style="background:${legendGradient(layer.field)}"></i><span>${scale.max} ${scale.unit}</span>`;
   }
  };
  const clearLayer=()=>{
   overlays.forEach(item=>viewer.imageryLayers.remove(item,true));overlays=[];
   arrows.entities.removeAll();
  };
  const addOverlay=(provider,band)=>{
   const item=new C.ImageryLayer(provider,{alpha:Number(opacity.value)/100,rectangle:band?C.Rectangle.fromDegrees(band[0],-81.3,band[1],81.3):undefined});
   viewer.imageryLayers.add(item);overlays.push(item);
  };
  // Minimal imagery provider that draws the model field tile by tile (see fieldTile).
  const fieldProvider=(fields,kind)=>{
   const tilingScheme=new C.GeographicTilingScheme();
   return {
    tilingScheme,rectangle:tilingScheme.rectangle,tileWidth:256,tileHeight:256,minimumLevel:0,maximumLevel:10,
    tileDiscardPolicy:undefined,errorEvent:new C.Event(),credit:new C.Credit('Open-Meteo'),proxy:undefined,hasAlphaChannel:true,
    getTileCredits:()=>[],pickFeatures:()=>undefined,
    requestImage(x,y,level){
     const r=tilingScheme.tileXYToRectangle(x,y,level),deg=C.Math.toDegrees;
     return Promise.resolve(fieldTile(fields,kind,[deg(r.west),deg(r.south),deg(r.east),deg(r.north)]));
    }
   };
  };
  const showField=async(layer,run)=>{
   fieldStatus='Consultando el modelo de Open-Meteo…';describe();
   try{
    const fields=await loadFields();
    if(run!==layerRun)return;
    addOverlay(fieldProvider(fields,layer.field));
    if(layer.field==='wind'){
     // 10° arrows always; the in-between 5° ones only show when the camera is close.
     const near=new C.DistanceDisplayCondition(0,4500000);
     const arrowScale=new C.NearFarScalar(1500000,1.1,20000000,.55);
     arrows.entities.suspendEvents();
     windArrows(fields,5).forEach(point=>{
      const coarse=point.lat%10===0&&point.lon%10===0;
      arrows.entities.add({
       position:C.Cartesian3.fromDegrees(point.lon,point.lat),
       billboard:{image:arrowImage,scale:.6+Math.min(point.speed,80)/80*.5,scaleByDistance:arrowScale,rotation:-C.Math.toRadians((point.direction+180)%360),alignedAxis:C.Cartesian3.UNIT_Z,color:C.Color.WHITE.withAlpha(.9),disableDepthTestDistance:0,distanceDisplayCondition:coarse?undefined:near}
      });
     });
     arrows.entities.resumeEvents();
    }
    const time=fields.time?new Date(`${fields.time}Z`).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'';
    fieldStatus=`Open-Meteo · ${layer.label}${time?` · modelo de las ${time} (hora local)`:''}`;
   }catch(error){
    if(run!==layerRun)return;
    fieldStatus=error.message||'No se pudo consultar el modelo de viento y presión.';
   }
   describe();scene.requestRender();
  };
  const showLayer=()=>{
   const run=++layerRun;
   clearLayer();
   layerFailed=false;
   const layer=LAYERS[layerKey];
   if(layer?.field)showField(layer,run);
   else if(layer){
    for(const [id,level,band] of layer.parts||[[layer.id,layer.level]]){
     const provider=new C.UrlTemplateImageryProvider({
      url:`${GIBS}/wmts/epsg3857/best/${id}/default/${layer.live?'default':layerDate}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${layer.ext}`,
      maximumLevel:level,credit:`NASA GIBS · ${layer.label}`,enablePickFeatures:false
     });
     // Stitched satellites return empty tiles outside their disk; only a fully failed single layer is reported.
     provider.errorEvent.addEventListener(error=>{error.retry=false;if(!layer.parts&&!layerFailed){layerFailed=true;describe();}});
     addOverlay(provider,band);
    }
   }
   updateDateControls();describe();scene.requestRender();
  };
  const shiftDate=days=>{
   const next=isoDay(Date.parse(`${layerDate}T12:00:00Z`)+days*DAY);
   if(next>latestDay()||next<isoDay(Date.now()-MAX_DAYS_BACK*DAY))return;
   layerDate=next;showLayer();
  };
  const options=filter=>Object.entries(LAYERS).filter(([,layer])=>filter(layer)).map(([key,layer])=>`<option value="${key}">${layer.label}</option>`).join('');
  layerSelect.innerHTML=`<option value="">Solo relieve (Blue Marble)</option><optgroup label="Ahora">${options(layer=>layer.live)}</optgroup><optgroup label="Por día (elegí la fecha)">${options(layer=>!layer.live)}</optgroup>`;
  layerSelect.addEventListener('change',()=>{layerKey=layerSelect.value;showLayer();});
  $('globe-date-prev').addEventListener('click',()=>shiftDate(-1));
  $('globe-date-next').addEventListener('click',()=>shiftDate(1));
  opacity.addEventListener('input',()=>{overlays.forEach(item=>item.alpha=Number(opacity.value)/100);scene.requestRender();});
  updateDateControls();describe();
  scene.globe.tileLoadProgressEvent.addEventListener(remaining=>{scene.requestRender();if(remaining===0)describe();});
  state.hidden=true;panel.dataset.ready='true';
  buttons.forEach(id=>$(id).disabled=id==='globe-city');
  layerSelect.disabled=false;
  const setCity=location=>{
   if(!validPoint(location))return;city=location;$('globe-city').disabled=false;
   if(marker)viewer.entities.remove(marker);
   marker=viewer.entities.add({position:C.Cartesian3.fromDegrees(location.lon,location.lat),point:{pixelSize:9,color:C.Color.fromCssColorString('#eaffef'),outlineColor:C.Color.fromCssColorString('#337b50'),outlineWidth:3,disableDepthTestDistance:Infinity},name:location.nombre||'Ubicación elegida'});
   scene.requestRender();
  };
  $('globe-argentina').addEventListener('click',home);
  $('globe-world').addEventListener('click',()=>frame(pointAtCenter(),.7));
  $('globe-city').addEventListener('click',()=>{if(city)fly(city,2800000);});
  const zoom=closer=>{
   framed=0;
   const distance=Math.max(1000,camera.positionCartographic.height*(closer?.3:.45));
   if(closer)camera.zoomIn(distance);else camera.zoomOut(distance);
   updateCoordinates();scene.requestRender();
  };
  $('globe-plus').addEventListener('click',()=>zoom(true));$('globe-minus').addEventListener('click',()=>zoom(false));
  $('globe-north').addEventListener('click',()=>fly(pointAtCenter(),Math.max(5000,camera.positionCartographic.height)));
  $('globe-google').addEventListener('click',()=>onOpenGoogleMaps?.(pointAtCenter()));
  surface.addEventListener('keydown',event=>{
   if(event.target.closest('button'))return;
   const amount=C.Math.toRadians(8);
   if(event.key==='ArrowLeft')camera.rotateLeft(amount);
   else if(event.key==='ArrowRight')camera.rotateRight(amount);
   else if(event.key==='ArrowUp')camera.rotateUp(amount);
   else if(event.key==='ArrowDown')camera.rotateDown(amount);
   else if(event.key==='+'||event.key==='=')zoom(true);
   else if(event.key==='-')zoom(false);
   else if(event.key==='Home')home();
   else return;
   event.preventDefault();updateCoordinates();scene.requestRender();
  });
  viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  handler=new C.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction(click=>{
   const hit=camera.pickEllipsoid(click.position,scene.globe.ellipsoid);if(!hit)return;
   const position=C.Cartographic.fromCartesian(hit),lat=C.Math.toDegrees(position.latitude),lon=C.Math.toDegrees(position.longitude);
   const location={nombre:`Punto ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,provincia:'Ubicación elegida en el globo',pais:'',lat,lon};
   setCity(location);onPointSelected?.(location);
  },C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  const LEVEL_COLORS=['#7cc39a','#e8d36a','#f0a040','#e5534b'];
  const popup=$('globe-popup'),eventItems=new Map();
  const showEvent=item=>{
   popup.hidden=false;
   popup.innerHTML=`<button type="button" class="popup-close" aria-label="Cerrar">×</button><p class="popup-kind" style="color:${LEVEL_COLORS[item.level]}">${escapeHTML(item.kind)}</p><p class="popup-title">${escapeHTML(item.title)}</p><p class="popup-detail">${escapeHTML([item.detail,item.time&&new Date(item.time).toLocaleString('es-AR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})].filter(Boolean).join(' · '))}</p><p class="popup-source">${escapeHTML(item.source)}${item.url?' · <button type="button" class="popup-link">Ver fuente</button>':''}</p>`;
   popup.querySelector('.popup-close').addEventListener('click',()=>{popup.hidden=true;});
   popup.querySelector('.popup-link')?.addEventListener('click',()=>onOpenLink?.(item.url));
  };
  handler.setInputAction(click=>{
   const picked=scene.pick(click.position);
   const item=eventItems.get(picked?.id?.id);
   if(item)showEvent(item);else popup.hidden=true;
  },C.ScreenSpaceEventType.LEFT_CLICK);
  const setEvents=list=>{
   events.entities.suspendEvents();events.entities.removeAll();eventItems.clear();
   list.forEach((item,index)=>{if(!validPoint(item))return;const id=`alerta-${index}`;eventItems.set(id,item);events.entities.add({id,
    position:C.Cartesian3.fromDegrees(item.lon,item.lat),
    point:{pixelSize:7+item.level*2,color:C.Color.fromCssColorString(LEVEL_COLORS[item.level]),outlineColor:C.Color.fromCssColorString('#0b120e'),outlineWidth:2,disableDepthTestDistance:0},
   });});
   events.entities.resumeEvents();scene.requestRender();
  };
  $('globe-alerts').addEventListener('click',()=>{
   events.show=!events.show;popup.hidden=true;
   $('globe-alerts').setAttribute('aria-pressed',String(events.show));$('globe-alerts').classList.toggle('green',events.show);scene.requestRender();
  });
  const expand=()=>{
   if(dialog.open){dialog.close();return;}
   placeholder=document.createComment('globe-position');panel.before(placeholder);dialog.appendChild(panel);dialog.showModal();
   $('globe-expand').innerHTML=icon('close');$('globe-expand').setAttribute('aria-label','Reducir globo');viewer.resize();scene.requestRender();
  };
  $('globe-expand').addEventListener('click',expand);
  dialog.addEventListener('close',()=>{
   if(placeholder){placeholder.replaceWith(panel);placeholder=null;}
   $('globe-expand').innerHTML=icon('expand');$('globe-expand').setAttribute('aria-label','Ampliar globo');viewer.resize();scene.requestRender();
  });
  ['pointerdown','wheel'].forEach(type=>scene.canvas.addEventListener(type,()=>{framed=0;},{passive:true}));
  observer=new ResizeObserver(()=>{
   if(viewer.isDestroyed())return;
   viewer.resize();
   if(framed){camera.cancelFlight();camera.setView({destination:C.Cartesian3.fromDegrees(framedCenter.lon,framedCenter.lat,fitHeight(framed))});updateCoordinates();}
   scene.requestRender();
  });observer.observe(surface);
  scene.renderError.addEventListener((_,error)=>{console.error('Render 3D:',error);source.textContent='El renderizado 3D se interrumpió. Cerrá y volvé a abrir la app para recuperarlo.';});
  // The render loop only runs while the globe is on screen and the window is visible.
  let globeVisible=true;
  const syncRenderLoop=()=>{
   if(viewer.isDestroyed())return;
   const active=globeVisible&&!document.hidden;
   if(viewer.useDefaultRenderLoop!==active)viewer.useDefaultRenderLoop=active;
   if(active){viewer.resize();scene.requestRender();}
  };
  const visibility=new IntersectionObserver(([entry])=>{globeVisible=entry.isIntersecting||dialog.open;syncRenderLoop();});visibility.observe(surface);
  document.addEventListener('visibilitychange',syncRenderLoop);
  window.addEventListener('beforeunload',()=>{observer?.disconnect();visibility.disconnect();handler?.destroy();if(!viewer.isDestroyed())viewer.destroy();},{once:true});
  return {setCity,setEvents,showForecast,forecastFrame,flyToCity(location){if(validPoint(location)){setCity(location);fly(location,2800000);}},
   showEvent(item){if(!validPoint(item))return;if(!events.show)$('globe-alerts').click();fly(item,3500000);showEvent(item);panel.scrollIntoView({behavior:'smooth',block:'start'});},
   getView:pointAtCenter};
 }catch(error){
  console.error('Globo 3D:',error);
  if(viewer&&!viewer.isDestroyed())viewer.destroy();
  buttons.forEach(id=>$(id).disabled=true);$('globe-layer').disabled=true;panel.dataset.ready='false';
  state.hidden=false;state.textContent='No se pudo iniciar el globo 3D. El pronóstico y las imágenes de NOAA siguen disponibles.';
  source.textContent='La vista 3D necesita aceleración gráfica compatible.';
  return null;
 }
}
