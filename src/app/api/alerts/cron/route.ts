import {timingSafeEqual} from 'node:crypto';
import {runServerAlerts} from '@/lib/server-alerts';

export const maxDuration=60;
const headers={'Cache-Control':'no-store'};

export async function GET(request:Request){
  const secret=process.env.CRON_SECRET;
  if(!secret) return new Response(null,{status:404,headers});
  const expected=Buffer.from('Bearer '+secret);
  const actual=Buffer.from(request.headers.get('authorization')??'');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual)) return new Response(null,{status:401,headers});

  try{
    const result=await runServerAlerts();
    return Response.json(result,{status:result.status==='ok'?200:503,headers});
  }catch{
    console.warn('UrbanFlow: não foi possível executar a rotina de alertas.');
    return Response.json({status:'unavailable'},{status:503,headers});
  }
}
