'use client';

import { useId } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Count } from '@/lib/types';
import { number } from './ViewParts';

const axisNumber = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export function Chart({ values, label, kind = 'area', hideAxis = false, unit = '', color = 'var(--primary, #087480)' }: {
  values: Count[]; label: string; kind?: 'area' | 'bar'; hideAxis?: boolean; unit?: string; color?: string;
}) {
  const gradientId = useId();
  const valid = values.filter((point) => point.value != null);
  if (!valid.length) return <div className="uv-chart-empty">Sem observações para este recorte. Selecione um período com cobertura.</div>;

  const axes = <>
    <CartesianGrid vertical={false} stroke="var(--line, #e2e7e9)"/>
    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={13} tickMargin={8} tick={{ fill: 'var(--muted, #546670)' }}/>
    <YAxis hide={hideAxis} width={56} tickLine={false} axisLine={false} tickFormatter={(value: number) => axisNumber.format(value)} tick={{ fill: 'var(--muted, #546670)' }}/>
    <Tooltip contentStyle={{ background: 'var(--surface, #fff)', color: 'var(--text, #202c31)', border: '1px solid var(--line, #e2e7e9)', borderRadius: 8 }} formatter={(value) => [`${number.format(Number(value))}${unit ? ` ${unit}` : ''}`, label]}/>
  </>;
  const margin = { top: 13, right: 9, bottom: 6, left: hideAxis ? 9 : 0 };
  const describe = (point: Count) => point.value == null ? 'sem dados' : `${number.format(point.value)}${unit ? ` ${unit}` : ''}`;
  return (
    <>
      <div className="uv-chart">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar'
            ? <BarChart data={values} margin={margin} aria-label={label}>{axes}<Bar name={label} dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false}/></BarChart>
            : <AreaChart data={values} margin={margin} aria-label={label}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.23}/><stop offset="100%" stopColor={color} stopOpacity={.015}/></linearGradient></defs>
              {axes}
              <Area name={label} type="linear" dataKey="value" stroke={color} strokeWidth={2.75} fill={`url(#${gradientId})`} connectNulls={false} isAnimationActive={false} dot={valid.length < 3} activeDot={{ r: 4, stroke: 'var(--surface, #fff)', strokeWidth: 2 }}/>
            </AreaChart>}
        </ResponsiveContainer>
      </div>
      <details className="uv-chart-data">
        <summary>Dados do gráfico</summary>
        <ul>{values.map((point) => <li key={point.label}>{point.label} · {describe(point)}</li>)}</ul>
      </details>
    </>
  );
}
