import {pagedRecords} from '@/lib/data';

export async function GET(request:Request) {
  return Response.json(await pagedRecords(new URL(request.url).searchParams), {
    headers:{'Cache-Control':'no-store'},
  });
}
