import {roadLive,transitLive} from '@/lib/live-feeds';
import {invalidQuery,queryTooLong} from '@/lib/http';

const headers={'Cache-Control':'public, max-age=15','Vercel-CDN-Cache-Control':'public, s-maxage=30'};
const sources={transit:transitLive,road:roadLive};
type LiveSource=keyof typeof sources;
const cache=new Map<LiveSource,{until:number;result:Promise<unknown>}>();

export async function GET(request:Request){
  if(queryTooLong(request)) return invalidQuery();
  const source=new URL(request.url).searchParams.get('source');
  if(source!=='transit'&&source!=='road') return Response.json({error:'Fonte inválida.'},{status:400});
  const cached=cache.get(source);
  if(cached&&cached.until>Date.now()) return Response.json(await cached.result,{headers});
  const result=sources[source]();
  cache.set(source,{until:Date.now()+30_000,result});
  return Response.json(await result,{headers});
}
