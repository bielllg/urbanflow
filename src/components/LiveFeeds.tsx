'use client';
import {useState} from 'react';
import type {RoadLive,TransitLive} from '@/lib/live-feeds';
import {Panel} from './ViewParts';

const clock=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const messages={unconfigured:'Fonte ainda sem configuração.',unavailable:'Fonte temporariamente indisponível.',stale:'A última atualização da fonte expirou.'};

export default function LiveFeeds({source}:{source:'road'|'transit'}){
  const road=source==='road';
  const [data,setData]=useState<RoadLive|TransitLive|null>(null);
  const [loading,setLoading]=useState(false);
  const [failed,setFailed]=useState(false);
  async function refresh(){
    setLoading(true);
    setFailed(false);
    try{
      const response=await fetch('/api/live?source='+source,{signal:AbortSignal.timeout(9000)});
      if(!response.ok) throw new Error('Fonte indisponível');
      setData(await response.json());
    }catch{setFailed(true);}
    finally{setLoading(false);}
  }
  return <Panel title={road?'Incidentes rodoviários atuais':'Operação em tempo real'}
    subtitle={road?'TomTom · área de consulta de Belo Horizonte e entorno':'GTFS Realtime · SUMOB'}
    action={<button className="uv-text-button" type="button" disabled={loading} onClick={refresh}>
      {loading?'Consultando…':data?'Atualizar':'Consultar agora'}
    </button>}>
    <div aria-live="polite" aria-busy={loading}>
      {failed&&<p className="uv-empty">Falha na consulta. Tente novamente.</p>}
      {data&&'items' in data&&(data.status==='current'?<>
        <p className="uv-empty">Consulta em {clock.format(new Date(data.checkedAt!))}.</p>
        {data.items.length?<ul className="uv-events">{data.items.map(item=><li key={item.id}><strong>{item.description}</strong>{item.location&&<p>{item.location}</p>}</li>)}</ul>:
          <p className="uv-empty">Nenhum incidente retornado pela fonte nesta consulta.</p>}
      </>:<p className="uv-empty">{messages[data.status]}</p>)}
      {data&&'alerts' in data&&<>
        <h3>Atualizações de viagem</h3>
        <p className="uv-empty">{data.updates.status==='current'
          ? data.updates.reported? `${data.updates.delayed} de ${data.updates.reported} viagens com atraso positivo informado na consulta de ${clock.format(new Date(data.updates.observedAt!))}.`:'O feed não informou atrasos por viagem nesta consulta.'
          : messages[data.updates.status]}</p>
        <h3>Alertas de serviço</h3>
        {data.alerts.status!=='current'?<p className="uv-empty">{messages[data.alerts.status]}</p>:
          data.alerts.items.length?<ul className="uv-events">{data.alerts.items.map(item=><li key={item.id}><strong>{item.title}</strong><p>{item.description}</p></li>)}</ul>:
          <p className="uv-empty">Nenhum alerta ativo retornado pela fonte.</p>}
      </>}
    </div>
  </Panel>;
}
