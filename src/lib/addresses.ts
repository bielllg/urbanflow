import 'server-only';
import proj4 from 'proj4';
import type {Feature, Point} from 'geojson';

const endpoint='https://dados.pbh.gov.br/api/3/action/datastore_search';
const resource='eda480b1-1050-46a9-a6b7-53b5800a7aba';
export const addressSource='https://dados.pbh.gov.br/dataset/endereco-cadastro-tecnico-municipal/resource/'+resource;
const project=proj4('+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs','EPSG:4326');
const cache=new Map<string,{expires:number;features:Feature<Point>[]}>();
const fields=['IDEND','DESC_TIPO_LOGRADOURO','NOME_LOGRADOURO','NUMERO_IMOVEL','LETRA_IMOVEL','NOME_BAIRRO_POPULAR','NOME_REGIONAL','GEOMETRIA'] as const;
type Row=Record<typeof fields[number],string|null>;
let rate={until:0,count:0};

function feature(row:Row):Feature<Point>|null{
  const point=/^POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)$/i.exec(row.GEOMETRIA??'');
  if(!point || !row.IDEND || !row.NOME_LOGRADOURO || !row.NUMERO_IMOVEL)return null;
  const [lng,lat]=project.forward([Number(point[1]),Number(point[2])]);
  if(!Number.isFinite(lat+lng)||lng < -44.15||lng > -43.75||lat < -20.12||lat > -19.68)return null;
  const id='address-'+row.IDEND;
  const street=[row.DESC_TIPO_LOGRADOURO,row.NOME_LOGRADOURO].filter(Boolean).join(' ');
  const name=street+', '+row.NUMERO_IMOVEL+(row.LETRA_IMOVEL??'');
  return {type:'Feature',id,geometry:{type:'Point',coordinates:[lng,lat]},properties:{id,kind:'address',name,source:'Cadastro Técnico Municipal · PBH',neighborhood:row.NOME_BAIRRO_POPULAR,region:row.NOME_REGIONAL}};
}

async function lookup(filters:Record<string,string>,street?:string){
  const params=new URLSearchParams({resource_id:resource,limit:'8',fields:fields.join(','),filters:JSON.stringify(filters)});
  if(street)params.set('q',JSON.stringify({NOME_LOGRADOURO:street}));
  const key=params.toString(),now=Date.now();
  const saved=cache.get(key);
  if(saved&&saved.expires>now)return saved.features;
  if(now>=rate.until)rate={until:now+60000,count:0};
  if(rate.count>=60)return [];
  rate.count++;
  try{
    const response=await fetch(endpoint+'?'+key,{signal:AbortSignal.timeout(4500),cache:'no-store'});
    if(!response.ok)return [];
    const payload=await response.json() as {success?:boolean;result?:{records?:Row[]}};
    if(!payload.success || !Array.isArray(payload.result?.records))return [];
    const features=payload.result.records.map(feature).filter((item):item is Feature<Point>=>item!==null);
    if(cache.size>=150)cache.delete(cache.keys().next().value!);
    cache.set(key,{expires:now+900000,features});
    return features;
  }catch{return [];}
}

export async function searchAddresses(term:string){
  const match=/^(.+?)\s*[, ]\s*(\d{1,6})([a-z])?$/i.exec(term);
  if(!match)return [];
  const street=match[1].replace(/^(?:av(?:enida)?\.?|r(?:ua)?\.?|pca\.?|praca|alameda|travessa|rodovia)\s+/i,'').trim();
  if(street.length<3||!/[a-z]/i.test(street))return [];
  const features=await lookup({NUMERO_IMOVEL:match[2],...(match[3]?{LETRA_IMOVEL:match[3].toUpperCase()}: {})},street);
  return features.map(item=>({id:String(item.id),name:String(item.properties?.name),kind:'Endereço',lng:item.geometry.coordinates[0],lat:item.geometry.coordinates[1]}));
}

export async function findAddress(id:string){
  const code=/^address-(\d{1,20})$/.exec(id)?.[1];
  if(!code)return;
  return (await lookup({IDEND:code}))[0];
}
