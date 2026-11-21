import 'server-only';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Feature, FeatureCollection, LineString, Point, Position} from 'geojson';
import {addDays, byAccidentHour, byTraffic, dateCoverage, groupCount, localDay, measuredSpeed, overlaps, previousPeriod, readPeriod, week, weekday, within, withinSortedDates} from './metrics';
import type {Accident, DashboardData, MapData, Operations, Source, Traffic, Transit} from './types';
import {databaseSnapshot,databaseStreet} from './postgis';
import {addressSource,findAddress} from './addresses';

const emptyMap: FeatureCollection = {type:'FeatureCollection',features:[]};
const snapshots = new Map<string,{mtime:number; value:unknown}>();
const pendingSnapshots = new Map<string,Promise<unknown>>();
const sourceDefaults: Source[] = [
  {id:'accidents',name:'Sinistros de trânsito com vítima',url:'https://dados.pbh.gov.br/dataset/ocorrencia-sinistro-transito-com-vitima',status:'unavailable'},
  {id:'transit',name:'GTFS · SUMOB',url:'https://dados.pbh.gov.br/dataset/gtfs',status:'unavailable'},
  {id:'traffic',name:'Velocidade nos corredores',url:'https://dados.pbh.gov.br/dataset/velocidade-nos-corredores',status:'unavailable'},
];
const gpsUrl = 'https://temporeal.pbh.gov.br/?param=D';

export async function snapshot<T>(name:string, fallback:T):Promise<T> {
  const fromDatabase=await databaseSnapshot<T>(name);
  if(fromDatabase!==undefined)return fromDatabase;
  const path = join(process.env.URBANFLOW_DATA_DIR ?? join(process.cwd(),'data'),name+'.json');
  try {
    const info = await stat(path);
    const existing = snapshots.get(name);
    if (existing?.mtime === info.mtimeMs) return existing.value as T;
    const key=path+'|'+info.mtimeMs;
    const pending=pendingSnapshots.get(key);
    if(pending) return await pending as T;
    const reading=readFile(path,'utf8').then(content=>{
      const value=JSON.parse(content) as T;
      snapshots.set(name,{mtime:info.mtimeMs,value});
      return value;
    }).finally(()=>pendingSnapshots.delete(key));
    pendingSnapshots.set(key,reading);
    return await reading;
  } catch {
    return (snapshots.get(name)?.value as T | undefined) ?? fallback;
  }
}

async function getData() {
  const [accidents,study,radar,transit,neighborhoods,sources] = await Promise.all([
    snapshot<Accident[]>('accidents',[]), snapshot<Traffic[]>('traffic',[]),snapshot<Traffic[]>('radar',[]),
    snapshot<Transit>('transit',{routes:[],stops:[]}),snapshot('neighborhoods',emptyMap),snapshot<Source[]>('sources',sourceDefaults),
  ]);
  const runtimeSources:Source[]=[
    {id:'gps',name:'Posição dos ônibus · PBH',url:'https://dados.pbh.gov.br/dataset/tempo_real_onibus_-_coordenada',status:lastGps?.observedAt && Date.now()-Date.parse(lastGps.observedAt)<120000?'available':'unavailable',observedAt:lastGps?.observedAt??undefined,detail:'Camada consultada sob demanda no mapa. O status ao vivo expira 2 minutos após a última posição recebida.'},
    {id:'gtfs-rt',name:'Atualizações de viagem e alertas · SUMOB',url:'https://dados.pbh.gov.br/dataset/gtfs-rt',status:'unavailable',detail:process.env.SUMOB_GTFS_RT_ALERTS_URL||process.env.SUMOB_GTFS_RT_UPDATES_URL?'Consulte Transporte público para verificar a disponibilidade das fontes configuradas.':'Configure os feeds HTTPS autorizados para consultar alertas e atrasos. O GPS municipal é consultado em uma camada independente.'},
    {id:'addresses',name:'Cadastro Técnico Municipal · PBH',url:addressSource,status:'available',observedAt:'2026-05-04',license:'Creative Commons Attribution',detail:'Endereços numerados consultados sob demanda no portal de dados da PBH.'},
    {id:'tomtom',name:'Fluxo rodoviário por ponto · TomTom',url:'https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/flow-segment-data',status:'unavailable',detail:process.env.TOMTOM_API_KEY?'Chave configurada. A disponibilidade é confirmada para cada consulta de trecho.':'Chave autorizada não configurada. Medições públicas históricas seguem disponíveis.'},
  ];
  return {accidents,traffic:[...study,...radar],transit,neighborhoods,sources:[...sources.filter(s=>!runtimeSources.some(r=>r.id===s.id)),...runtimeSources]};
}

function publicRoute({shape, stops, calendar, trips, hours: referenceHours, ...route}: Transit['routes'][number], period:{start:string;end:string}|null, compact:boolean):Transit['routes'][number] {
  void shape;
  void trips;
  void referenceHours;
  const {id,name,shortName,color}=route;
  const summary={...(compact?{id,name,shortName,color}:route),stopCount:stops?.length};
  if (!calendar || !period) return summary;
  const schedule=Object.entries(calendar).filter(([day])=>day>=period.start && day<=period.end);
  const hours=Array.from({length:24},(_,hour)=>schedule.reduce((sum,[,values])=>sum+(values[hour]??0),0));
  return {...summary,trips:hours.reduce((sum,value)=>sum+value,0),hours};
}

type AccidentIndex = {
  rows:Accident[];
  byRegion:Map<string,Accident[]>;
  regionOptions:string[];
  coverage:DashboardData['coverage'];
};
const accidentIndexes=new WeakMap<Accident[],AccidentIndex>();

function indexAccidents(accidents:Accident[]):AccidentIndex {
  const existing=accidentIndexes.get(accidents);
  if(existing)return existing;
  const rows=accidents.some((row,index)=>index>0&&row.date<accidents[index-1].date)
    ? accidents.slice().sort((a,b)=>a.date.localeCompare(b.date))
    : accidents;
  const byRegion=new Map<string,Accident[]>();
  const normalized=new Map<string,string>();
  for(const row of rows){
    let key=normalized.get(row.region);
    if(key===undefined){
      key=row.region.toLocaleLowerCase('pt-BR');
      normalized.set(row.region,key);
    }
    const group=byRegion.get(key);
    if(group)group.push(row);
    else byRegion.set(key,[row]);
  }
  const index={rows,byRegion,coverage:dateCoverage(rows),regionOptions:[...normalized.keys()].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR'))};
  accidentIndexes.set(accidents,index);
  return index;
}

export async function dashboard(query:URLSearchParams, {compact=false}={}): Promise<DashboardData> {
  const {accidents,traffic,transit,neighborhoods,sources} = await getData();
  const accidentIndex=indexAccidents(accidents);
  const coverage = accidentIndex.coverage, trafficCoverage = dateCoverage(traffic);
  const view=query.get('view');
  const today=localDay();
  const transitValidity = transit.scheduleStart && transit.scheduleEnd ? {start:transit.scheduleStart,end:transit.scheduleEnd} : null;
  const transitScheduleStatus= !transitValidity||today<transitValidity.start?'unavailable':
    today>transitValidity.end?'expired':addDays(today,7)>=transitValidity.end?'expiring':'current';
  const transitDay=transitValidity && today>=transitValidity.start && today<=transitValidity.end ? today : transit.scheduleDate ?? today;
  const end = view === 'transito' ? trafficCoverage?.end ?? coverage?.end ?? localDay() : view==='transporte-publico'?transitDay:coverage?.end ?? trafficCoverage?.end ?? localDay();
  const period = readPeriod(query,{start:view==='transporte-publico'?end:addDays(end,-29),end});
  const area = query.get('region')?.trim().toLocaleLowerCase('pt-BR');
  const areaRows = area ? accidentIndex.byRegion.get(area)??[] : accidentIndex.rows;
  const rows = withinSortedDates(areaRows,period);
  const regionalTraffic=area ? traffic.filter(row=>row.region.toLocaleLowerCase('pt-BR')===area) : traffic;
  const readings = within(regionalTraffic,period);
  const allVolumes = readings.flatMap(row=>typeof row.volume === 'number' ? [row.volume] : []);
  const mode = allVolumes.length ? 'volume' : 'speed';
  const measuredMonths=[...new Set(readings.map(row=>row.date.slice(0,7)))].sort();
  const monthOf=(row:Traffic)=>row.date.slice(0,7);
  const countByRegion = groupCount(rows,row=>row.region);
  const populationByRegion = new Map<string,number>();
  for (const batch of neighborhoods.features) {
    const region = batch.properties?.region;
    const population = batch.properties?.population;
    if (region && typeof population==='number' && population>0) {
      const key = String(region).toLocaleLowerCase('pt-BR');
      populationByRegion.set(key,(populationByRegion.get(key) ?? 0)+population);
    }
  }
  const previous = previousPeriod(period);
  const fullWindow = (window:typeof period)=>coverage && window.start>=coverage.start && window.end<=coverage.end;
  const previousAccidents = fullWindow(period) && fullWindow(previous) ? withinSortedDates(areaRows,previous).length : null;
  const transitPeriod=view==='transporte-publico'?period:{start:transitDay,end:transitDay};
  const supportedSchedule=transitValidity && transitPeriod.start>=transitValidity.start && transitPeriod.end<=transitValidity.end ? transitPeriod : null;
  const routes=transit.routes.map(route=>publicRoute(route,supportedSchedule,compact));
  const operations=view==='transporte-publico'?await snapshot<Operations|null>('mco',null):null;
  const comparisonPeriod = query.has('compareStart') && query.has('compareEnd')
    ? readPeriod(new URLSearchParams({start:query.get('compareStart')!,end:query.get('compareEnd')!}),previous)
    : previous;
  const accidentWeekdays=overlaps(period,coverage)
    ? new Map(groupCount(rows,row=>weekday(row.date)).map(({label,value})=>[label,value]))
    : null;
  return {
    period,coverage,trafficCoverage,sources,
    totals:{accidents:rows.length,previousAccidents,trafficCount:readings.length,averageSpeed:measuredSpeed(readings),
      volume:allVolumes.length ? allVolumes.reduce((sum,v)=>sum+v,0):null,routes:transit.routes.length,stops:transit.stops.length,
      plannedTrips:routes.some(route=>Number.isFinite(route.trips)) ? routes.reduce((n,r)=>n+(r.trips ?? 0),0):null},
    accidentHours:byAccidentHour(rows),
    accidentMonths:groupCount(rows,row=>row.date.slice(0,7)).sort((a,b)=>a.label.localeCompare(b.label)),
    accidentTypes:groupCount(rows,row=>row.type).sort((a,b)=>(b.value ?? 0)-(a.value ?? 0)),
    accidentWeekdays:week.map(label=>({label,value:accidentWeekdays ? accidentWeekdays.get(label)??0 : null})),
    trafficHours:byTraffic(readings,Array.from({length:24},(_,i)=>String(i).padStart(2,'0')+'h'),row=>row.hour!==null ? String(row.hour).padStart(2,'0')+'h':null,mode),
    trafficRoads:byTraffic(readings,[...new Set(readings.map(row=>row.road))],row=>row.road,mode).sort((a,b)=> mode==='speed' ? (a.value??Infinity)-(b.value??Infinity) : (b.value??0)-(a.value??0)),
    trafficWeekdays:byTraffic(readings,week,row=>weekday(row.date),mode),
    trafficVolumeMonths:byTraffic(readings,measuredMonths,monthOf,'volume'),
    trafficSpeedMonths:byTraffic(readings,measuredMonths,monthOf,'speed'),
    trafficRegions:[...new Set(readings.map(row=>row.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    regionOptions:accidentIndex.regionOptions,
    regions:countByRegion.filter(({label})=>!!label).map(({label,value})=>{
      const population = populationByRegion.get(label.toLocaleLowerCase('pt-BR')) ?? null;
      return {name:label,accidents:value??0,population,rate:population ? (value??0)*100000/population:null};
    }).sort((a,b)=>b.accidents-a.accidents),
    accidents:rows.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.hour??-1)-(a.hour??-1)).slice(0,3),
    routes:compact&&view!=='transporte-publico'?[]:routes,transitValidity,transitScheduleStatus,operations,plannedPeriod:supportedSchedule,
    unmappedAccidents:rows.filter(row=>row.lat===null || row.lng===null).length,
    comparison: {period:comparisonPeriod,accidents:withinSortedDates(areaRows,comparisonPeriod).length,trafficCount:within(regionalTraffic,comparisonPeriod).length},
  };
}

type GpsRecord = {EV:number|string;HR:number|string;LT:number|string;LG:number|string;NV:number|string;NL:number|string;VL?:number|string};
type GpsSnapshot = {fetched:number; features:Feature[]; observedAt:string|null};
let lastGps: GpsSnapshot | undefined;
let gpsRequest: Promise<GpsSnapshot> | undefined;
let lastGpsAttempt = 0;

function decodeGpsTime(value:unknown) {
  const match = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(value));
  if (!match) return null;
  const [,y,m,d,h,minute,s] = match;
  const time = new Date(y+'-'+m+'-'+d+'T'+h+':'+minute+':'+s+'-03:00');
  return Number.isFinite(time.valueOf()) ? time.toISOString() : null;
}

function point(id:string,kind:string,name:string,lng:number,lat:number,extra:Record<string,unknown>={}): Feature<Point> {
  return {type:'Feature',id,geometry:{type:'Point',coordinates:[lng,lat]},properties:{id,kind,name,...extra}};
}

async function liveVehicles():Promise<GpsSnapshot> {
  const fallback = {fetched:0,features:[],observedAt:null};
  if (gpsRequest) return gpsRequest;
  if (Date.now() - lastGpsAttempt < 20_000) return lastGps ?? fallback;
  lastGpsAttempt = Date.now();
  gpsRequest = (async()=>{
    try {
      const response = await fetch(gpsUrl,{cache:'no-store',signal:AbortSignal.timeout(8_000),headers:{'User-Agent':'UrbanFlow/1.0 (mobilidade urbana)'}});
      if (!response.ok) throw new Error('GPS HTTP '+response.status);
      const rows:unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Resposta do GPS em formato inesperado');
      const lineMap = await snapshot<Record<string,string>>('vehicle-lines',{});
      const vehicles = new Map<string,{time:string;feature:Feature}>();
      for (const row of rows as GpsRecord[]) {
        const lat=Number(row.LT),lng=Number(row.LG);
        if (+row.EV!==105 || !row.NV || lat < -20.30 || lat > -19.55 || lng < -44.30 || lng > -43.65 || !Number.isFinite(lat+lng)) continue;
        const time=decodeGpsTime(row.HR);
        const id='vehicle-'+row.NV;
        if (!time || Date.parse(time) > Date.now()+60_000 || (vehicles.get(id)?.time ?? '')>=time) continue;
        const line=lineMap[String(row.NL)] ?? null;
        vehicles.set(id,{time,feature:point(id,'transit',line ? 'Ônibus · '+line : 'Ônibus '+row.NV,lng,lat,{observedAt:time,value:Number(row.VL),line,vehicle:String(row.NV)})});
      }
      const observedAt = [...vehicles.values()].reduce<string|null>((latest,row)=>!latest || row.time>latest ? row.time:latest,null);
      if (!observedAt) throw new Error('Feed sem posições utilizáveis');
      lastGps={fetched:Date.now(),features:[...vehicles.values()].map(row=>row.feature),observedAt};
      return lastGps;
    } catch {
      return lastGps ?? fallback;
    }
  })().finally(()=>{gpsRequest=undefined;});
  return gpsRequest;
}

const neighborhoodBounds=new WeakMap<Feature,number[]>();
function boundsOf(feature:Feature){
  const existing=neighborhoodBounds.get(feature);
  if(existing) return existing;
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  const geometry=feature.geometry;
  const rings=geometry.type==='Polygon'?geometry.coordinates:geometry.type==='MultiPolygon'?geometry.coordinates.flat():[];
  for(const ring of rings) for(const [lng,lat] of ring as Position[]){
    bounds[0]=Math.min(lng,bounds[0]);bounds[1]=Math.min(lat,bounds[1]);
    bounds[2]=Math.max(lng,bounds[2]);bounds[3]=Math.max(lat,bounds[3]);
  }
  neighborhoodBounds.set(feature,bounds);
  return bounds;
}

export async function mapData(query:URLSearchParams,{exporting=false}={}):Promise<MapData> {
  const layers=new Set((query.get('layers') ?? 'neighborhood,accident,stop,traffic,route,street').split(','));
  const includeAccidents=layers.has('accident')||layers.has('heat');
  const [accidents,study,radar,neighborhoods,transit]=await Promise.all([
    includeAccidents||layers.has('traffic')?snapshot<Accident[]>('accidents',[]):[],
    layers.has('traffic')?snapshot<Traffic[]>('traffic',[]):[],
    layers.has('traffic')?snapshot<Traffic[]>('radar',[]):[],
    layers.has('neighborhood')?snapshot('neighborhoods',emptyMap):emptyMap,
    layers.has('stop')||layers.has('route')||query.has('route')?snapshot<Transit>('transit',{routes:[],stops:[]}):{routes:[],stops:[]} as Transit,
  ]);
  const traffic=[...study,...radar];
  const accidentIndex=indexAccidents(accidents);
  const end=accidentIndex.coverage?.end ?? localDay();
  const period=readPeriod(query,{start:addDays(end,-29),end});
  const area=query.get('region')?.toLocaleLowerCase('pt-BR');
  const route=query.get('route');
  const selectedFeature=query.get('selected');
  const box=query.get('bbox')?.split(',').map(Number);
  const validBox=box?.length===4 && box.every(Number.isFinite) && box[0]<box[2] && box[1]<box[3] && box[0]>=-180 && box[2]<=180 && box[1]>=-90 && box[3]<=90;
  const visible=(lng:number,lat:number,id:string)=>!validBox||selectedFeature===id||
    (lng>=box![0]&&lat>=box![1]&&lng<=box![2]&&lat<=box![3]);
  const type=query.get('incidentType'), fatal=query.get('fatal');
  const features:Feature[]=[];
  let omittedAccidents=0;
  if(selectedFeature?.startsWith('address-')){
    const address=await findAddress(selectedFeature);
    if(address)features.push(address);
  }
  if (layers.has('neighborhood')) {
    for(const feature of neighborhoods.features){
      if(validBox&&String(feature.properties?.id)!==selectedFeature){
        const [west,south,east,north]=boundsOf(feature);
        if(west>box![2]||east<box![0]||north<box![1]||south>box![3]) continue;
      }
      features.push({...feature,properties:{...feature.properties,kind:'neighborhood'}});
    }
  }
  if(layers.has('street')) {
    const selected=query.get('street');
    if(selected){
      const street=await databaseStreet(selected) ?? (await snapshot('streets',emptyMap)).features.find(feature=>String(feature.properties?.id)===selected);
      if(street)features.push({...street,properties:{...street.properties,kind:'street'}});
    }
  }
  if(includeAccidents){
    const areaRows=area ? accidentIndex.byRegion.get(area)??[] : accidentIndex.rows;
    const rows=withinSortedDates(areaRows,period);
    let shown=0;
    for(let index=rows.length-1;index>=0;index--){
      const a=rows[index];
      if(a.lat===null||a.lng===null || (type && a.type!==type) || (fatal==='true' && a.fatal!==true) || (fatal==='false' && a.fatal!==false)) continue;
      const id='accident-'+a.id;
      if(!visible(a.lng,a.lat,id)) continue;
      if(!exporting&&shown>=8000&&id!==selectedFeature){omittedAccidents++;continue;}
      features.push(point(id,'accident',a.type || 'Sinistro com vítima',a.lng,a.lat,{date:a.date,hour:a.hour,region:a.region,fatal:a.fatal,neighborhood:a.neighborhood}));
      shown++;
    }
  }
  if(layers.has('traffic')){
    for(const t of within(traffic,period)){
      if(typeof t.lat!=='number' || typeof t.lng!=='number' || (area && t.region.toLocaleLowerCase('pt-BR')!==area)) continue;
      const id='traffic-'+t.id;
      if(visible(t.lng,t.lat,id))features.push(point(id,'traffic',t.road,t.lng,t.lat,{date:t.date,hour:t.hour,value:t.speed??t.volume,unit:t.speed!==undefined?'km/h':'veículos',region:t.region}));
    }
  }
  const active=transit.routes.find(r=>r.id===route);
  if(layers.has('stop')){
    const stopIds=active?.stops?.length ? new Set(active.stops) : null;
    for(const s of transit.stops){
      const id='stop-'+s.id;
      if((!stopIds || stopIds.has(s.id)) && visible(s.lng,s.lat,id))features.push(point(id,'stop',s.name,s.lng,s.lat));
    }
  }
  if(layers.has('route') && active?.shape && active.shape.length>=2){
    const feature:Feature<LineString>={type:'Feature',id:active.id,geometry:{type:'LineString',coordinates:active.shape},properties:{kind:'route',id:active.id,name:active.shortName+' · '+active.name,color:active.color}};
    features.push(feature);
  }
  const gps = layers.has('transit') && query.get('mode')!=='historical' ? await liveVehicles():null;
  const observedAt=gps?.observedAt ?? null;
  const fresh=!!observedAt && Date.now()-Date.parse(observedAt)<120_000;
  if(gps){
    for(const f of gps.features){
      if(f.geometry.type!=='Point'||(active&&f.properties?.line!==active.shortName)||(fresh&&Date.now()-Date.parse(f.properties?.observedAt)>=300_000))continue;
      const [lng,lat]=f.geometry.coordinates;
      if(visible(lng,lat,String(f.id)))features.push(f);
    }
  }
  return {collection:{type:'FeatureCollection',features},observedAt,fresh,status:fresh?'current':observedAt?'stale':'unavailable',...(omittedAccidents?{omittedAccidents}:{})};
}

export async function exportRows(query:URLSearchParams) {
  const data=await getData();
  const range=await dashboard(query);
  const region=query.get('region')?.toLocaleLowerCase('pt-BR');
  const all: Array<Traffic|Accident>=query.get('dataset')==='transito' ? data.traffic : data.accidents;
  const records=within(all,range.period).filter(row=>!region || row.region.toLocaleLowerCase('pt-BR')===region);
  return {range,records};
}

export async function pagedRecords(query:URLSearchParams){
  const {accidents,traffic}=await getData();
  const isTraffic=query.get('dataset')==='transito';
  const accidentIndex=isTraffic?null:indexAccidents(accidents);
  const end=(accidentIndex?accidentIndex.coverage:dateCoverage(traffic))?.end??localDay();
  const period=readPeriod(query,{start:addDays(end,-29),end});
  const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('pt-BR');
  const term=normalize(query.get('q')?.slice(0,100).trim()??'');
  const region=normalize(query.get('region')??'');
  const type=query.get('type');
  const fatal=query.get('fatal');
  const locate=query.get('geocoded')==='1';
  const area=normalize(query.get('area')??'');
  const candidates: Array<Accident|Traffic>=accidentIndex?withinSortedDates(accidentIndex.rows,period):within(traffic,period);
  const rows=candidates.filter(row=>{
    if(area && normalize(row.region)!==area) return false;
    if(region && normalize(row.region)!==region) return false;
    if(locate&&(row.lat==null||row.lng==null))return false;
    if('road' in row) return !term||normalize([row.id,row.road,row.region,row.date].join(' ')).includes(term);
    if(type && row.type!==type)return false;
    if(fatal==='unknown' && row.fatal!==null)return false;
    if((fatal==='true'||fatal==='false') && row.fatal!==(fatal==='true'))return false;
    return !term||normalize([row.id,row.type,row.region,row.neighborhood,row.date].join(' ')).includes(term);
  });
  const sort=query.get('sort') ?? 'date';
  const direction=query.get('dir')==='asc'?1:-1;
  function value(row:Accident|Traffic){
    if(sort==='geocoded')return Number(row.lat!=null&&row.lng!=null);
    if(sort==='fatal')return 'fatal' in row && row.fatal!=null ? Number(row.fatal):null;
    if(sort==='type')return 'type' in row?row.type:null;
    if(sort==='road'||sort==='speed'||sort==='volume')return 'road' in row?row[sort]:null;
    if(sort==='region'||sort==='hour')return row[sort];
    return row.date;
  }
  rows.sort((a,b)=>{
    const left=value(a),right=value(b);
    if(left==null)return right==null?0:1;
    if(right==null)return -1;
    return direction*(typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right),'pt-BR',{numeric:true}));
  });
  const pageSize=15;
  const page=Math.min(Math.max(1,Math.ceil(rows.length/pageSize)),Math.max(1,Math.trunc(Number(query.get('page')))||1));
  return {rows:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page};
}
