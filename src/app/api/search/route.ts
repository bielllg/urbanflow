import type {FeatureCollection} from 'geojson';
import {snapshot} from '@/lib/data';
import type {Transit} from '@/lib/types';
import {searchAddresses} from '@/lib/addresses';
import {invalidQuery,queryTooLong} from '@/lib/http';

const empty:FeatureCollection={type:'FeatureCollection',features:[]};
const normalize=(text:string)=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
type Result={id:string;name:string;kind:string;lat?:number;lng?:number;route?:string};

export async function GET(request:Request) {
  if(queryTooLong(request)) return invalidQuery();
  const term=normalize(new URL(request.url).searchParams.get('q')?.trim().slice(0,100) ?? '');
  if(term.length<2) return Response.json([]);
  const [bairros,streets,transit,addresses]=await Promise.all([
    snapshot('neighborhoods',empty),snapshot('streets',empty),snapshot<Transit>('transit',{routes:[],stops:[]}),
    searchAddresses(term),
  ]);
  const hits:Result[]=[];
  function add(hit:Result) { if(normalize(hit.name).includes(term)) hits.push(hit); }
  for (const row of bairros.features) {
    const p=row.properties;
    if(p?.name) add({id:String(p.id),name:String(p.name),kind:'Bairro'});
  }
  for(const row of streets.features) {
    const p=row.properties;
    if(p?.name && hits.length<100) add({id:String(p.id),name:String(p.name),kind:'Via'});
  }
  for(const route of transit.routes) add({id:route.id,name:route.shortName+' · '+route.name,kind:'Linha programada',route:route.id});
  for(const stop of transit.stops) add({id:'stop-'+stop.id,name:stop.name,kind:'Ponto de ônibus',lat:stop.lat,lng:stop.lng});
  return Response.json([...addresses,...hits.sort((a,b)=>Number(normalize(b.name).startsWith(term))-Number(normalize(a.name).startsWith(term)))].slice(0,12));
}
