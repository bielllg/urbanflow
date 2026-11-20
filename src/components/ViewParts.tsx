'use client';

import { useId, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Count, Period } from '@/lib/types';
import './views.css';

export const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const axisNumber = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

export function displayDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed);
}

export function displayPeriod(value: Period | null) {
  if (!value) return 'Cobertura indisponível';
  if (value.start === value.end) return displayDate(value.start);
  return `${displayDate(value.start)} a ${displayDate(value.end)}`;
}

export function Panel({ title, subtitle, action, className = '', children }: {
  title: string; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`uv-panel uv-card ${className}`}>
      <div className="uv-panel-head">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ title, value, unit, caption, detail, icon, tone = '', series = [] }: {
  title: string; value: number | null; unit?: string; caption: string; detail?: string;
  icon: ReactNode; tone?: string; series?: Count[];
}) {
  const points = series.slice(-14).map((item) => item.value);
  const valid = points.filter((value): value is number => value != null);
  const printed = value == null ? '—' : number.format(value);
  const minimum = Math.min(...valid);
  const range = Math.max(...valid) - minimum;
  const path = points.map((point, index) => {
    if (point == null) return '';
    const x = 3 + index * 92 / Math.max(1, points.length - 1);
    const y = range > 0 ? 22 - (point - minimum) / range * 18 : 13;
    return `${index === 0 || points[index - 1] == null ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  return (
    <article className={`uv-card uv-kpi ${tone ? `uv-tone-${tone}` : ''}`}>
      <h2>{title}</h2>
      <span className="uv-kpi-icon" aria-hidden="true">{icon}</span>
      <div className="uv-kpi-value" aria-label={value == null ? 'Indisponível' : undefined}>
        {printed}{value != null && unit && <small>{unit}</small>}
      </div>
      {valid.length > 1 && value != null && printed.length < 6 && <svg className="uv-kpi-spark" viewBox="0 0 98 26" aria-hidden="true">
        <path d="M 0 5 H 98 M 0 13 H 98 M 0 21 H 98" stroke="var(--line, #e2e7e9)" strokeWidth="1"/>
        <path d={path} fill="none" stroke="var(--uv-accent, #0d756d)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>}
      <p className="uv-kpi-caption">{detail && <><strong>{detail}</strong>{' · '}</>}{caption}</p>
    </article>
  );
}

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

export function Breakdown({ values, empty = 'Sem registros no recorte.' }: { values: Count[]; empty?: string }) {
  const valid = values.filter((item): item is { label: string; value: number } => item.value != null);
  if (!valid.length) return <p className="uv-empty">{empty}</p>;
  const max = Math.max(1, ...valid.map((item) => item.value));
  return <div className="uv-breakdown">{valid.map((item) => <div className="uv-breakdown-item" key={item.label}>
    <div><span>{item.label}</span><strong>{number.format(item.value)}</strong></div>
    <span className="uv-breakdown-track" aria-hidden="true"><span style={{ width: `${Math.max(0, item.value) / max * 100}%` }}/></span>
  </div>)}</div>;
}
