import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL para publicar no PostGIS.');
const directory=process.env.URBANFLOW_DATA_DIR ?? 'data';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  const migration=await readFile('db/001_snapshots.sql','utf8');
  await client.query('BEGIN');
  await client.query(migration);
  for(const file of await readdir(directory)){
    if(!/^[a-z-]+\.json$/.test(file)) continue;
    const name=file.slice(0,-5);
    const content=await readFile(join(directory,file),'utf8');
    await client.query(
      'INSERT INTO urbanflow_snapshot(name,content) VALUES ($1,$2::jsonb) ON CONFLICT(name) DO UPDATE SET content=excluded.content,imported_at=now()',
      [name,content],
    );
    if(name==='neighborhoods'||name==='streets'){
      await client.query('DELETE FROM urbanflow_geometry WHERE source=$1',[name]);
      await client.query(
        "INSERT INTO urbanflow_geometry(source,id,properties,geom) SELECT $1,f->'properties'->>'id',f->'properties',ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'),4326) FROM jsonb_array_elements($2::jsonb->'features') f WHERE f->'properties'->>'id' IS NOT NULL AND f->'geometry' IS NOT NULL ON CONFLICT DO NOTHING",
        [name,content],
      );
    }
    console.log('Publicação preparada:',name);
  }
  await client.query('COMMIT');
  console.log('Publicação concluída.');
} catch(error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
