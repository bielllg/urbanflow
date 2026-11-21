import {readFile} from 'node:fs/promises';
import pg from 'pg';

const url=process.env.URBANFLOW_ALERT_DATABASE_URL;
if(!url) throw new Error('Defina URBANFLOW_ALERT_DATABASE_URL.');
const client=new pg.Client({connectionString:url});
await client.connect();
try{
  await client.query(await readFile(new URL('../db/002_alerts.sql',import.meta.url),'utf8'));
  console.log('Persistência dos alertas preparada.');
}finally{await client.end();}
