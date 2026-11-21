'use client';
import {useCallback,useEffect,useState,useSyncExternalStore} from 'react';
import {ArrowDownToLine,ArrowUpRight,Bell,Bookmark,Database,FileSpreadsheet,FileText,Moon,Plus,RefreshCw,Sun,Trash2} from 'lucide-react';
import type {DashboardData,Source} from '@/lib/types';

export type SavedReport={id:string;name:string;query:string};
type EntryMotion='system'|'on'|'off';
const appearanceEvent='urbanflow:appearance-change';
const appearanceFallbacks={theme:'light',sidebar:false,entryMotion:'system' as EntryMotion};
const sessionAppearance={...appearanceFallbacks};
const isAppearanceValue={
  theme:(value:unknown)=>value==='dark'||value==='light',
  sidebar:(value:unknown)=>typeof value==='boolean',
  entryMotion:(value:unknown)=>value==='system'||value==='on'||value==='off',
};

function subscribeAppearance(notify:()=>void){
  window.addEventListener(appearanceEvent,notify);
  window.addEventListener('storage',notify);
  return ()=>{
    window.removeEventListener(appearanceEvent,notify);
    window.removeEventListener('storage',notify);
  };
}

type Appearance = typeof appearanceFallbacks;
export function useWorkspaceAppearance<Key extends keyof Appearance>(key:Key):[Appearance[Key],(value:Appearance[Key])=>void]{
  const storageKey='urbanflow:'+key;
  const value=useSyncExternalStore(subscribeAppearance,()=>{
    try {
      const saved=localStorage.getItem(storageKey);
      if(saved===null)return appearanceFallbacks[key];
      const parsed:unknown=JSON.parse(saved);
      if(isAppearanceValue[key](parsed))return parsed as Appearance[Key];
    } catch {
      return sessionAppearance[key];
    }
    return appearanceFallbacks[key];
  },()=>appearanceFallbacks[key]);
  return [value,next=>{
    sessionAppearance[key]=next;
    try { localStorage.setItem(storageKey,JSON.stringify(next)); } catch {}
    window.dispatchEvent(new Event(appearanceEvent));
  }];
}
export type AlertRule={id:string;name:string;limit:number};
export type AlertEvent={key:string;label:string;count:number;at:string;source:string;periodEnd?:string};

export function alertDate(event:AlertEvent) {
  return event.periodEnd ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(event.at)) : event.at.split('-').reverse().join('/');
}

export function useLocalValue<T>(key:string,fallback:T):[T,(value:T)=>void] {
  const storageKey='urbanflow:'+key;
  const [value,setValue]=useState<T>(fallback);
  useEffect(()=>{
    try {
      const stored=window.localStorage.getItem(storageKey);
      if(stored!==null) {
        const parsed=JSON.parse(stored) as T;
        queueMicrotask(()=>setValue(parsed));
      }
    }catch{}
  },[storageKey]);
  const save=useCallback((next:T)=>{
    setValue(next);
    try { window.localStorage.setItem(storageKey,JSON.stringify(next)); }catch{}
  },[storageKey]);
  return [value,save];
}

export function Reports({data,query,saved,setSaved,onOpen,onNotice}:{data:DashboardData;query:URLSearchParams;saved:SavedReport[];setSaved:(value:SavedReport[])=>void;onOpen:(href:string)=>void;onNotice:(notice:string)=>void}) {
  const [label,setLabel]=useState('');
  const dataset=query.get('dataset')==='transito'?'transito':'acidentes';
  const area=query.get('region')??'';
  function reportQuery(changes:Record<string,string>={}) {
    const params=new URLSearchParams(query);
    params.set('dataset',dataset);
    for(const [key,value] of Object.entries(changes))value?params.set(key,value):params.delete(key);
    return params.toString();
  }
  function change(changes:Record<string,string>){onOpen('/relatorios?'+reportQuery(changes));}
  const traffic=dataset==='transito';
  return <div className="utility-layout">
    <section className="panel utility-panel"><div className="section-title"><div className="section-icon"><FileText size={19}/></div><div><h2>Gerar relatório</h2><p>Escolha a base e a área do recorte.</p></div></div>
      <div className="form-grid">
        <label>Base de dados<select value={dataset} onChange={e=>change({dataset:e.target.value,start:'',end:''})}><option value="acidentes">Sinistros de trânsito com vítima</option><option value="transito">Medições de trânsito</option></select></label>
        <label>Regional<select value={area} onChange={e=>change({region:e.target.value})}><option value="">Belo Horizonte · todas</option>{[...new Set([...(data.regionOptions??data.regions.map(row=>row.name)),...(area?[area]:[])])].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(name=><option key={name}>{name}</option>)}</select></label>
      </div>
      <div className="report-summary"><div><small>Registros no recorte</small><strong>{(traffic?data.totals.trafficCount:data.totals.accidents).toLocaleString('pt-BR')}</strong></div><div><small>Período</small><b>{data.period.start.split('-').reverse().join('/')} a {data.period.end.split('-').reverse().join('/')}</b></div></div>
      <div className="utility-actions">
        <a className="button primary" href={'/api/export?'+reportQuery({format:'pdf'})}><ArrowDownToLine size={16}/> Baixar PDF</a>
        <a className="button" href={'/api/export?'+reportQuery({format:'csv'})}><FileSpreadsheet size={16}/> Baixar CSV</a>
      </div>
    </section>
    <section className="panel utility-panel"><div className="section-title"><div className="section-icon"><Bookmark size={18}/></div><div><h2>Análises salvas</h2><p>Reabra seus filtros neste dispositivo.</p></div></div>
      <form className="inline-form" onSubmit={e=>{e.preventDefault();const name=label.trim();if(!name)return;setSaved([{id:crypto.randomUUID(),name,query:reportQuery()},...saved].slice(0,30));setLabel('');onNotice('Análise salva neste dispositivo.');}}>
        <label className="sr-only" htmlFor="report-name">Nome da análise</label><input id="report-name" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Nome da análise" maxLength={70} required/>
        <button className="button emph" type="submit"><Plus size={15}/> Salvar</button>
      </form>
      {saved.length?<div className="saved-list">{saved.map(item=><div className="saved-row" key={item.id}><button className="text-button" onClick={()=>onOpen('/relatorios?'+item.query)}>{item.name}<ArrowUpRight size={14}/></button><button className="quiet-icon" aria-label={'Remover '+item.name} onClick={()=>setSaved(saved.filter(report=>report.id!==item.id))}><Trash2 size={15}/></button></div>)}</div>:<p className="utility-empty">Nenhum relatório salvo.</p>}
    </section>
  </div>;
}

export function SettingsView({sources,theme,setTheme,entryMotion,setEntryMotion,rules,setRules,events,refresh}:{sources:Source[];theme:string;setTheme:(theme:string)=>void;entryMotion:EntryMotion;setEntryMotion:(value:EntryMotion)=>void;rules:AlertRule[];setRules:(rules:AlertRule[])=>void;events:AlertEvent[];refresh:()=>void}) {
  return <div className="settings-grid">
    <section className="panel utility-panel"><div className="section-title"><div className="section-icon"><Sun size={18}/></div><div><h2>Aparência</h2><p>Preferências desta sessão e deste dispositivo.</p></div></div>
      <div className="utility-actions"><button className={'button '+(theme==='light'?'active':'')} onClick={()=>setTheme('light')} aria-pressed={theme==='light'}><Sun size={15}/> Claro</button><button className={'button '+(theme==='dark'?'active':'')} onClick={()=>setTheme('dark')} aria-pressed={theme==='dark'}><Moon size={15}/> Escuro</button></div>
      <label className="entry-motion-setting">Animações de entrada
        <select value={entryMotion} onChange={event=>setEntryMotion(event.target.value as EntryMotion)}>
          <option value="system">Seguir sistema</option>
          <option value="on">Ativadas no Via Viva</option>
          <option value="off">Desativadas</option>
        </select>
      </label>
    </section>
    <section className="panel utility-panel row-span"><div className="section-title"><div className="section-icon"><Database size={18}/></div><div><h2>Fontes de dados</h2><p>Disponibilidade e proveniência das importações.</p></div><button className="button icon" aria-label="Atualizar lista de fontes" onClick={refresh}><RefreshCw size={16}/></button></div>
      <div className="source-list">{sources.map(source=><article key={source.id}>
        <div><a href={source.url} target="_blank" rel="noreferrer">{source.name} <ArrowUpRight size={13}/></a><span className={'chip '+(source.status==='available'?'positive':'')}>{source.status==='available'?'Disponível':'Indisponível'}</span></div>
        {source.coverage&&<p>{source.coverage}</p>}{source.detail&&<p>{source.detail}</p>}
        <small>{[source.license,source.observedAt&&'Última observação '+source.observedAt,source.importedAt&&'Importação '+source.importedAt].filter(Boolean).join(' · ')}</small>
      </article>)}</div>
    </section>
    <section className="panel utility-panel"><div className="section-title"><div className="section-icon"><Bell size={18}/></div><div><h2>Alertas de análise</h2><p>Registre quando um recorte atingir o limite de sinistros publicados.</p></div></div>
      <form className="alert-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,fields=new FormData(form),name=String(fields.get('name')).trim(),limit=Number(fields.get('limit'));if(!name||!Number.isInteger(limit)||limit<1||limit>999999||rules.length>=30)return;setRules([...rules,{id:crypto.randomUUID(),name,limit}]);form.reset();}}>
        <label>Nome<input name="name" placeholder="Ex. Limite no período" maxLength={60} required/></label><label>Limite<input name="limit" type="number" min={1} max={999999} required/></label>
        <button className="button primary" type="submit" disabled={rules.length>=30}><Plus size={15}/> Criar alerta</button>
      </form>
      {rules.map(rule=><div className="saved-row" key={rule.id}><b>{rule.name} · {rule.limit.toLocaleString('pt-BR')}</b><button className="quiet-icon" aria-label={'Remover '+rule.name} onClick={()=>setRules(rules.filter(item=>item.id!==rule.id))}><Trash2 size={15}/></button></div>)}
      <h3 className="subhead">Histórico neste dispositivo</h3>
      {events.length?events.slice(0,8).map(event=><div className="alert-row" key={event.key}><b>{event.label} · {event.count}</b><small>{event.source} · {alertDate(event)}</small></div>):<p className="utility-empty">Nenhum alerta disparado.</p>}
    </section>
  </div>;
}
