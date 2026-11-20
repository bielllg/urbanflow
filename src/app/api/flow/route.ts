type Flow = {currentSpeed:number;freeFlowSpeed:number;currentTravelTime:number;freeFlowTravelTime:number;confidence:number;roadClosure:boolean};
const cache=new Map<string,{expires:number;value:Flow}>();
let windowStart=0, requests=0;

export async function GET(request:Request) {
  const key=process.env.TOMTOM_API_KEY;
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if(!key)return reply({status:'unconfigured'});
  const params=new URL(request.url).searchParams;
  const lat=Number(params.get('lat')),lng=Number(params.get('lng'));
  if(!Number.isFinite(lat+lng)||lat < -20.17 || lat > -19.71 || lng < -44.12 || lng > -43.80) return reply({status:'invalid'},400);
  const point=lat.toFixed(5)+','+lng.toFixed(5);
  const existing=cache.get(point);
  if(existing && existing.expires>Date.now()) return reply({status:'available',flow:existing.value});
  if(Date.now()-windowStart>=60000){windowStart=Date.now();requests=0;cache.clear();}
  if(requests>=25)return reply({status:'limit'},429);
  requests++;
  const url=new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/16/json');
  url.search=new URLSearchParams({key,point,unit:'KMPH'}).toString();
  try{
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok)return reply({status:'unavailable'});
    const flow=(await response.json()).flowSegmentData as Flow;
    if(!flow || ![flow.currentSpeed,flow.freeFlowSpeed,flow.currentTravelTime,flow.freeFlowTravelTime,flow.confidence].every(Number.isFinite) || flow.freeFlowSpeed<=0 || flow.confidence<=0) return reply({status:'unavailable'});
    const value={currentSpeed:flow.currentSpeed,freeFlowSpeed:flow.freeFlowSpeed,currentTravelTime:flow.currentTravelTime,freeFlowTravelTime:flow.freeFlowTravelTime,confidence:flow.confidence,roadClosure:flow.roadClosure===true};
    cache.set(point,{expires:Date.now()+20000,value});
    return reply({status:'available',flow:value});
  }catch{return reply({status:'unavailable'});}
}
