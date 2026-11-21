import {pagedRecords} from '@/lib/data';
import {invalidQuery,queryTooLong} from '@/lib/http';

export async function GET(request:Request) {
  if(queryTooLong(request)) return invalidQuery();
  return Response.json(await pagedRecords(new URL(request.url).searchParams), {
    headers:{'Cache-Control':'no-store'},
  });
}
