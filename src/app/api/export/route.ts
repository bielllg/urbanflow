import PDFDocument from 'pdfkit';
import {dashboard,exportRows,mapData} from '@/lib/data';
import {invalidQuery,queryTooLong} from '@/lib/http';

export const runtime='nodejs';

function csvValue(value:unknown) {
  const input=value==null ? '' : String(value);
  const safe=typeof value==='string' && /^[\s]*[=+\-@]/.test(input) ? "'"+input : input;
  return '"'+safe.replaceAll('"','""')+'"';
}

function textStream(parts:Iterable<string>){
  const encoder=new TextEncoder();
  const iterator=parts[Symbol.iterator]();
  return new ReadableStream<Uint8Array>({
    pull(controller){
      let batch='';
      for(let index=0;index<128;index++){
        const next=iterator.next();
        if(next.done){
          if(batch)controller.enqueue(encoder.encode(batch));
          controller.close();
          return;
        }
        batch+=next.value;
      }
      controller.enqueue(encoder.encode(batch));
    },
  });
}

function csvResponse(rows:Iterable<unknown[]>,filename:string) {
  function* lines(){
    yield '\uFEFF';
    for(const row of rows) yield row.map(csvValue).join(';')+'\r\n';
  }
  return new Response(textStream(lines()),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'private, no-store'}});
}

export async function GET(request:Request) {
  if(queryTooLong(request)) return invalidQuery();
  const query=new URL(request.url).searchParams;
  const format=query.get('format') ?? 'csv';
  if(format==='geojson'){
    const {collection,observedAt}=await mapData(query,{exporting:true});
    function* geojson(){
      yield '{"type":"FeatureCollection","attribution":"Prefeitura de Belo Horizonte · BHGeo / BHTRANS / SUMOB","observedAt":'+JSON.stringify(observedAt)+',"features":[';
      for(const [index,feature] of collection.features.entries()) yield (index?',':'')+JSON.stringify(feature);
      yield ']}';
    }
    return new Response(textStream(geojson()),{headers:{'Content-Disposition':'attachment; filename="urbanflow-mapa.geojson"','Content-Type':'application/geo+json; charset=utf-8','Cache-Control':'private, no-store'}});
  }
  if(format==='series'){
    const range=await dashboard(query);
    const metric=query.get('series');
    const series=metric==='speed'?range.trafficSpeedMonths:metric==='volume'?range.trafficVolumeMonths:range.accidentMonths;
    const label=metric==='speed'?'Velocidade amostral (km/h)':metric==='volume'?'Volume medido (veículos)':'Sinistros com vítima (boletins)';
    const rows=[['Fonte','Prefeitura de Belo Horizonte'],['Área',query.get('region')||'Belo Horizonte, MG'],['Período',range.period.start,range.period.end],['Mês',label],...series.map(point=>[point.label,point.value])];
    return csvResponse(rows,'urbanflow-serie.csv');
  }
  if(!['csv','pdf'].includes(format)) return new Response('Formato inválido',{status:400});
  const traffic=query.get('dataset')==='transito';
  if(traffic) query.set('view','transito');
  const {range,records}=await exportRows(query);
  const label=traffic?'Medições de trânsito':'Sinistros de trânsito com vítima';
  const source=traffic?'SUMOB · Contagens volumétricas / Velocidade nos corredores':'PBH · Ocorrência Sinistro Trânsito com Vítima';
  const area=query.get('region')?.trim() || 'Belo Horizonte, MG';
  const period=range.period.start+' a '+range.period.end;
  const coverage=traffic?range.trafficCoverage:range.coverage;
  const coverageText=coverage?coverage.start+' a '+coverage.end:'Indisponível';
  const methodology=traffic?'Velocidade em km/h quando medida. Volume em veículos contabilizados pelos equipamentos disponíveis.':
    'Boletins únicos de sinistros com vítima. Coordenadas disponíveis somente nos boletins georreferenciados.';
  if(format==='csv'){
    const heading=traffic?['ID','Data','Hora','Regional','Via','Velocidade (km/h)','Volume (veículos)']:['ID','Data','Hora','Regional','Tipo','Fatal','Latitude','Longitude'];
    function* rows(){
      yield* [['UrbanFlow',label],['Área',area],['Período',period],['Fonte',source],['Cobertura da fonte',coverageText],['Metodologia',methodology],[],heading];
      for(const r of records) yield 'road' in r ? [r.id,r.date,r.hour,r.region,r.road,r.speed,r.volume] : [r.id,r.date,r.hour,r.region,r.type,r.fatal,r.lat,r.lng];
    }
    return csvResponse(rows(),'urbanflow-relatorio.csv');
  }
  const doc=new PDFDocument({size:'A4',margin:48,info:{Title:'UrbanFlow - '+label,Author:'UrbanFlow'}});
  const finished=new Promise<Buffer>((resolve,reject)=>{
    const chunks:Buffer[]=[];
    doc.on('data',(chunk:Buffer)=>chunks.push(chunk));
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.on('error',reject);
  });
  doc.fillColor('#126B79').font('Helvetica-Bold').fontSize(13).text('UrbanFlow');
  doc.moveDown().fillColor('#18252b').fontSize(23).text(label);
  doc.moveDown(0.5).font('Helvetica').fontSize(10).fillColor('#52646c').text(area+'  |  '+period).text('Fonte: '+source).text('Cobertura da fonte: '+coverageText);
  doc.moveDown().fillColor('#18252b').font('Helvetica-Bold').fontSize(15).text(records.length.toLocaleString('pt-BR')+' registros no recorte');
  doc.moveDown(0.6).font('Helvetica').fontSize(10).text(methodology);
  doc.moveDown();
  for(const [index,record] of records.slice(0,100).entries()){
    doc.fontSize(9).fillColor('#18252b').text(
      (index+1)+'. '+record.date+'  •  '+record.region+'  •  '+('road' in record ? record.road : record.type),
    );
  }
  if(records.length>100) doc.moveDown().fillColor('#52646c').text('Amostra de até 100 registros. O CSV contém o recorte completo.');
  doc.end();
  return new Response(new Uint8Array(await finished),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="urbanflow-relatorio.pdf"','Cache-Control':'private, no-store'}});
}
