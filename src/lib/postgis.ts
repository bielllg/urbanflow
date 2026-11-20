import 'server-only';
import {Pool} from 'pg';
import type {Feature} from 'geojson';

const db=process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:1500,query_timeout:5000}):null;
db?.on('error',()=>console.warn('UrbanFlow: conexão PostGIS indisponível.'));
const statCache=new Map<string,{time:number;value:unknown}>();

export async function databaseSnapshot<T>(name:string):Promise<T|undefined> {
  if(!db)return;
  const prior=statCache.get(name);
  try{
    const {rows}=await db.query<{version:number;content?:T}>(
      "SELECT EXTRACT(EPOCH FROM imported_at)::float AS version, CASE WHEN EXTRACT(EPOCH FROM imported_at)::float > $2 THEN content END AS content FROM urbanflow_snapshot WHERE name=$1",
      [name,prior?.time ?? 0],
    );
    const row=rows[0];
    if(!row)return;
    if(row.content!=null)statCache.set(name,{time:row.version,value:row.content});
    return (row.content ?? prior?.value) as T|undefined;
  }catch{
    return prior?.value as T|undefined;
  }
}

export async function databaseStreet(id:string):Promise<Feature|undefined> {
  if(!db)return;
  try {
    const {rows}=await db.query<{feature:Feature}>(
      "SELECT jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(geom)::jsonb,'properties',properties) AS feature FROM urbanflow_geometry WHERE source='streets' AND id=$1",
      [id],
    );
    return rows[0]?.feature;
  }catch{
    return undefined;
  }
}
