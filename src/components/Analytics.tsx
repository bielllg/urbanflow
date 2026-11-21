'use client';

import { Activity, BusFront, CalendarDays, ChevronLeft, ChevronRight, Database, Gauge, MapPin, Pause, Play, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import type { Accident, Count, DashboardData, Period, Traffic, TransitRoute } from '@/lib/types';
import { Breakdown, Kpi, Panel, displayDate, displayPeriod, number } from './ViewParts';
import { Chart } from './Chart';
import LiveFeeds from './LiveFeeds';

type Page = 'transito' | 'acidentes' | 'transporte-publico' | 'analise-historica';
type Navigate = (url: string) => void;
type Props = {
  data: DashboardData; page: Page; map: ReactNode; onNavigate: Navigate;
  onSelectRoute?: (id: string) => void; selectedRoute?: string; onHistoricalPeriod?: (period: Period) => void; region?: string;
};

const normalize = (value: string | number) => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const sorter = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const hourLabel = (hour: number | null) => hour == null ? '—' : `${String(hour).padStart(2, '0')}h`;
const fatalLabel = (record: Accident) => record.fatal == null ? 'Não informada' : record.fatal ? 'Com fatalidade' : 'Sem fatalidade';

type Column<Row> = { label: string; key?: string; value: (row: Row) => string | number; render?: (row: Row) => ReactNode; numeric?: boolean };
type RemoteRecords = { dataset: 'transito' | 'acidentes'; period: Period; filters?: Record<string, string> };
type ResponseRecords<Row> = { rows: Row[]; total: number; page: number };

function RecordsTable<Row>({ rows = [], columns, rowKey, initialSort = 0, initialDescending = false, remote }: {
  rows?: Row[]; columns: Column<Row>[]; rowKey: (row: Row) => string; initialSort?: number; initialDescending?: boolean; remote?: RemoteRecords;
}) {
  const [index, setIndex] = useState(0);
  const [sort, setSort] = useState({ index: initialSort, desc: initialDescending });
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: ResponseRecords<Row> }>();
  const pageSize = remote ? 15 : 12;
  const remoteQuery = remote && new URLSearchParams({ dataset: remote.dataset, ...remote.period, ...remote.filters,
    q: query.trim(), page: String(index + 1), sort: columns[sort.index].key ?? 'date', dir: sort.desc ? 'desc' : 'asc',
  }).toString();
  const requestKey = remoteQuery ? `${remoteQuery}&attempt=${attempt}` : undefined;
  useEffect(() => {
    if (!remoteQuery || !requestKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/records?${remoteQuery}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as ResponseRecords<Row>;
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      } catch {
        if (!controller.signal.aborted) setResult({ key: requestKey });
      }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [remoteQuery, requestKey]);
  const matches = useMemo(() => {
    const text = normalize(query.trim());
    const sorted = text ? rows.filter((row) => columns.some((column) => normalize(column.value(row)).includes(text))) : [...rows];
    const column = columns[sort.index];
    return sorted.sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      const diff = typeof left === 'number' && typeof right === 'number' ? left - right : sorter.compare(String(left), String(right));
      return sort.desc ? -diff : diff;
    });
  }, [rows, columns, query, sort]);
  const response = result?.key === requestKey ? result : undefined;
  const failed = Boolean(remote && response && !response.data);
  const loading = Boolean(remote && !response);
  const total = remote ? response?.data?.total ?? 0 : matches.length;
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  const page = remote ? (response?.data?.page ?? 1) - 1 : Math.min(last, index);
  const visibleRows = remote ? response?.data?.rows ?? [] : matches.slice(page * pageSize, (page + 1) * pageSize);
  return <>
    <div className="uv-controls uv-controls-spaced">
      <label className="uv-control uv-filter-input"><Search size={14} aria-hidden="true"/><input type="search" placeholder="Buscar na tabela" aria-label="Buscar na tabela" value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }}/></label>
    </div>
    <div className="uv-table-wrap" role="region" aria-label="Tabela de registros com rolagem horizontal" tabIndex={0} aria-busy={loading}>
      <table className="uv-table uv-table-interactive">
        <thead><tr>{columns.map((column, index) => <th key={column.label} scope="col" className={column.numeric ? 'uv-numeric' : ''} aria-sort={sort.index === index ? sort.desc ? 'descending' : 'ascending' : undefined}>
          <button onClick={() => { setSort({ index, desc: sort.index === index && !sort.desc }); setIndex(0); }}>{column.label}{sort.index === index && <span aria-hidden="true">{sort.desc ? '↓' : '↑'}</span>}</button>
        </th>)}</tr></thead>
        <tbody>{loading ? Array.from({length:pageSize},(_,index)=><tr key={index} aria-hidden="true">{columns.map(column=><td key={column.label} className="uv-table-skeleton-cell"><div className="uv-table-skeleton"/></td>)}</tr>)
          : visibleRows.length ? visibleRows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.label} className={column.numeric ? 'uv-numeric' : ''}>{column.render ? column.render(row) : column.value(row)}</td>)}</tr>)
          : <tr><td colSpan={columns.length} className="uv-table-empty">{failed ? <><span>Consulta indisponível. </span><button className="uv-text-button" onClick={() => setAttempt(attempt + 1)}>Tentar novamente</button></> : 'Nenhum registro corresponde aos filtros.'}</td></tr>}</tbody>
      </table>
    </div>
    <div className="uv-table-footer">
      <span aria-live="polite">{loading?'Buscando registros…':failed?'':total ? `${number.format(page * pageSize + 1)}–${number.format(Math.min((page + 1) * pageSize, total))} de ${number.format(total)} registros` : '0 registros'}</span>
      <div className="uv-controls">
        <button className="uv-control-icon" onClick={() => setIndex(page - 1)} disabled={loading || page <= 0} aria-label="Página anterior"><ChevronLeft size={15}/></button>
        <button className="uv-control-icon" onClick={() => setIndex(page + 1)} disabled={loading || page >= last} aria-label="Próxima página"><ChevronRight size={15}/></button>
      </div>
    </div>
  </>;
}

function Transit({ data, map, selectedRoute, onSelectRoute }: { data: DashboardData; map: ReactNode; selectedRoute?: string; onSelectRoute?: (id: string) => void }) {
  const [localRoute, setLocalRoute] = useState<string>();
  const route = data.routes.find((item) => item.id === (selectedRoute ?? localRoute));
  const series = route?.hours?.map((value, index) => ({ label: hourLabel(index), value })) ?? [];
  const columns: Column<TransitRoute>[] = [
    { label: 'Linha', value: (row) => row.shortName, render: (row) => <button className="uv-text-button" aria-pressed={row.id === route?.id} onClick={() => { setLocalRoute(row.id); onSelectRoute?.(row.id); }}>{row.shortName || row.id}</button> },
    { label: 'Itinerário', value: (row) => row.name },
    { label: 'Viagens programadas', value: (row) => row.trips ?? -1, render: (row) => row.trips == null ? '—' : number.format(row.trips), numeric: true },
    { label: 'Paradas cadastradas', value: (row) => row.stopCount ?? -1, render: (row) => row.stopCount == null ? '—' : number.format(row.stopCount), numeric: true },
  ];
  return <>
    <div className="uv-kpis">
      <Kpi title="Linhas cadastradas" value={data.totals.routes || null} icon={<BusFront size={15}/>} caption="Rede programada · SUMOB"/>
      <Kpi title="Paradas cadastradas" value={data.totals.stops || null} icon={<MapPin size={15}/>} tone="blue" caption="Rede programada · SUMOB"/>
      <Kpi title="Viagens programadas" value={data.totals.plannedTrips} icon={<CalendarDays size={15}/>} tone="gold" caption={data.plannedPeriod ? 'GTFS/SUMOB · '+displayPeriod(data.plannedPeriod) : 'Sem calendário importado para o período'}/>
      <Kpi title="Pontualidade observada" value={null} icon={<Gauge size={15}/>} tone="coral" caption="Requer passagens vinculadas à viagem"/>
    </div>
    <div className="uv-analytics-grid">
      <Panel title={route ? `Itinerário · ${route.shortName || route.id}` : 'Mapa da rede'} subtitle={route?.name || 'Paradas e itinerários do serviço programado'}><div className="uv-map-slot">{map}</div></Panel>
      <Panel title="Partidas por horário" subtitle={route ? `Linha ${route.shortName || route.id} · horários do feed, hora de serviço` : 'Selecione uma linha para consultar a programação'}>
        {route ? <Chart values={series} label="Partidas programadas" kind="bar"/> : <div className="uv-chart-empty">Escolha uma linha na tabela abaixo.</div>}
      </Panel>
    </div>
    <Panel title="Linhas de ônibus" subtitle={`GTFS/SUMOB · ${displayPeriod(data.transitValidity)}`}>
      <RecordsTable rows={data.routes} columns={columns} rowKey={(item) => item.id}/>
    </Panel>
    {data.operations && <div className="uv-analytics-grid">
      <Panel title="Passageiros registrados por dia" subtitle={`MCO/SUMOB · Edição importada ${displayMonth(data.operations.month)} · ${number.format(data.operations.passengers)} usuários registrados`}>
        <Chart values={data.operations.byDay.map(item=>({...item,label:item.label.slice(8)}))} label="Usuários registrados"/>
      </Panel>
      <Panel title="Linhas com maior registro de passageiros" subtitle="MCO convencional · cobertura parcial do sistema">
        <Breakdown values={data.operations.byLine.slice(0,8)}/>
      </Panel>
    </div>}
  </>;
}

function TrafficView({ data, map, area }: { data: DashboardData; map: ReactNode; area?: string }) {
  const hasVolume = data.totals.volume != null;
  const label = hasVolume ? 'Veículos' : 'Velocidade amostral';
  const unit = hasVolume ? 'veículos' : 'km/h';
  const [region, setRegion] = useState('');
  const measuredHours = data.trafficHours.filter((point): point is { label: string; value: number } => point.value != null);
  const extreme = measuredHours.reduce<{ label: string; value: number } | null>((current, point) => {
    if (!current || (hasVolume ? point.value > current.value : point.value < current.value)) return point;
    return current;
  }, null);
  const regions = data.trafficRegions;
  const columns: Column<Traffic>[] = [
    { label: 'Data', key: 'date', value: (row) => row.date, render: (row) => displayDate(row.date) },
    { label: 'Hora', key: 'hour', value: (row) => row.hour ?? -1, render: (row) => hourLabel(row.hour) },
    { label: 'Via', key: 'road', value: (row) => row.road || 'Não informada' },
    { label: 'Regional', key: 'region', value: (row) => row.region || 'Não informada' },
    { label: 'Velocidade', key: 'speed', value: (row) => row.speed ?? -1, render: (row) => row.speed == null ? '—' : `${number.format(row.speed)} km/h`, numeric: true },
    { label: 'Volume', key: 'volume', value: (row) => row.volume ?? -1, render: (row) => row.volume == null ? '—' : number.format(row.volume), numeric: true },
  ];
  return <>
    <div className="uv-kpis">
      <Kpi title="Volume medido" value={data.totals.volume} unit="veíc." icon={<Activity size={15}/>} caption="Radares com dados no período"/>
      <Kpi title="Velocidade amostral" value={data.totals.averageSpeed} unit="km/h" tone="blue" icon={<Gauge size={15}/>} caption="Média das observações disponíveis"/>
      <Kpi title="Medições" value={data.totals.trafficCount || null} icon={<Database size={15}/>} tone="gold" caption="Registros de trânsito no período"/>
      <Kpi title="Congestionamento" value={null} icon={<TriangleAlert size={15}/>} tone="coral" caption="Requer referência de fluxo livre"/>
    </div>
    <div className="uv-analytics-grid">
      <Panel title={hasVolume ? 'Volume por hora' : 'Velocidade por hora'} subtitle="Observações com hora válida · PBH">
        <Chart values={data.trafficHours} label={label} unit={unit}/>
        {extreme && measuredHours.length >= 2 && <p className="uv-aggregation-note">{hasVolume ? 'Maior volume medido' : 'Menor velocidade média'} às {extreme.label} · {number.format(extreme.value)} {unit}.</p>}
      </Panel>
      <Panel title={hasVolume ? 'Volume por radar' : 'Vias com menor velocidade amostral'} subtitle={hasVolume ? 'Contagens agregadas por equipamento' : `Média nas vias aferidas · ${unit}`}>
        <Breakdown values={data.trafficRoads.slice(0, 8)}/>
      </Panel>
      <Panel title="Vias e corredores monitorados" subtitle="Localização das observações disponíveis"><div className="uv-map-slot">{map}</div></Panel>
      <Panel title="Comparação por dia da semana" subtitle={hasVolume ? 'Contagens nos dias com observação válida' : 'Velocidade amostral nas janelas disponíveis'}>
        <Chart values={data.trafficWeekdays} label={label} unit={unit} kind="bar"/>
      </Panel>
    </div>
    <Panel title="Medições de trânsito" subtitle={`Cobertura publicada ${displayPeriod(data.trafficCoverage)}`} action={<SelectFilter label="Regional" value={region} setValue={setRegion} options={regions}/> }>
      <RecordsTable key={region} remote={{dataset:'transito',period:data.period,filters:{area:area ?? '',region}}} columns={columns} rowKey={(item) => item.id} initialDescending/>
    </Panel>
  </>;
}

function SelectFilter({ label, value, setValue, options, placeholder = 'Todas' }: { label: string; value: string; setValue: (value: string) => void; options: string[]; placeholder?: string }) {
  return <label className="uv-form-label">{label}<select className="uv-control" value={value} onChange={(event) => setValue(event.target.value)}>
    <option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}
  </select></label>;
}

function Accidents({ data, map, onNavigate, area }: { data: DashboardData; map: ReactNode; onNavigate: Navigate; area?: string }) {
  const [type, setType] = useState('');
  const [region, setRegion] = useState('');
  const [severity, setSeverity] = useState('');
  const [geocodedOnly, setGeocodedOnly] = useState(false);
  const [leftRegion, setLeftRegion] = useState('');
  const [rightRegion, setRightRegion] = useState('');
  const fatal = severity === 'Com fatalidade' ? 'true' : severity === 'Sem fatalidade' ? 'false' : severity ? 'unknown' : '';
  const columns: Column<Accident>[] = [
    { label: 'Data', key: 'date', value: (row) => row.date, render: (row) => displayDate(row.date) },
    { label: 'Hora', key: 'hour', value: (row) => row.hour ?? -1, render: (row) => hourLabel(row.hour) },
    { label: 'Tipo de sinistro', key: 'type', value: (row) => row.type || 'Não informado' },
    { label: 'Regional', key: 'region', value: (row) => row.region || 'Não informada' },
    { label: 'Fatalidade', key: 'fatal', value: fatalLabel },
    { label: 'Localização', key: 'geocoded', value: (row) => row.lat == null || row.lng == null ? 'Indisponível' : 'Ver no mapa', render: (row) => row.lat == null || row.lng == null ? 'Indisponível' : <button className="uv-text-button" onClick={() => onNavigate(`/mapa?start=${data.period.start}&end=${data.period.end}&selected=${encodeURIComponent(`accident-${row.id}`)}`)}>Ver no mapa</button> },
  ];
  return <>
    <div className="uv-analytics-grid">
      <Panel title="Mapa de sinistros com vítima" subtitle={`${number.format(Math.max(0, data.totals.accidents - data.unmappedAccidents))} georreferenciados · ${number.format(data.unmappedAccidents)} sem coordenadas válidas`} action={<button className="uv-text-button" onClick={() => onNavigate(`/mapa?start=${data.period.start}&end=${data.period.end}&layers=accident,heat`)}>Abrir mapa</button>}><div className="uv-map-slot">{map}</div></Panel>
      <Panel title="Evolução mensal" subtitle="Boletins por data do evento · BHTRANS"><Chart values={displayMonths(data.accidentMonths)} label="Sinistros"/></Panel>
      <Panel title="Distribuição por hora" subtitle="Somente registros com hora informada"><Chart values={data.accidentHours} label="Sinistros" kind="bar"/></Panel>
      <Panel title="Tipos de sinistro" subtitle="Categorias registradas pelos boletins"><Breakdown values={data.accidentTypes.slice(0, 10)}/></Panel>
      <Panel title="Comparação entre regionais" subtitle="Contagens de sinistros com vítima no mesmo período">
        <div className="uv-controls uv-controls-spaced">
          <SelectFilter label="Primeira regional" value={leftRegion} setValue={setLeftRegion} options={data.regions.map((item) => item.name).filter((name) => name !== rightRegion)} placeholder="Selecione"/>
          <SelectFilter label="Segunda regional" value={rightRegion} setValue={setRightRegion} options={data.regions.map((item) => item.name).filter((name) => name !== leftRegion)} placeholder="Selecione"/>
        </div>
        <Breakdown values={[...data.regions].filter((item) => !leftRegion && !rightRegion || item.name === leftRegion || item.name === rightRegion).sort((a, b) => b.accidents - a.accidents).map((item) => ({ label: item.name, value: item.accidents })).slice(0, 10)}/>
      </Panel>
      <Panel title="Distribuição semanal" subtitle="Dia da semana da ocorrência"><Chart values={data.accidentWeekdays} label="Sinistros" kind="bar"/></Panel>
    </div>
    <Panel title="Boletins de sinistros" subtitle={`BHTRANS · ${displayPeriod(data.period)}`}>
      <div className="uv-controls uv-controls-spaced">
        <SelectFilter label="Tipo" value={type} setValue={setType} options={data.accidentTypes.map(item=>item.label).sort(sorter.compare)}/>
        <SelectFilter label="Regional" value={region} setValue={setRegion} options={data.regions.map(item=>item.name).sort(sorter.compare)}/>
        <SelectFilter label="Fatalidade" value={severity} setValue={setSeverity} options={['Com fatalidade', 'Sem fatalidade', 'Não informada']}/>
        <label className="uv-form-label"><input type="checkbox" checked={geocodedOnly} onChange={(event) => setGeocodedOnly(event.target.checked)}/> Somente georreferenciados</label>
      </div>
      <RecordsTable key={`${type}/${region}/${severity}/${geocodedOnly}`} remote={{dataset:'acidentes',period:data.period,filters:{area:area ?? '',region,type,fatal,geocoded:geocodedOnly?'1':''}}} columns={columns} rowKey={(item) => item.id} initialDescending/>
    </Panel>
  </>;
}

function monthKey(label: string) {
  if (/^\d{4}-\d{2}$/.test(label)) return label;
  if (/^\d{2}\/\d{4}$/.test(label)) return `${label.slice(3)}-${label.slice(0, 2)}`;
  return undefined;
}

function displayMonth(label: string) {
  const month = monthKey(label);
  return month ? `${month.slice(5)}/${month.slice(0, 4)}` : label;
}

function displayMonths(values: Count[]) {
  return values.map((point) => ({ ...point, label: displayMonth(point.label) }));
}

function MonthlyTraffic({data,region}:{data:DashboardData;region?:string}){
  const [metric,setMetric]=useState('volume');
  const volume=metric==='volume';
  const values=volume?data.trafficVolumeMonths:data.trafficSpeedMonths;
  const params=new URLSearchParams({...data.period,format:'series',series:metric});
  if(region)params.set('region',region);
  return <Panel title="Medições viárias por mês" subtitle="Dados históricos da PBH">
    <div className="uv-controls uv-controls-spaced">
      <label className="uv-form-label">Indicador<select className="uv-control" value={metric} onChange={event=>setMetric(event.target.value)}><option value="volume">Volume medido</option><option value="speed">Velocidade amostral</option></select></label>
      <a className="uv-text-button" href={'/api/export?'+params.toString()}>Baixar série CSV</a>
    </div>
    <Chart label={volume?'Volume medido':'Velocidade amostral'} unit={volume?'veículos':'km/h'} values={displayMonths(values)}/>
  </Panel>;
}

function monthsIn(data: DashboardData) {
  const start = data.coverage && data.period.start < data.coverage.start ? data.coverage.start : data.period.start;
  const end = data.coverage && data.period.end > data.coverage.end ? data.coverage.end : data.period.end;
  if (!data.coverage || start > end) return data.accidentMonths;
  const points = new Map(data.accidentMonths.map((point) => [monthKey(point.label), point.value]));
  const month = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const series: Count[] = [];
  while (month.toISOString().slice(0, 7) <= end.slice(0, 7) && series.length < 240) {
    const label = month.toISOString().slice(0, 7);
    series.push({ label, value: points.get(label) ?? null });
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return series.length === 240 ? data.accidentMonths : series;
}

function History({ data, map, onNavigate, onHistoricalPeriod, region }: { data: DashboardData; map: ReactNode; onNavigate: Navigate; onHistoricalPeriod?: (period: Period) => void; region?: string }) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const months = monthsIn(data);
  const length = months.length;
  useEffect(() => {
    if (!playing || length < 2) return;
    const timer = window.setInterval(() => setCursor((current) => (current + 1) % length), 1100);
    return () => window.clearInterval(timer);
  }, [playing, length]);
  const point = months[Math.min(cursor, length - 1)];
  const selectedMonth = point && monthKey(point.label);
  const first = `${selectedMonth}-01`;
  const [year, month] = selectedMonth?.split('-').map(Number) ?? [];
  const last = `${selectedMonth}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  const start = selectedMonth ? (data.period.start > first ? data.period.start : first) : undefined;
  const end = selectedMonth ? (data.period.end < last ? data.period.end : last) : undefined;
  const changeMapPeriod = useEffectEvent((period: Period) => onHistoricalPeriod?.(period));
  useEffect(() => {
    if (start && end) changeMapPeriod({ start, end });
  }, [start, end]);
  const comparison = data.comparison;
  const difference = comparison && comparison.accidents > 0 ? (data.totals.accidents / comparison.accidents - 1) * 100 : null;
  const periodDays = (value: {start:string;end:string}) => (Date.parse(value.end) - Date.parse(value.start)) / 86400000;
  const fullyCovered = (period: {start:string;end:string}) => data.coverage && period.start >= data.coverage.start && period.end <= data.coverage.end;
  const comparable = comparison && fullyCovered(comparison.period) && fullyCovered(data.period) && periodDays(comparison.period) === periodDays(data.period);
  return <>
    <Panel title="Comparação de períodos" subtitle={`Período principal ${displayPeriod(data.period)} · Sinistros com vítima`}>
      <form className="uv-controls uv-controls-spaced" onInput={(event) => {
        const end = event.currentTarget.elements.namedItem('compareEnd') as HTMLInputElement;
        end.setCustomValidity('');
      }} onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const compareStart = String(form.get('compareStart') || '');
        const compareEnd = String(form.get('compareEnd') || '');
        if (!compareStart || !compareEnd || compareStart > compareEnd) {
          const end = event.currentTarget.elements.namedItem('compareEnd') as HTMLInputElement;
          end.setCustomValidity('A data final deve ser igual ou posterior à inicial.');
          end.reportValidity();
          return;
        }
        const params = new URLSearchParams({ ...data.period, compareStart, compareEnd });
        onNavigate(`/analise-historica?${params.toString()}`);
      }}>
        <label className="uv-form-label">Comparar de<input className="uv-control" type="date" name="compareStart" defaultValue={comparison?.period.start} required/></label>
        <label className="uv-form-label">Até<input className="uv-control" type="date" name="compareEnd" defaultValue={comparison?.period.end} required/></label>
        <button className="uv-control-icon" type="submit">Comparar</button>
        <button className="uv-text-button" type="button" onClick={() => onNavigate(`/relatorios?${new URLSearchParams(data.period).toString()}`)}>Exportar análise</button>
      </form>
      {comparison && <p className="uv-empty" aria-live="polite">{displayPeriod(comparison.period)} · {fullyCovered(comparison.period) ? `${number.format(comparison.accidents)} no comparativo` : 'cobertura incompleta no comparativo'} · {fullyCovered(data.period) ? `${number.format(data.totals.accidents)} no período principal` : 'cobertura incompleta no período principal'}.{comparable && difference != null ? ` Variação de ${number.format(difference)}%.` : ' Variação indisponível para estes períodos.'}</p>}
    </Panel>
    <div className="uv-analytics-grid">
      <Panel title="Sinistros ao longo do tempo" subtitle="Registros mensais · BHTRANS">
        <Chart values={displayMonths(months)} label="Sinistros"/>
        {point && <>
          <div className="uv-timeline">
            <button className="uv-control-icon" type="button" onClick={() => setPlaying(!playing)} disabled={length < 2} aria-label={playing ? 'Pausar linha do tempo' : 'Reproduzir linha do tempo'}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button>
            <input type="range" aria-label="Mês na linha do tempo" aria-valuetext={displayMonth(point.label)} min={0} max={Math.max(0, length - 1)} value={Math.min(cursor, length - 1)} disabled={length < 2} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }}/>
            <output className="uv-form-label">{displayMonth(point.label)} · {point.value == null ? 'Sem dados' : number.format(point.value)}</output>
          </div>
          {start && end && <button className="uv-text-button uv-timeline-link" onClick={() => {
            onNavigate(`/mapa?${new URLSearchParams({ start, end, layers: 'accident,heat' }).toString()}`);
          }}>Ver mês no mapa</button>}
        </>}
      </Panel>
      <Panel title="Concentração no período" subtitle={onHistoricalPeriod && start && end ? `Sinistros georreferenciados · ${displayPeriod({ start, end })}` : 'Sinistros históricos georreferenciados'}><div className="uv-map-slot">{map}</div></Panel>
      <Panel title="Padrão por horário" subtitle="Registros que informam a hora do sinistro"><Chart values={data.accidentHours} label="Sinistros" kind="bar"/></Panel>
      <Panel title="Padrão semanal" subtitle="Acumulado por dia da semana"><Chart values={data.accidentWeekdays} label="Sinistros" kind="bar"/></Panel>
      <MonthlyTraffic data={data} region={region}/>
    </div>
  </>;
}

export default function Analytics({ data, page, map, onNavigate, onSelectRoute, selectedRoute, onHistoricalPeriod, region }: Props) {
  const transit = page === 'transporte-publico';
  const isTraffic = page === 'transito';
  const coverage = transit ? data.transitValidity : isTraffic ? data.trafficCoverage : data.coverage;
  return <div className="uv-view">
    <div className="uv-source">
      <span className="uv-source-name"><Database size={14} aria-hidden="true"/> {transit ? 'Horários programados' : 'Dados históricos'}</span>
      <span>{transit ? 'Calendário importado' : 'Cobertura publicada'} · {displayPeriod(coverage)}</span>
      <span className="uv-status">Filtro · {displayPeriod(data.period)}</span>
    </div>
    {transit&&data.transitValidity&&(data.transitScheduleStatus==='expired'||data.transitScheduleStatus==='expiring')&&
      <p className="status-strip alert-strip" role="status">{data.transitScheduleStatus==='expired'
        ? 'O calendário publicado venceu. As viagens exibidas são do período de referência.'
        : 'O calendário publicado vence em até sete dias.'} Vigência até {displayDate(data.transitValidity.end)}.</p>}
    {isTraffic && <TrafficView data={data} map={map} area={region}/>}
    {isTraffic && <LiveFeeds source="road"/>}
    {page === 'acidentes' && <Accidents data={data} map={map} onNavigate={onNavigate} area={region}/>}
    {transit && <Transit data={data} map={map} selectedRoute={selectedRoute} onSelectRoute={onSelectRoute}/>}
    {transit && <LiveFeeds source="transit"/>}
    {page === 'analise-historica' && <History key={`${data.period.start}/${data.period.end}`} data={data} map={map} onNavigate={onNavigate} onHistoricalPeriod={onHistoricalPeriod} region={region}/>}
  </div>;
}
