import {NextResponse,type NextRequest} from 'next/server';
import {invalidQuery,queryTooLong} from '@/lib/http';

const defaultTiles='https://tiles.openfreemap.org';

function mapOrigins(){
  try{
    const origin=new URL(process.env.NEXT_PUBLIC_MAP_STYLE ?? defaultTiles);
    if(origin.protocol==='https:') return [...new Set([defaultTiles,origin.origin])].join(' ');
  }catch{}
  return defaultTiles;
}

export function proxy(request:NextRequest) {
  if(queryTooLong(request)) return invalidQuery();
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const development=process.env.NODE_ENV==='development';
  const tiles=mapOrigins();
  const policy=[
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tiles}`,
    "font-src 'self'",
    `connect-src 'self' ${tiles}${development?' ws: wss:':''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const headers=new Headers(request.headers);
  headers.set('Content-Security-Policy',policy);
  const response=NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy',policy);
  return response;
}

export const config={
  matcher:['/((?!api/|_next/|.*\\.[^/]+$).*)'],
};
