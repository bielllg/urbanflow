import type { Accident, Count, Period, Traffic } from './types';

export const week = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

export function validDay(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

export function addDays(value: string, days: number) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateCoverage(rows: readonly { date: string }[]): Period | null {
  let start = '', end = '';
  for (const {date} of rows) {
    if (!date) continue;
    if (!start || date < start) start = date;
    if (date > end) end = date;
  }
  return start && end ? {start,end} : null;
}

export function readPeriod(query: URLSearchParams, fallback: Period): Period {
  const a = query.get('start'), b = query.get('end');
  const start = validDay(a) ? a : fallback.start;
  const end = validDay(b) ? b : fallback.end;
  if (start > end) return fallback;
  return {start,end};
}

export function previousPeriod(period: Period): Period {
  const days = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86_400_000) + 1;
  return {start:addDays(period.start,-days),end:addDays(period.start,-1)};
}

export function overlaps(a:Period,b:Period|null) {
  return !!b && a.start <= b.end && b.start <= a.end;
}

export function within<T extends { date: string }>(rows: readonly T[], period: Period) {
  return rows.filter(({date}) => date >= period.start && date <= period.end);
}

export function withinSortedDates<T extends { date: string }>(rows: readonly T[], period: Period) {
  function boundary(day:string, after:boolean) {
    let low=0, high=rows.length;
    while(low<high){
      const mid=Math.floor((low+high)/2);
      const date=rows[mid].date;
      if(date<day || (after&&date===day))low=mid+1;
      else high=mid;
    }
    return low;
  }
  return rows.slice(boundary(period.start,false),boundary(period.end,true));
}

export function groupCount<T>(rows:readonly T[], key:(item:T)=>string|null):Count[] {
  const groups = new Map<string,number>();
  for (const item of rows) {
    const name = key(item);
    if (name) groups.set(name,(groups.get(name) ?? 0)+1);
  }
  return [...groups].map(([label,value])=>({label,value}));
}

export function mean(values:number[]) {
  return values.length ? values.reduce((total,v)=>total+v,0)/values.length : null;
}

export function measuredSpeed(rows:Traffic[]) {
  const weighted=rows.filter(r=>(r.durationSeconds??0)>0 && typeof r.distanceMeters==='number');
  if(weighted.length) return 3.6*weighted.reduce((sum,r)=>sum+r.distanceMeters!,0)/weighted.reduce((sum,r)=>sum+r.durationSeconds!,0);
  return mean(rows.flatMap(r=>typeof r.speed==='number'?[r.speed]:[]));
}

export function byAccidentHour(rows: Accident[]):Count[] {
  const groups = new Map(groupCount(rows,item=>item.hour === null ? null : String(item.hour)).map(row=>[row.label,row.value]));
  return Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0')+'h',value:groups.get(String(hour)) ?? (rows.some(a=>a.hour !== null) ? 0 : null)}));
}

export function byTraffic(rows: Traffic[], labels: readonly string[], key:(row:Traffic)=>string|null, kind:'speed'|'volume'):Count[] {
  const groups = new Map<string,Traffic[]>();
  for (const row of rows) {
    const name = key(row), value = row[kind];
    if (!name || typeof value !== 'number' || !Number.isFinite(value)) continue;
    const group = groups.get(name) ?? [];
    group.push(row);
    groups.set(name,group);
  }
  return labels.map(label=>{
    const points = groups.get(label);
    return {label,value:points ? (kind==='speed' ? measuredSpeed(points) : points.reduce((sum,row)=>sum+(row.volume??0),0)) : null};
  });
}

export function localDay() {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',dateStyle:'short'}).format(new Date());
}

export function weekday(day:string) {
  return week[new Date(day+'T12:00:00Z').getUTCDay()] ?? null;
}
