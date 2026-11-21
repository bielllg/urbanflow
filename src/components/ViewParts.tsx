'use client';

import { type ReactNode } from 'react';
import type { Count, Period } from '@/lib/types';
import './views.css';

export const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
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

export function Breakdown({ values, empty = 'Sem registros no recorte.' }: { values: Count[]; empty?: string }) {
  const valid = values.filter((item): item is { label: string; value: number } => item.value != null);
  if (!valid.length) return <p className="uv-empty">{empty}</p>;
  const max = Math.max(1, ...valid.map((item) => item.value));
  return <div className="uv-breakdown">{valid.map((item) => <div className="uv-breakdown-item" key={item.label}>
    <div><span>{item.label}</span><strong>{number.format(item.value)}</strong></div>
    <span className="uv-breakdown-track" aria-hidden="true"><span style={{ width: `${Math.max(0, item.value) / max * 100}%` }}/></span>
  </div>)}</div>;
}
