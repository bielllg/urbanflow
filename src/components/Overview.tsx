'use client';

import { Activity, ArrowUpRight, BusFront, CalendarDays, ChevronRight, MapPin, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DashboardData } from '@/lib/types';
import { Chart, Kpi, Panel, displayDate, number } from './ViewParts';

type Props = { data: DashboardData; onNavigate: (path: string) => void; map: ReactNode };

export default function Overview({ data, onNavigate, map }: Props) {
  const { totals } = data;
  const regional = [...data.regions].sort((a, b) => b.accidents - a.accidents).slice(0, 4);
  const latest = [...data.accidents].sort((a, b) => b.date.localeCompare(a.date) || (b.hour ?? -1) - (a.hour ?? -1)).slice(0, 3);
  const coverage = data.coverage && data.period.end >= data.coverage.start && data.period.start <= data.coverage.end;
  const delta = totals.previousAccidents !== null && totals.previousAccidents > 0
    ? (totals.accidents / totals.previousAccidents - 1) * 100
    : null;
  const relative = delta == null ? undefined : `${delta > 0 ? '+' : ''}${number.format(delta)}%`;

  return (
    <div className="uv-view">
      <div className="uv-kpis">
        <Kpi title="Sinistros com vítima" value={coverage ? totals.accidents : null} tone="coral" icon={<TriangleAlert size={15}/>}
          detail={relative} caption={delta == null ? 'Boletins da BHTRANS no período' : 'vs. período anterior'} series={data.accidentMonths}/>
        {totals.volume != null
          ? <Kpi title="Volume registrado" value={totals.volume} unit="veíc." tone="blue" icon={<Activity size={15}/>} caption="Contagens nos radares disponíveis" series={data.trafficHours}/>
          : totals.averageSpeed != null
            ? <Kpi title="Velocidade amostral" value={totals.averageSpeed} unit="km/h" tone="blue" icon={<Activity size={15}/>} caption="Corredores monitorados · PBH" series={data.trafficHours}/>
            : <Kpi title="Viagens programadas" value={totals.plannedTrips} tone="blue" icon={<CalendarDays size={15}/>} caption={data.plannedPeriod ? 'GTFS/SUMOB · '+displayDate(data.plannedPeriod.start) : 'Calendário GTFS indisponível'}/>}
        <Kpi title="Linhas de ônibus" value={totals.routes || null} icon={<BusFront size={15}/>} caption="Serviço programado · GTFS/SUMOB"/>
        <Kpi title="Paradas cadastradas" value={totals.stops || null} tone="gold" icon={<MapPin size={15}/>} caption="Rede de ônibus · GTFS/SUMOB"/>
      </div>

      <div className="uv-overview-columns">
        <div className="uv-stack">
          <Panel className="uv-map-panel" title="Mapa de mobilidade urbana" subtitle="Vias e ocorrências georreferenciadas de Belo Horizonte"
            action={<button className="uv-text-button" onClick={() => onNavigate('/mapa')}>Abrir mapa completo <ArrowUpRight size={12} aria-hidden="true"/></button>}>
            <div className="uv-map-slot">{map}</div>
          </Panel>

          <Panel title="Regionais monitoradas" subtitle="Sinistros com vítima no período · População do Censo 2022"
            action={<button className="uv-text-button" onClick={() => onNavigate('/acidentes')}>Ver detalhes</button>}>
            <div className="uv-table-wrap">
              <table className="uv-table">
                <thead><tr><th scope="col">Regional</th><th scope="col" className="uv-numeric">Sinistros</th><th scope="col" className="uv-numeric">População</th><th scope="col" className="uv-numeric">Por 100 mil hab.</th></tr></thead>
                <tbody>{regional.length ? regional.map((region) => <tr key={region.name}>
                  <th scope="row" className="uv-table-primary uv-rowhead"><button className="uv-text-button" onClick={()=>onNavigate('/mapa?region='+encodeURIComponent(region.name))}>{region.name}</button></th>
                  <td className="uv-numeric">{number.format(region.accidents)}</td>
                  <td className="uv-numeric">{region.population == null ? '—' : number.format(region.population)}</td>
                  <td className="uv-numeric">{region.rate == null ? '—' : number.format(region.rate)}</td>
                </tr>) : <tr><td colSpan={4} className="uv-table-empty">Sem dados por regional no período.</td></tr>}</tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="uv-stack">
          <Panel title={totals.volume != null ? 'Fluxo por horário' : 'Sinistros por horário'}
            subtitle={totals.volume != null ? 'Volume nos radares com contagem válida' : 'Boletins com hora informada'}
            action={<button className="uv-text-button" onClick={() => onNavigate(totals.volume != null ? '/transito' : '/acidentes')}>Explorar</button>}>
            <Chart values={totals.volume != null ? data.trafficHours : data.accidentHours} label={totals.volume != null ? 'Veículos' : 'Sinistros'}/>
          </Panel>

          <Panel title="Últimos sinistros do período" action={<button className="uv-text-button" onClick={() => onNavigate('/acidentes')}>Ver todos</button>}>
            {latest.length ? <ul className="uv-events">{latest.map((record) => {
              const geocoded = record.lat != null && record.lng != null;
              return <li key={record.id}>
                <button className="uv-event" onClick={() => onNavigate(geocoded ? `/mapa?${new URLSearchParams({ ...data.period, selected: `accident-${record.id}` })}` : '/acidentes')}>
                  <span className="uv-event-icon uv-tone-coral"><TriangleAlert size={14} aria-hidden="true"/></span>
                  <span><strong>{record.type || 'Sinistro com vítima'}</strong><small>{[record.region, displayDate(record.date), record.hour == null ? null : `${String(record.hour).padStart(2, '0')}h`].filter(Boolean).join(' · ')}</small></span>
                  <ChevronRight size={13} aria-hidden="true"/>
                </button>
              </li>;
            })}</ul> : <p className="uv-empty">Nenhum boletim no período selecionado.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
