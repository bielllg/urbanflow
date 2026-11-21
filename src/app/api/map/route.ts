import {mapData} from '@/lib/data';
import {invalidQuery,queryTooLong} from '@/lib/http';

export async function GET(request:Request) {
  if(queryTooLong(request)) return invalidQuery();
  const params=new URL(request.url).searchParams;
  const dynamic=params.has('selected')||params.get('layers')?.split(',').includes('transit');
  return Response.json(await mapData(params),{headers:dynamic?{'Cache-Control':'no-store'}:{
    'Cache-Control':'public, max-age=30',
    'Vercel-CDN-Cache-Control':'public, s-maxage=120, stale-while-revalidate=300',
  }});
}
