'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRouter,useSearchParams} from 'next/navigation';
import {useCallback,useEffect,useMemo,useRef,useState,type MouseEvent} from 'react';
import {ArrowDownToLine,Bell,BusFront,CalendarDays,ChevronLeft,ChevronRight,ChevronDown,CircleHelp,Clock3,Database,Filter,Layers,Map as MapIcon,MapPin,Menu,RefreshCw,Search,TriangleAlert,X} from 'lucide-react';
import type {Feature,FeatureCollection,Position} from 'geojson';
import Overview from './Overview';
import {useWorkspaceOverlays} from './useWorkspaceOverlays';
import {alertDate,Reports,SettingsView,useLocalValue,useWorkspaceAppearance,type SavedReport,type AlertRule,type AlertEvent} from './Utilities';
import {pages,type PageId} from '@/lib/pages';
import type {DashboardData,MapData,Period} from '@/lib/types';
import {addDays} from '@/lib/metrics';
import {dashboardQueryFor} from '@/lib/dashboard-query';

const noFeatures:FeatureCollection={type:'FeatureCollection',features:[]};
const MobilityMap=dynamic(()=>import('./MobilityMap'),{ssr:false,loading:()=> <div className="map-placeholder" aria-label="Preparando o mapa" role="status"/>});
const Analytics=dynamic(()=>import('./Analytics'),{loading:()=> <div className="skeleton-layout" role="status" aria-label="Preparando análise"><section/></div>});
const mapLayers=[
  {id:'traffic',label:'Trânsito',icon:Layers},
  {id:'accident',label:'Sinistros',icon:TriangleAlert},
  {id:'transit',label:'Ônibus ao vivo',icon:BusFront},
  {id:'stop',label:'Paradas',icon:MapPin},
  {id:'heat',label:'Mapa de calor',icon:MapIcon},
  {id:'neighborhood',label:'Bairros',icon:Layers},
  {id:'street',label:'Vias',icon:MapIcon},
  {id:'route',label:'Itinerário',icon:BusFront},
];
const compactLayers=['accident','neighborhood'];
const defaultMapLayers=['accident','neighborhood','street'];
const emptyMap:MapData={collection:noFeatures,observedAt:null,fresh:false,status:'unavailable'};
type Hit={id:string;name:string;kind:string;lat?:number;lng?:number;route?:string};

const formatDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
const formatTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const number=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});

function useRequest<T>(url:string|null,version:number,interval=0,scope=url) {
  const [snapshot,setSnapshot]=useState<{url:string;scope:string|null;version:number;data:T|null;error:boolean}|null>(null);
  useEffect(()=>{
    if(!url) return;
    const controller=new AbortController();
    let busy=false;
    async function refresh(){
      if(busy || controller.signal.aborted) return;
      busy=true;
      try{
        const response=await fetch(url!,{signal:controller.signal,cache:version===0&&!interval?'default':'no-store'});
        if(!response.ok) throw new Error('HTTP '+response.status);
        const data=await response.json() as T;
        if(!controller.signal.aborted) setSnapshot({url:url!,scope,version,data,error:false});
      }catch{
        if(!controller.signal.aborted) setSnapshot(previous=>({url:url!,scope,version,data:previous?.scope===scope?previous?.data ?? null:null,error:true}));
      }finally{busy=false;}
    }
    void refresh();
    const timer=interval ? window.setInterval(refresh,interval):undefined;
    return ()=>{controller.abort();if(timer)window.clearInterval(timer);};
  },[url,version,interval,scope]);
  const settled=snapshot?.url===url&&snapshot.version===version;
  return {
    data:url&&snapshot?.scope===scope?snapshot.data:null,
    error:settled&&snapshot.error,
    pending:!!url&&!settled,
  };
}

function featureId(feature:Feature){
  return String(feature.properties?.id ?? feature.id ?? '');
}

function featureLocation(feature:Feature):[number,number]|null{
  const {geometry}=feature;
  if(!geometry) return null;
  let point:Position|undefined;
  if(geometry.type==='Point') point=geometry.coordinates;
  if(geometry.type==='LineString') point=geometry.coordinates[Math.floor(geometry.coordinates.length/2)];
  if(geometry.type==='MultiLineString') point=geometry.coordinates[0]?.[0];
  if(geometry.type==='Polygon') point=geometry.coordinates[0]?.[0];
  if(geometry.type==='MultiPolygon') point=geometry.coordinates[0]?.[0]?.[0];
  return point?.length && typeof point[1]==='number'?[point[0],point[1]]:null;
}

export default function Workspace({page,initialDashboard}:{page:PageId;initialDashboard:{query:string;data:DashboardData}}) {
  const router=useRouter(),search=useSearchParams();
  const [theme,setTheme]=useWorkspaceAppearance('theme');
  const [entryMotion,setEntryMotion]=useWorkspaceAppearance('entryMotion');
  const [collapsed,setCollapsed]=useWorkspaceAppearance('sidebar');
  const [saved,setSaved]=useLocalValue<SavedReport[]>('reports',[]);
  const [rules,setRules]=useLocalValue<AlertRule[]>('rules',[]);
  const [events,setEvents]=useLocalValue<AlertEvent[]>('events',[]);
  const {mobile,mobileViewport,popup,sidebar,opener,heading,trigger,panel,closePopup,closeMobile,openMobile}=useWorkspaceOverlays();
  const focusNextHeading=useRef(false);
  const [version,setVersion]=useState(0);
  const [refreshedDashboard,setRefreshedDashboard]=useState<typeof initialDashboard|null>(null);
  const [term,setTerm]=useState('');
  const [appliedTerm,setAppliedTerm]=useState('');
  const [clicked,setClicked]=useState<Feature|null>(null);
  const [focus,setFocus]=useState<[number,number]|null>(null);
  const [historyPeriod,setHistoryPeriod]=useState<Period|null>(null);
  const [bounds,setBounds]=useState('');
  const [notice,setNotice]=useState('');
  const pageInfo=pages.find(item=>item.id===page)!;
  const isMap=page==='mapa', compact=page==='visao-geral';
  const route=search.get('route') ?? '';
  const selected=search.get('selected') ?? '';
  const mode=search.get('mode')==='historical'?'historical':'current';
  const region=search.get('region') ?? '';
  const compareRegion=search.get('compareRegion') ?? '';
  const filterCount=[region,compareRegion,search.get('incidentType'),search.get('fatal')].filter(Boolean).length;
  const analyticsPage=page==='acidentes'||page==='transito'||page==='transporte-publico'||page==='analise-historica';
  const layers=useMemo(()=>{
    if(isMap) return search.has('layers') ? (search.get('layers')??'').split(',').filter(Boolean):defaultMapLayers;
    if(page==='transito') return ['traffic','street'];
    if(page==='transporte-publico') return route?['route','stop']:['stop'];
    if(page==='analise-historica') return ['accident','heat','neighborhood'];
    return compactLayers;
  },[search,isMap,page,route]);
  const params=new URLSearchParams(search.toString());
  params.set('view',page);
  const dashboardQuery=dashboardQueryFor(page,params);
  const queryKey=dashboardQuery.toString();
  const hasInitialDashboard=queryKey===initialDashboard.query;
  const endpoint=hasInitialDashboard&&refreshedDashboard!==initialDashboard?null:'/api/dashboard?'+queryKey+'&compact=1';
  const dash=useRequest<DashboardData>(endpoint,version);
  const data=dash.data??(hasInitialDashboard?initialDashboard.data:null);
  const comparisonQuery=new URLSearchParams(dashboardQuery);
  if(data?.period){comparisonQuery.set('start',data.period.start);comparisonQuery.set('end',data.period.end);}
  if(compareRegion)comparisonQuery.set('region',compareRegion);
  const comparison=useRequest<DashboardData>(isMap&&data&&compareRegion?'/api/dashboard?'+comparisonQuery.toString()+'&compact=1':null,version).data;
  const mapQuery=new URLSearchParams(params);
  const mapPeriod=page==='analise-historica'?(historyPeriod??data?.period):data?.period;
  if(mapPeriod){mapQuery.set('start',mapPeriod.start);mapQuery.set('end',mapPeriod.end);}
  mapQuery.set('layers',layers.join(','));
  const viewportQuery=new URLSearchParams(mapQuery);
  if(bounds)viewportQuery.set('bbox',bounds);
  const mapUrl=data && bounds && (isMap||analyticsPage) ? '/api/map?'+viewportQuery.toString():null;
  const layerData=useRequest<MapData>(mapUrl,version,layers.includes('transit')&&mode==='current'?22000:0,mapQuery.toString());
  const mapPayload=layerData.data ?? emptyMap;
  const findUrl=popup==='search'&&appliedTerm.length>=2 ? '/api/search?q='+encodeURIComponent(appliedTerm):null;
  const searchRequest=useRequest<Hit[]>(findUrl,version);
  const hits=searchRequest.data ?? [];
  const searching=term.trim()!==appliedTerm||searchRequest.pending;
  const activeFeature=useMemo(()=>mapPayload.collection.features.find(f=>featureId(f)===selected) ?? (clicked && featureId(clicked)===selected ? clicked:null),[clicked,mapPayload,selected]);
  const reportQuery=new URLSearchParams(mapQuery);
  reportQuery.delete('layers');
  if(data){
    reportQuery.set('start',data.period.start);
    reportQuery.set('end',data.period.end);
  }

  useEffect(()=>{
    const timeout=window.setTimeout(()=>setAppliedTerm(term.trim()),200);
    return ()=>window.clearTimeout(timeout);
  },[term]);
  useEffect(()=>{
    if(!focusNextHeading.current)return;
    focusNextHeading.current=false;
    heading.current?.focus();
  },[page,heading]);
  useEffect(()=>{
    if(!notice)return;
    const timer=window.setTimeout(()=>setNotice(''),3200);
    return ()=>window.clearTimeout(timer);
  },[notice]);
  useEffect(()=>{
    if(!data?.coverage || !rules.length || data.period.end>data.coverage.end || data.period.start<data.coverage.start) return;
    const newEvents=rules.filter(rule=>data.totals.accidents>0&&data.totals.accidents>=rule.limit).map(rule=>({
      key:rule.id+'|'+data.period.start+'|'+data.period.end+'|'+region+'|'+data.totals.accidents,
      label:rule.name,count:data.totals.accidents,at:new Date().toISOString(),periodEnd:data.period.end,source:'PBH · Sinistros com vítima',
    }));
    if(newEvents.some(event=>!events.some(existing=>existing.key===event.key))){
      setEvents([...newEvents.filter(event=>!events.some(existing=>existing.key===event.key)),...events].slice(0,100));
    }
  },[data,events,region,rules,setEvents]);

  const update=useCallback((changes:Record<string,string|null>,path=page)=>{
    const next=new URLSearchParams(search.toString());
    for(const [key,value] of Object.entries(changes)) value===null?next.delete(key):next.set(key,value);
    const query=next.toString();
    router.push('/'+path+(query?'?'+query:''),{scroll:false});
  },[page,router,search]);

  function navigationHref(href:string) {
    const url=new URL(href,'http://localhost');
    const next=new URLSearchParams();
    for(const key of ['start','end','region']) {const value=search.get(key);if(value)next.set(key,value);}
    for(const [key,value] of url.searchParams) next.set(key,value);
    return url.pathname+(next.size?'?'+next.toString():'');
  }
  function navigate(href:string) {
    const target=navigationHref(href);
    const path=target.split('?')[0];
    const changingPage=(path==='/'?'/visao-geral':path)!=='/'+page;
    if(mobile&&changingPage)focusNextHeading.current=true;
    closeMobile(mobile&&!changingPage);
    closePopup();
    setFocus(null);setClicked(null);setHistoryPeriod(null);
    router.push(target,{scroll:changingPage});
  }
  function follow(event:MouseEvent<HTMLAnchorElement>){
    if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
    event.preventDefault();
    navigate(event.currentTarget.pathname+event.currentTarget.search);
  }
  function prefetchNavigation(event:{currentTarget:HTMLAnchorElement}){
    const {pathname,search:query}=event.currentTarget;
    if(pathname!=='/'+page)router.prefetch(pathname+query);
  }
  function refresh() {setRefreshedDashboard(initialDashboard);setVersion(value=>value+1);setNotice('Consultando as fontes disponíveis…');}
  function changeLayer(id:string){
    const next=layers.includes(id)?layers.filter(layer=>layer!==id):[...layers,id];
    update({layers:next.join(','),...(id==='transit'&&!layers.includes(id)?{mode:'current'}:{})});
  }
  function selectFeature(feature:Feature){
    const id=featureId(feature),kind=feature.properties?.kind;
    const changes:Record<string,string|null>={selected:id,street:kind==='street'&&!feature.properties?.partialGeometry?id:null};
    if(kind==='route')changes.route=id;
    if(mapLayers.some(item=>item.id===kind)&&!layers.includes(kind))changes.layers=[...layers,kind].join(',');
    setClicked(feature);setFocus(null);
    update(changes);
  }
  function chooseHit(hit:Hit){
    const layer=hit.kind==='Linha programada'?'route':hit.kind==='Ponto de ônibus'?'stop':hit.kind==='Via'?'street':'neighborhood';
    const target=[...new Set([...(isMap?layers:defaultMapLayers),layer])];
    setClicked(null);setFocus(hit.lat!==undefined&&hit.lng!==undefined?[hit.lng,hit.lat]:null);
    update({selected:hit.id,layers:target.join(','),route:hit.route??null,street:hit.kind==='Via'?hit.id:null},'mapa');
    closePopup(true);setTerm('');
  }
  function localResults(term:string) {
    const normalized=term.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
    if(normalized.length<2)return [];
    return mapPayload.collection.features.filter(f=>['street','neighborhood'].includes(f.properties?.kind) &&
      String(f.properties?.name??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(normalized)).slice(0,8);
  }

  const mapNode=<MobilityMap layers={layers} collection={mapPayload.collection} selected={selected} focus={focus??(activeFeature&&!clicked?featureLocation(activeFeature):null)} onBoundsChange={setBounds} onLayersChange={isMap ? next=>update({layers:next.join(',')}):undefined}
    onSelect={isMap?selectFeature:(feature)=>navigate('/mapa?selected='+encodeURIComponent(featureId(feature)))} compact={!isMap} dark={theme==='dark'}/>;
  const localHits=!searching&&!hits.length ? localResults(term) : [];
  function chooseLocal(feature:Feature){
    chooseHit({id:featureId(feature),name:String(feature.properties?.name??''),kind:feature.properties?.kind==='street'?'Via':'Bairro'});
  }
  const HeaderSearch=<form className="search-block" role="search" aria-label="Busca global" onSubmit={event=>{
    event.preventDefault();
    if(!searching&&hits[0])chooseHit(hits[0]);
    else if(localHits[0])chooseLocal(localHits[0]);
  }}>
    <label className="search-field"><Search size={16} aria-hidden="true"/><input data-initial-focus type="search" aria-label="Buscar endereço, via, bairro ou linha" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Buscar via, bairro ou linha…" /></label>
    {term.trim().length>=2 && <div className="search-results" aria-busy={searching}>
      {searching?<p role="status">Buscando no catálogo…</p>:hits.map(hit=><button type="button" key={hit.kind+hit.id} onClick={()=>chooseHit(hit)}><span>{hit.name}</span><small>{hit.kind}</small></button>)}
      {localHits.map(feature=><button type="button" key={featureId(feature)} onClick={()=>chooseLocal(feature)}>{String(feature.properties?.name??'')}</button>)}
      {!searching&&!hits.length&&!localHits.length&&<p role="status">{searchRequest.error?'A busca está indisponível.':'Nenhum resultado no catálogo local.'}</p>}
    </div>}
  </form>;
  const dateLabel=data ? formatDate(data.period.start)+' – '+formatDate(data.period.end) : 'Período';

  return <div data-entry-motion={entryMotion} className={'urban '+(theme==='dark'?'dark ':'')+(collapsed&&!mobileViewport?'nav-collapsed':'')}>
    <a className="skip" href="#main" tabIndex={mobile?-1:undefined}>Pular para o conteúdo</a>
    {mobile&&<div className="nav-shade" onClick={()=>closeMobile()} aria-hidden="true"/>}
    <aside id="main-navigation" ref={sidebar} role={mobile?'dialog':undefined} aria-modal={mobile||undefined} inert={mobileViewport&&!mobile} className={'sidebar '+(mobile?'mobile-open':'')} aria-label="Navegação principal">
      <div className="branding"><Link href={navigationHref('/')} onClick={follow} className="brand-mark" aria-label="UrbanFlow início"><span className="brand-ring"/></Link><Link href={navigationHref('/')} onClick={follow} className="wordmark">UrbanFlow</Link></div>
      {mobile&&<button className="button icon close-navigation" data-close-navigation aria-label="Fechar navegação" onClick={()=>closeMobile()}><X size={19}/></button>}
      <nav aria-label="Espaço de trabalho"><p className="nav-caption">Espaço de trabalho</p>
        {pages.slice(0,-1).map(({id,label,icon:Icon})=><Link key={id} href={navigationHref('/'+id)} prefetch={false} onMouseEnter={prefetchNavigation} onFocus={prefetchNavigation} onClick={follow} title={label} aria-current={page===id?'page':undefined}><Icon size={18}/><span>{label}</span>{page===id&&<i/>}</Link>)}
      </nav>
      <div className="sidebar-bottom"><nav aria-label="Preferências"><p className="nav-caption">Preferências</p>
        <Link href={navigationHref('/configuracoes')} prefetch={false} onMouseEnter={prefetchNavigation} onFocus={prefetchNavigation} title="Configurações" aria-current={page==='configuracoes'?'page':undefined} onClick={follow}>{(()=>{const Icon=pages[7].icon;return <Icon size={18}/>;})()}<span>Configurações</span></Link>
      </nav><div className="profile"><div className="avatar">BH</div><div className="profile-label"><strong>Belo Horizonte</strong><small>Consulta pública</small></div><button aria-label={collapsed?'Expandir navegação':'Recolher navegação'} title={collapsed?'Expandir navegação':'Recolher navegação'} className="collapse-button" onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button></div></div>
    </aside>

    <main id="main" className="workspace" tabIndex={-1} inert={mobile}>
      <header className="topbar">
        <div className="heading">
          <button ref={opener} className="button icon mobile-menu" aria-label="Abrir navegação" aria-expanded={mobile} aria-controls="main-navigation" onClick={openMobile}><Menu size={20}/></button>
          <div><p className="breadcrumb">Plataforma / {isMap?'Mapa interativo':pageInfo.label}</p><h1 key={page} className="workspace-title" ref={heading} tabIndex={-1}>{pageInfo.title}</h1><p className="subtitle">{pageInfo.subtitle}</p></div>
        </div>
        <div className="toolbar">
          <div className="tool-anchor">
            <button className="button" {...trigger('city')}><MapIcon size={15}/> <span>Belo Horizonte, MG</span></button>
            {popup==='city'&&<div className="popover" {...panel('city')}><strong>Cidade disponível</strong><p>Belo Horizonte, MG</p><small>Fontes municipais e dados do Censo 2022.</small></div>}
          </div>
          <div className="tool-anchor">
            <button className="button period-button" {...trigger('period')}><CalendarDays size={15}/> <span>{dateLabel}</span></button>
            {popup==='period'&&<div className="popover date-pop" {...panel('period')}><strong>Selecionar período</strong>
              <PeriodForm initial={data?.period} onApply={value=>{update({start:value.start,end:value.end,selected:null,street:null});closePopup(true);}}/>
              {data&&<button className="text-button" onClick={()=>{update({start:null,end:null,selected:null,street:null});closePopup(true);}}>Restaurar período padrão</button>}
            </div>}
          </div>
          <a className="button primary export-top" href={isMap?'/api/export?'+mapQuery.toString()+'&format=geojson':'/relatorios?'+reportQuery.toString()}
            onClick={isMap?undefined:(event)=>{event.preventDefault();navigate('/relatorios');}}><ArrowDownToLine size={15}/><span>{isMap?'Exportar visualização':'Exportar relatório'}</span></a>
          <button className="button icon refresh-top" aria-label="Atualizar dados" title="Atualizar dados" aria-busy={version>0&&dash.pending} onClick={refresh}><RefreshCw size={15}/></button>
          <div className="tool-anchor">
            <button className="button icon" aria-label="Buscar" title="Buscar" {...trigger('search')}><Search size={17}/></button>
            {popup==='search'&&<div className="popover global-search" {...panel('search')}><div className="popover-head"><strong>Buscar em Belo Horizonte</strong><button className="quiet-icon" aria-label="Fechar busca" onClick={()=>closePopup(true)}><X size={16}/></button></div>{HeaderSearch}</div>}
          </div>
          <div className="tool-anchor">
            <button className="button icon" aria-label="Notificações" title="Notificações" {...trigger('notifications')}><Bell size={17}/>{events.length>0&&<span className="notification-dot"/>}</button>
            {popup==='notifications'&&<div className="popover notifications" {...panel('notifications')}><strong>Alertas publicados</strong>
              {events.length?events.slice(0,5).map(event=><div className="alert-row" key={event.key}><b>{event.label} · {event.count}</b><small>{event.source} · {alertDate(event)}</small></div>):<p>Nenhum alerta registrado neste dispositivo.</p>}
              <button className="text-button" onClick={()=>navigate('/configuracoes')}>Configurar alertas</button>
            </div>}
          </div>
        </div>
      </header>

      <div key={page} className="workspace-content">
      {dash.error&&<div className="status-strip alert-strip" role="alert"><TriangleAlert size={16}/> Falha ao consultar os dados. <button className="text-button" onClick={refresh}>Tentar novamente</button></div>}
      {!data&&!dash.error&&<div className="skeleton-layout" aria-busy="true" aria-label="Carregando dados"><div/><div/><div/><div/><section/></div>}
      {data&&compact&&<div className="status-strip"><Database size={15}/><strong>Dados abertos</strong><span>Prefeitura de Belo Horizonte · {dateLabel}</span></div>}
      {data&&compact&&<>
        <Overview data={data} onNavigate={navigate}/>
      </>}
      {data&&isMap&&<>
        <div className="map-toolbar"><div className="pills map-layer-pills" role="group" aria-label="Camadas rápidas">
          {mapLayers.slice(0,5).map(({id,label,icon:Icon})=><button key={id} className={'button '+(layers.includes(id)?'active':'')} onClick={()=>changeLayer(id)} aria-pressed={layers.includes(id)}><Icon size={15}/>{label}</button>)}
        </div><div className="pills map-tools">
          <button className="button map-mode" aria-label={mode==='current'?'Visualização atual':'Visualização histórica'} onClick={()=>update({mode:mode==='current'?'historical':'current',selected:null,street:null})}>
            <Clock3 size={15}/><span className="map-mode-full">{mode==='current'?'Visualização atual':'Visualização histórica'}</span><span className="map-mode-short" aria-hidden="true">{mode==='current'?'Atual':'Histórico'}</span>
          </button>
          <div className="tool-anchor"><button className="button" {...trigger('layers')}><Layers size={15}/> Camadas</button>{popup==='layers'&&<div className="popover layer-list" {...panel('layers')}><strong>Camadas do mapa</strong>{mapLayers.map(({id,label})=><label key={id}><input type="checkbox" checked={layers.includes(id)} onChange={()=>changeLayer(id)}/>{label}</label>)}</div>}</div>
          <div className="tool-anchor"><button className="button emph" {...trigger('filters')}><Filter size={15}/> Filtros {filterCount>0&&<span className="filter-count" aria-label={filterCount+' ativos'}>{filterCount}</span>}</button>{popup==='filters'&&<div className="popover filter-pop" {...panel('filters')}><div className="popover-head"><strong>Filtrar mapa</strong><button className="quiet-icon" aria-label="Fechar filtros" onClick={()=>closePopup(true)}><X size={16}/></button></div>
            <select aria-label="Regional principal" value={region} onChange={e=>update({region:e.target.value||null,selected:null})}><option value="">Todas as regionais</option>{(data.regionOptions??data.regions.map(r=>r.name)).map(name=><option key={name}>{name}</option>)}</select>
            <label htmlFor="compare-region">Comparar com</label><select id="compare-region" value={compareRegion} onChange={e=>{update({compareRegion:e.target.value||null});closePopup(true);}}><option value="">Sem comparação</option>{(data.regionOptions??data.regions.map(r=>r.name)).filter(name=>name!==region).map(name=><option key={name}>{name}</option>)}</select>
            <label htmlFor="incident-type">Tipo de sinistro</label><select id="incident-type" value={search.get('incidentType')??''} onChange={e=>update({incidentType:e.target.value||null,selected:null})}><option value="">Todos os tipos</option>{data.accidentTypes.map(type=><option key={type.label}>{type.label}</option>)}</select>
            <label htmlFor="incident-fatality">Fatalidade</label><select id="incident-fatality" value={search.get('fatal')??''} onChange={e=>update({fatal:e.target.value||null,selected:null})}><option value="">Todos os registros</option><option value="true">Fatalidade informada</option><option value="false">Sem fatalidade informada</option></select>
            {filterCount>0&&<button className="text-button" onClick={()=>{update({region:null,compareRegion:null,incidentType:null,fatal:null,selected:null,street:null});closePopup(true);}}>Limpar filtros</button>}
            <Link className="button compare-periods" href={'/analise-historica?'+reportQuery.toString()} onClick={follow}>Comparar períodos <ChevronRight size={15}/></Link>
          </div>}</div>
        </div></div>
        <div className="map-grid"><div className="main-map">{mapNode}
          {layerData.error&&<div className="map-message" role="alert">Camada indisponível. <button onClick={refresh}>Tentar novamente</button></div>}
          {layerData.pending&&<div className="map-loading" role="status">Atualizando camadas…</div>}
          {!!mapPayload.omittedAccidents&&<div className="map-message" role="status">O mapa prioriza os 8.000 sinistros mais recentes. Aproxime o mapa ou reduza o período para ver os demais.</div>}
        </div><aside className="map-details" aria-label="Detalhes do mapa">
          <section className="panel detail-panel">
            <div className="popover-head"><p className="eyebrow">{activeFeature?'Elemento selecionado':'Belo Horizonte, MG'}</p>{activeFeature&&<button className="quiet-icon" onClick={()=>{setFocus(null);setClicked(null);update({selected:null,street:null,route:activeFeature.properties?.kind==='route'?null:route||null});}} aria-label="Limpar seleção"><X size={16}/></button>}</div>
            <h2 aria-live="polite">{activeFeature ? String(activeFeature.properties?.name ?? 'Registro no mapa'):'Explore o mapa'}</h2>
            {activeFeature?<><FeatureDetails feature={activeFeature}/>{activeFeature.properties?.kind==='street'&&mode==='current'&&<RoadFlow key={featureId(activeFeature)} feature={activeFeature}/>}</>:<p className="muted">Selecione um trecho, uma parada ou um registro para consultar os detalhes.</p>}
            <div className="detail-divider"/>
            <div className="map-status"><span className={'chip '+(mapPayload.fresh?'positive':'')}>{layers.includes('transit')&&mode==='current'?(mapPayload.fresh?'Ônibus ao vivo':mapPayload.observedAt?'Posições atrasadas':layerData.pending?'Consultando GPS':'GPS indisponível'):mode==='historical'?'Histórico':'Camadas públicas'}</span>
              {mapPayload.observedAt&&<small>{formatTime(mapPayload.observedAt)}</small>}</div>
            <div className="detail-stats"><div><small>Sinistros com vítima</small><strong>{number.format(data.totals.accidents)}</strong></div><div><small>Linhas cadastradas</small><strong>{number.format(data.totals.routes)}</strong></div></div>
          </section>
          {layers.includes('traffic')&&data.totals.trafficCount===0&&<section className="panel detail-panel">
            <h3>Medições de trânsito</h3><p className="muted">Sem medições no período e na regional selecionados.</p>
            {data.trafficCoverage&&<button className="text-button coverage-shortcut" onClick={()=>{
              const end=data.trafficCoverage!.end;
              update({start:addDays(end,-29),end,mode:'historical',region:null,compareRegion:null,selected:null,street:null});
            }}>Abrir última janela de trânsito em BH <ChevronRight size={14}/></button>}
          </section>}
          {comparison&&<section className="panel detail-panel"><h3>Comparação regional</h3><p className="muted">Sinistros com vítima no mesmo período.</p><dl className="facts"><dt>{region||'Belo Horizonte'}</dt><dd>{number.format(data.totals.accidents)}</dd><dt>{compareRegion}</dt><dd>{number.format(comparison.totals.accidents)}</dd></dl></section>}
          <section className="panel detail-panel"><h3>Cobertura do mapa</h3><dl className="facts"><dt>Período em análise</dt><dd>{dateLabel}</dd><dt>Regional</dt><dd>{region||'Todas'}</dd><dt>Sinistros sem posição</dt><dd>{number.format(data.unmappedAccidents)}</dd></dl><button className="text-button" onClick={refresh}><RefreshCw size={14}/> Atualizar camadas</button></section>
          <section className="panel detail-panel"><h3>Sobre os dados</h3><div className="map-insight"><CircleHelp size={16}/> As posições ao vivo vêm do GPS dos ônibus. Consulte trânsito para ver medições das vias e o período coberto.</div><button className="text-button" onClick={()=>navigate('/configuracoes')}>Ver fontes <ChevronRight size={14}/></button></section>
        </aside></div>
      </>}
      {data&&analyticsPage&&<Analytics key={page} data={data} page={page} map={mapNode} onNavigate={navigate} selectedRoute={route} onSelectRoute={id=>update({route:id||null})} onHistoricalPeriod={setHistoryPeriod} region={region}/>}
      {data&&page==='relatorios'&&<Reports data={data} query={reportQuery} saved={saved} setSaved={setSaved} onOpen={href=>router.push(href)} onNotice={setNotice}/>}
      {data&&page==='configuracoes'&&<SettingsView sources={data.sources} theme={theme} setTheme={setTheme} entryMotion={entryMotion} setEntryMotion={setEntryMotion} rules={rules} setRules={setRules} events={events} refresh={refresh}/>}
      </div>
    </main>
    {notice&&<div className="toast" role="status">{notice}</div>}
  </div>;
}

function FeatureDetails({feature}:{feature:Feature}) {
  const p=feature.properties ?? {};
  const kindLabels:Record<string,string>={neighborhood:'Bairro',street:'Via',address:'Endereço oficial',traffic:'Medição histórica',accident:'Sinistro com vítima',transit:'Veículo observado',stop:'Parada programada',route:'Itinerário programado'};
  return <><p className="muted">{kindLabels[p.kind] ?? 'Camada cartográfica'}{p.region?' · '+p.region:''}</p>
    <dl className="facts">
      {p.date&&<><dt>Data do registro</dt><dd>{formatDate(p.date)}</dd></>}
      {p.hour!=null&&<><dt>Hora</dt><dd>{String(p.hour).padStart(2,'0')}h</dd></>}
      {p.observedAt&&<><dt>Data da posição</dt><dd>{formatTime(p.observedAt)}</dd></>}
      {typeof p.population==='number'&&<><dt>População · Censo 2022</dt><dd>{number.format(p.population)}</dd></>}
      {typeof p.value==='number'&&Number.isFinite(p.value)&&<><dt>{p.kind==='transit'?'Velocidade do ônibus':'Valor observado'}</dt><dd>{number.format(p.value)} {p.unit??'km/h'}</dd></>}
      {p.fatal===true&&<><dt>Fatalidade</dt><dd>Registrada</dd></>}
      {p.neighborhood&&<><dt>Bairro</dt><dd>{String(p.neighborhood)}</dd></>}
      {p.source&&<><dt>Fonte</dt><dd>{String(p.source)}</dd></>}
      {p.length!=null&&<><dt>Extensão</dt><dd>{number.format(Number(p.length))} m</dd></>}
    </dl></>;
}

function RoadFlow({feature}:{feature:Feature}){
  const [ask,setAsk]=useState(false);
  const center=featureLocation(feature);
  const url=ask&&center?'/api/flow?lng='+center[0]+'&lat='+center[1]:null;
  const request=useRequest<{status:string;flow?:{currentSpeed:number;freeFlowSpeed:number;currentTravelTime:number;confidence:number;roadClosure:boolean}}>(url,0);
  const value=request.data?.flow;
  if(!center)return null;
  return <div className="road-flow"><button className="text-button" onClick={()=>setAsk(true)}>Consultar fluxo rodoviário no ponto</button>
    {ask&&!request.data&&!request.error&&<p className="muted" role="status">Consultando…</p>}
    {ask&&(request.error||request.data?.status==='unavailable')&&<p className="muted">Sem medição disponível neste ponto.</p>}
    {request.data?.status==='unconfigured'&&<p className="muted">A fonte de fluxo rodoviário requer uma integração autorizada.</p>}
    {value&&<><p className="muted">Trecho mais próximo informado pela TomTom.</p><dl className="facts"><dt>Velocidade observada</dt><dd>{number.format(value.currentSpeed)} km/h</dd><dt>Fluxo livre de referência</dt><dd>{number.format(value.freeFlowSpeed)} km/h</dd><dt>Redução de velocidade</dt><dd>{number.format(100*Math.max(0,1-value.currentSpeed/value.freeFlowSpeed))}%</dd><dt>Tempo no trecho</dt><dd>{value.currentTravelTime} s</dd>{value.roadClosure&&<><dt>Interdição</dt><dd>Reportada</dd></>}</dl></>}
  </div>;
}

function PeriodForm({initial,onApply}:{initial?:Period;onApply:(range:Period)=>void}) {
  return <form className="period-form" onInput={event=>{
    (event.currentTarget.elements.namedItem('end') as HTMLInputElement).setCustomValidity('');
  }} onSubmit={event=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    const start=String(fields.get('start')),end=String(fields.get('end'));
    if(start<=end)onApply({start,end});
    else {
      const endField=event.currentTarget.elements.namedItem('end') as HTMLInputElement;
      endField.setCustomValidity('O fim deve ser igual ou posterior ao início.');
      endField.reportValidity();
    }
  }}><label>Início<input data-initial-focus type="date" name="start" required defaultValue={initial?.start}/></label>
    <label>Fim<input type="date" name="end" required defaultValue={initial?.end}/></label>
    <button className="button primary" type="submit">Aplicar período <ChevronDown size={14}/></button></form>;
}
