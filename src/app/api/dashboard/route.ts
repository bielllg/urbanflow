import {dashboard} from '@/lib/data';

export async function GET(request:Request) {
  const query=new URL(request.url).searchParams;
  return Response.json(await dashboard(query,{compact:query.get('compact')==='1'}),{headers:{'Cache-Control':'no-store'}});
}
