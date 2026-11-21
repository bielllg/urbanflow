import {dashboard} from '@/lib/data';
import {invalidQuery,queryTooLong} from '@/lib/http';

export async function GET(request:Request) {
  if(queryTooLong(request)) return invalidQuery();
  const query=new URL(request.url).searchParams;
  return Response.json(await dashboard(query,{compact:query.get('compact')==='1'}),{headers:{'Cache-Control':'no-store'}});
}
