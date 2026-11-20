import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {join} from 'node:path';

const root=process.env.URBANFLOW_TEST_URL ?? 'http://127.0.0.1:3000';
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true});
const failures=[];
page.on('pageerror',error=>failures.push(error.message));
try{
  for(const path of ['visao-geral','mapa','transito','acidentes','transporte-publico','analise-historica','relatorios','configuracoes']){
    const response=await page.goto(root+'/'+path,{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200,path);
    await page.locator('h1').waitFor();
    await page.locator('[aria-busy=true]').waitFor({state:'hidden',timeout:20_000});
  }
  await page.getByRole('button',{name:'Escuro',exact:true}).click();
  assert.equal(await page.locator('.urban').evaluate(node=>node.classList.contains('dark')),true);
  await page.reload();
  await page.locator('.urban.dark').waitFor();
  await page.getByRole('button',{name:'Claro',exact:true}).click();

  await page.setViewportSize({width:1080,height:900});
  await page.getByRole('button',{name:'Recolher navegação',exact:true}).click();
  await page.locator('.nav-collapsed').waitFor();
  await page.evaluate(()=>{
    window.sidebarWidths=[];
    const sample=()=>{
      const sidebar=document.querySelector('.sidebar');
      if(sidebar)window.sidebarWidths.push(sidebar.getBoundingClientRect().width);
    };
    window.sidebarObserver=new MutationObserver(sample);
    window.sidebarObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    sample();
  });
  await page.locator('.sidebar a[href="/relatorios"]').click();
  await page.locator('.sidebar a[href="/relatorios"][aria-current=page]').waitFor();
  assert.deepEqual(await page.evaluate(()=>{
    window.sidebarObserver.disconnect();
    return [...new Set(window.sidebarWidths)];
  }),[82]);
  await page.getByRole('button',{name:'Expandir navegação',exact:true}).click();
  assert.equal(await page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().width),242);
  await page.setViewportSize({width:1600,height:1000});

  await page.goto(root+'/transito');
  await page.getByText(/1–15 de [\d.]+ registros/).waitFor();
  await page.getByRole('button',{name:'Próxima página'}).click();
  await page.getByText(/16–30 de [\d.]+ registros/).waitFor();
  const historicalTransit=await (await page.request.get(root+'/api/dashboard?view=transporte-publico&start=2000-01-01&end=2000-01-02')).json();
  assert.equal(historicalTransit.totals.plannedTrips,null);

  await page.goto(root+'/mapa');
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
  const search=page.getByPlaceholder('Buscar via, bairro ou linha…');
  await search.fill('Afonso Pena');
  await page.getByRole('button',{name:/Afonso Pena/i}).first().click();
  await page.locator('.detail-panel h2').filter({hasText:/Afonso Pena/i}).waitFor();
  await page.reload();
  await page.locator('.detail-panel h2').filter({hasText:/Afonso Pena/i}).waitFor();
  const [geojson]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Exportar visualização'}).click()]);
  assert.match(geojson.suggestedFilename(),/\.geojson$/);
  if(process.env.URBANFLOW_TEST_ADDRESSES==='1'){
    await page.getByRole('button',{name:'Buscar',exact:true}).click();
    await page.getByPlaceholder('Buscar via, bairro ou linha…').fill('Av. Afonso Pena, 1212');
    await page.getByRole('button',{name:/Afonso Pena, 1212/i}).first().click();
    await page.locator('.detail-panel h2').filter({hasText:/Afonso Pena, 1212/i}).waitFor();
  }

  await page.goto(root+'/relatorios?start=2024-08-01&end=2024-08-07');
  const [csv]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Baixar CSV'}).click()]);
  assert.match(csv.suggestedFilename(),/\.csv$/);
  const [pdf]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Baixar PDF'}).click()]);
  assert.match(pdf.suggestedFilename(),/\.pdf$/);
  const pdfBody=await (await page.request.get(root+'/api/export?format=pdf&start=2024-08-01&end=2024-08-07')).body();
  assert.equal(pdfBody.subarray(0,4).toString(),'%PDF');
  const records=await (await page.request.get(root+'/api/records?dataset=transito&start=2021-08-01&end=2021-08-31&page=100')).json();
  assert.ok(records.total>1000);
  assert.equal(records.page,100);
  assert.equal(records.rows.length,15);
  const series=await (await page.request.get(root+'/api/export?format=series&series=volume&start=2021-08-01&end=2021-08-31')).text();
  assert.match(series,/"2021-08";"\d+"/);

  await page.setViewportSize({width:768,height:1024});
  await page.goto(root+'/visao-geral');
  await page.getByRole('heading',{name:'Visão geral da mobilidade'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);

  await page.setViewportSize({width:320,height:760});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(root+'/acidentes');
  await page.locator('.uv-view').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  const nav=page.locator('#main-navigation');
  await page.waitForFunction(()=>document.getElementById('main-navigation').inert);
  const navOpen=page.getByRole('button',{name:'Abrir navegação'});
  await navOpen.click();
  await page.getByRole('dialog',{name:'Navegação principal'}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Fechar navegação');
  assert.equal(await page.locator('main').evaluate(element=>element.inert),true);
  await nav.getByRole('link',{name:'Configurações',exact:true}).focus();
  await page.keyboard.press('Tab');
  assert.equal(await nav.getByRole('link',{name:'UrbanFlow início'}).evaluate(element=>element===document.activeElement),true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Abrir navegação');

  await page.goto(root+'/mapa');
  await page.locator('.map-toolbar').waitFor();
  for(const name of ['city','period','filters','layers','search','notifications']){
    await page.locator('#open-'+name).click();
    const panel=page.locator('#panel-'+name);
    await panel.waitFor();
    assert.equal(await panel.evaluate(element=>{
      const {left,right}=element.getBoundingClientRect();
      return left>=0&&right<=innerWidth&&getComputedStyle(element).animationName==='none';
    }),true,name);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#open-'+name).evaluate(element=>element===document.activeElement),true,name);
  }
  await page.getByRole('button',{name:'Trânsito',exact:true}).click();
  await page.getByRole('button',{name:'Abrir última janela de trânsito em BH'}).click();
  await page.waitForURL(url=>url.searchParams.get('mode')==='historical'&&url.searchParams.has('start'));
  await page.getByRole('button',{name:'Visualização histórica',exact:true}).waitFor();
  await page.emulateMedia({reducedMotion:'no-preference'});

  await page.setViewportSize({width:390,height:844});
  await page.goto(root+'/visao-geral');
  await page.getByRole('button',{name:'Abrir navegação'}).click();
  await page.getByRole('link',{name:'Mapa ao vivo',exact:true}).click();
  await page.getByRole('heading',{name:'Mapa de mobilidade',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  const overviewRequest=url=>url.pathname==='/api/dashboard' && url.searchParams.get('view')==='visao-geral';
  let overviewQueries=0;
  await page.route(overviewRequest,route=>{
    overviewQueries++;
    return route.fulfill({status:503});
  });
  await page.goto(root+'/visao-geral');
  const accidentsIndicator=page.getByRole('heading',{name:'Sinistros com vítima',exact:true});
  await accidentsIndicator.waitFor();
  assert.equal(overviewQueries,0,'a tela usa os indicadores que já vieram do servidor');
  await page.getByRole('button',{name:'Atualizar dados',exact:true}).click();
  const dashboardError=page.getByRole('alert').filter({hasText:'Falha ao consultar os dados.'});
  await dashboardError.waitFor();
  assert.equal(overviewQueries,1);
  await page.unroute(overviewRequest);
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  await dashboardError.waitFor({state:'hidden'});
  await accidentsIndicator.waitFor();
  assert.deepEqual(failures,[]);
  if(process.env.URBANFLOW_SCREENSHOTS){
    await page.setViewportSize({width:1600,height:1000});
    await page.locator('.maplibregl-canvas').waitFor();
    await page.waitForTimeout(2000);
    await page.screenshot({path:join(process.env.URBANFLOW_SCREENSHOTS,'urbanflow-visao-geral.png'),fullPage:true});
    await page.goto(root+'/mapa');
    await page.locator('.maplibregl-canvas').waitFor();
    await page.waitForTimeout(2000);
    await page.screenshot({path:join(process.env.URBANFLOW_SCREENSHOTS,'urbanflow-mapa.png'),fullPage:true});
  }
  console.log('8 rotas, paginação, GTFS, tema persistente, busca, filtros, downloads, responsividade e recuperação após falha verificados.');
}finally{await browser.close();}
