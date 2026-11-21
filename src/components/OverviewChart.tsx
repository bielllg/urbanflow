import {useId} from 'react';
import type {Count} from '@/lib/types';
import {number} from './ViewParts';

export default function OverviewChart({values,label}:{values:Count[];label:string}) {
  const gradient=useId();
  const valid=values.filter(({value})=>value!==null);
  if(!valid.length) return <div className="uv-chart-empty">Sem observações para este recorte. Selecione um período com cobertura.</div>;

  const maximum=Math.max(1,...valid.map(({value})=>value ?? 0));
  const x=(index:number)=>9+index*382/Math.max(1,values.length-1);
  const y=(value:number)=>133-value/maximum*112;
  const segments:string[]=[];
  let line='';
  let start=0;
  values.forEach(({value},index)=>{
    if(value===null) {
      if(line) segments.push(line+' V133 H'+x(start)+' Z');
      line='';
      return;
    }
    if(!line) start=index;
    line+=(line?' L':'M')+x(index)+' '+y(value);
    if(index===values.length-1) segments.push(line+' V133 H'+x(start)+' Z');
  });
  const stroke=values.map(({value},index)=>value===null?'':(index===0||values[index-1].value===null?'M':'L')+x(index)+' '+y(value)).join(' ');
  const step=Math.max(1,Math.ceil(values.length/6));
  return <>
    <div className="uv-chart uv-overview-chart" aria-hidden="true">
      <svg viewBox="0 0 400 164">
        <defs><linearGradient id={gradient} x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="var(--primary)" stopOpacity=".24"/><stop offset="1" stopColor="var(--primary)" stopOpacity=".02"/></linearGradient></defs>
        <path d="M9 21H391 M9 58H391 M9 96H391 M9 133H391" stroke="var(--line)"/>
        <g className="uv-overview-curve">
          <path d={segments.join(' ')} fill={'url(#'+gradient+')'}/>
          <path d={stroke} fill="none" stroke="var(--primary)" strokeWidth="2.75" strokeLinejoin="round"/>
          {values.map(({value,label:pointLabel},index)=>value!==null&&
            <circle key={pointLabel} cx={x(index)} cy={y(value)} r="3.5" fill="var(--primary)" className="uv-chart-point">
              <title>{`${pointLabel} · ${number.format(value)} ${label.toLowerCase()}`}</title>
            </circle>
          )}
        </g>
        {values.map(({label},index)=>(index===values.length-1 || index%step===0&&index+step<values.length)&&
          <text key={label} x={x(index)} y="153" textAnchor={index===0?'start':index===values.length-1?'end':'middle'} fill="var(--muted)" fontSize="11">{label}</text>
        )}
      </svg>
    </div>
    <details className="uv-chart-data">
      <summary>Dados do gráfico</summary>
      <ul aria-label={label}>{values.map(({label,value})=><li key={label}>{label} · {value===null?'sem dados':number.format(value)}</li>)}</ul>
    </details>
  </>;
}
