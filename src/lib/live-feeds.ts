import 'server-only';
import bindings from 'gtfs-realtime-bindings';

function httpsEndpoint(value:string|undefined) {
  if(!value) return null;
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password) throw new Error('A fonte precisa de uma URL HTTPS.');
  return url;
}

async function boundedFeed(url:URL) {
  const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6500)});
  if(!response.ok||!response.body) throw new Error('Fonte indisponível.');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>4*1024*1024) throw new Error('Feed excede o limite.');
      chunks.push(value);
    }
  }finally{
    await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
  return bindings.transit_realtime.FeedMessage.decode(Buffer.concat(chunks,total));
}

type FeedStatus='unconfigured'|'unavailable'|'stale'|'current';
export type TransitLive = {
  alerts:{status:FeedStatus;observedAt?:string;items:{id:string;title:string;description:string}[]};
  updates:{status:FeedStatus;observedAt?:string;delayed:number;reported:number};
};

async function transitFeed(value:string|undefined,age:number){
  if(!value) return {status:'unconfigured' as const};
  try{
    const url=httpsEndpoint(value);
    if(!url) return {status:'unconfigured' as const};
    const feed=await boundedFeed(url);
    const time=Number(feed.header.timestamp)*1000;
    if(!Number.isFinite(time)||time<=0||time>Date.now()+60_000||feed.header.incrementality===1) return {status:'unavailable' as const};
    const observedAt=new Date(time).toISOString();
    if(Date.now()-time>age) return {status:'stale' as const,observedAt};
    return {status:'current' as const,observedAt,entities:feed.entity.filter(item=>!item.isDeleted)};
  }catch{return {status:'unavailable' as const};}
}

function translated(text:bindings.transit_realtime.ITranslatedString|null|undefined,max:number){
  const translations=text?.translation ?? [];
  return (translations.find(item=>item.language?.toLowerCase().startsWith('pt'))?.text??translations[0]?.text??'').trim().slice(0,max);
}

export async function transitLive():Promise<TransitLive> {
  const [alerts,updates]=await Promise.all([
    transitFeed(process.env.SUMOB_GTFS_RT_ALERTS_URL,10*60_000),
    transitFeed(process.env.SUMOB_GTFS_RT_UPDATES_URL,2*60_000),
  ]);
  const now=Date.now()/1000;
  const items=(alerts.entities??[]).flatMap(({id,alert})=>{
    if(!alert) return [];
    const periods=alert.activePeriod??[];
    if(periods.length&&!periods.some(period=>(!period.start||Number(period.start)<=now)&&(!period.end||Number(period.end)>now))) return [];
    const title=translated(alert.headerText,180);
    return title?[{id,title,description:translated(alert.descriptionText,850)}]:[];
  }).slice(0,15);
  const measured=new Map<string,boolean>();
  for(const {tripUpdate} of updates.entities??[]){
    const id=tripUpdate?.trip.tripId;
    if(!id||!tripUpdate) continue;
    const delays=[tripUpdate.delay,...(tripUpdate.stopTimeUpdate??[]).flatMap(stop=>[stop.arrival?.delay,stop.departure?.delay])]
      .filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
    const key=[id,tripUpdate.trip.startDate,tripUpdate.trip.startTime].join('|');
    if(delays.length) measured.set(key,!!measured.get(key)||delays.some(delay=>delay>0));
  }
  return {
    alerts:{status:alerts.status,observedAt:alerts.observedAt,items},
    updates:{status:updates.status,observedAt:updates.observedAt,delayed:[...measured.values()].filter(Boolean).length,reported:measured.size},
  };
}

type Incident = {properties?:{id?:string;from?:string;to?:string;events?:{description?:string}[]}};
export type RoadLive = {status:FeedStatus;checkedAt?:string;items:{id:string;location:string;description:string}[]};

export async function roadLive():Promise<RoadLive>{
  const key=process.env.TOMTOM_API_KEY;
  if(!key) return {status:'unconfigured',items:[]};
  const url=new URL('https://api.tomtom.com/traffic/services/5/incidentDetails');
  url.search=new URLSearchParams({key,bbox:'-44.12,-20.17,-43.80,-19.71',fields:'{incidents{properties{id,from,to,events{description}}}}',language:'pt-BR',timeValidityFilter:'present'}).toString();
  try{
    const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6500)});
    if(!response.ok) return {status:'unavailable',items:[]};
    const result=await response.json() as {incidents?:Incident[]};
    if(!Array.isArray(result.incidents)) return {status:'unavailable',items:[]};
    const items=result.incidents.flatMap(({properties})=>{
      if(!properties?.id) return [];
      const description=properties.events?.map(event=>event.description).filter(Boolean).join(' · ').slice(0,320);
      const location=[properties.from,properties.to].filter(Boolean).join(' – ').slice(0,220);
      return [{id:properties.id,location,description:description||'Ocorrência viária'}];
    }).slice(0,20);
    return {status:'current',checkedAt:new Date().toISOString(),items};
  }catch{return {status:'unavailable',items:[]};}
}
