import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import axe from 'axe-core';

const root=process.env.URBANFLOW_TEST_URL ?? 'http://127.0.0.1:3000';
const routes=['/','/mapa','/transito','/acidentes','/transporte-publico','/analise-historica','/relatorios','/configuracoes'];
const rules=['wcag2a','wcag2aa','wcag21a','wcag21aa'];
const browser=await chromium.launch({args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},bypassCSP:true,reducedMotion:'reduce'});
  for(const route of routes){
    await page.goto(root+route);
    await page.locator('main h2').first().waitFor();
    await page.addScriptTag({content:axe.source});
    const violations=await page.evaluate(async tags=>{
      const result=await window.axe.run({runOnly:{type:'tag',values:tags}});
      return result.violations.map(({id,nodes})=>({id,targets:nodes.map(node=>node.target)}));
    },rules);
    assert.deepEqual(violations,[],route);
  }
  await page.goto(root+'/');
  const motion=await page.locator('.workspace-title').evaluate(element=>getComputedStyle(element).animationName);
  assert.equal(motion,'none','A preferência de movimento reduzido deve ser respeitada na primeira visita');
  console.log('Axe WCAG 2.1 A/AA e preferência por movimento reduzido verificados nas telas principais.');
}finally{
  await browser.close();
}
