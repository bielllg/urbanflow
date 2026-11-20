import {notFound} from 'next/navigation';
import Workspace from '@/components/Workspace';
import {pages,isPage} from '@/lib/pages';
import {dashboard} from '@/lib/data';
import {dashboardQueryFor} from '@/lib/dashboard-query';

export default async function Page({params,searchParams}:{params:Promise<{page?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const segments=(await params).page ?? [];
  const page=segments[0] ?? pages[0].id;
  if(segments.length>1 || !isPage(page)) notFound();
  const search=new URLSearchParams();
  for(const [key,value] of Object.entries(await searchParams)){
    for(const item of typeof value==='string'?[value]:value??[]) search.append(key,item);
  }
  const query=dashboardQueryFor(page,search);
  return <Workspace page={page} initialDashboard={{query:query.toString(),data:await dashboard(query,{compact:true})}}/>;
}
