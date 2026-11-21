import 'server-only';
import {createHash,createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {dashboard} from './data';

const db=process.env.URBANFLOW_ALERT_DATABASE_URL
  ? new Pool({connectionString:process.env.URBANFLOW_ALERT_DATABASE_URL,max:2,connectionTimeoutMillis:3500,query_timeout:6000})
  : null;
db?.on('error',()=>console.warn('UrbanFlow: conexão de alertas indisponível.'));

type Rule={id:string;name:string;minimum:number;region?:string};
type Delivery={id:string;payload:unknown;attempts:number};

function isRule(value:unknown):value is Rule{
  if(!value||typeof value!=='object') return false;
  const rule=value as Partial<Rule>;
  return typeof rule.id==='string'&&/^[a-z0-9_-]{1,60}$/.test(rule.id)&&
    typeof rule.name==='string'&&rule.name.trim().length>0&&rule.name.length<=100&&
    typeof rule.minimum==='number'&&Number.isInteger(rule.minimum)&&rule.minimum>=1&&rule.minimum<=999999&&
    (rule.region===undefined||typeof rule.region==='string'&&rule.region.trim().length>0&&rule.region.length<=80);
}

function configuration(){
  const {URBANFLOW_ALERT_RULES,URBANFLOW_ALERT_WEBHOOK,URBANFLOW_ALERT_WEBHOOK_SECRET}=process.env;
  if(!db||!URBANFLOW_ALERT_RULES||!URBANFLOW_ALERT_WEBHOOK||!URBANFLOW_ALERT_WEBHOOK_SECRET) return null;
  const rules:unknown=JSON.parse(URBANFLOW_ALERT_RULES);
  const endpoint=new URL(URBANFLOW_ALERT_WEBHOOK);
  if(!Array.isArray(rules)||rules.length>20||!rules.every(isRule)||new Set(rules.map(rule=>rule.id)).size!==rules.length||
    endpoint.protocol!=='https:'||endpoint.username||endpoint.password||URBANFLOW_ALERT_WEBHOOK_SECRET.length<32){
    throw new Error('Configuração de alertas inválida.');
  }
  return {db,rules,endpoint,secret:URBANFLOW_ALERT_WEBHOOK_SECRET};
}

export async function runServerAlerts(){
  const config=configuration();
  if(!config) return {status:'unconfigured'};
  const {db,rules,endpoint,secret}=config;
  const city=await dashboard(new URLSearchParams({view:'acidentes'}),{compact:true});
  const areas=new Map(city.regions.map(region=>[region.name.toLowerCase(),region.accidents]));
  if(city.coverage&&city.period.start>=city.coverage.start&&city.period.end<=city.coverage.end){
    for(const rule of rules){
      const count=rule.region?areas.get(rule.region.trim().toLowerCase()):city.totals.accidents;
      if(count===undefined||count<rule.minimum) continue;
      const id=createHash('sha256').update(JSON.stringify([rule.id,city.period,rule.region,rule.minimum])).digest('hex');
      const payload={type:'urbanflow.accident-threshold',eventId:id,rule,count,period:city.period,source:'PBH · Sinistros com vítima'};
      await db.query('INSERT INTO urbanflow_alert_delivery(id,payload) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING',[id,JSON.stringify(payload)]);
    }
  }
  const {rows}=await db.query<Delivery>(`WITH batch AS (
    SELECT id FROM urbanflow_alert_delivery
    WHERE sent_at IS NULL AND next_attempt<=now() AND attempts<5
    ORDER BY next_attempt LIMIT 8 FOR UPDATE SKIP LOCKED
  ) UPDATE urbanflow_alert_delivery AS d
    SET next_attempt=now()+interval '12 hours', attempts=d.attempts+1
    FROM batch WHERE d.id=batch.id RETURNING d.id,d.payload,d.attempts`);

  let delivered=0;
  const outcomes=await Promise.allSettled(rows.map(async row=>{
    const body=JSON.stringify(row.payload);
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
    const response=await fetch(endpoint,{
      method:'POST',body,redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store',
      headers:{'content-type':'application/json','idempotency-key':row.id,
        'x-urbanflow-timestamp':timestamp,'x-urbanflow-signature':'sha256='+signature},
    });
    await response.body?.cancel();
    if(!response.ok) throw new Error('Canal não confirmou a entrega.');
    await db.query('UPDATE urbanflow_alert_delivery SET sent_at=now() WHERE id=$1 AND attempts=$2',[row.id,row.attempts]);
    delivered++;
  }));
  const failures=outcomes.filter(result=>result.status==='rejected').length;
  return {status:failures?'partial':'ok',delivered,failures};
}
