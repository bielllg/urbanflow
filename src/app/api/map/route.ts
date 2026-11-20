import {mapData} from '@/lib/data';

export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  return Response.json(await mapData(params),{headers:{'Cache-Control':params.get('layers')?.split(',').includes('transit')?'no-store':'private, max-age=45'}});
}
