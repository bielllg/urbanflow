import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addDays,byAccidentHour,byTraffic,measuredSpeed,previousPeriod,readPeriod,validDay,within,withinSortedDates} from '../src/lib/metrics.ts';

test('valida datas de calendário e mantém limites inclusivos da interface',()=>{
  assert.equal(validDay('2024-02-29'),true);
  assert.equal(validDay('2026-02-29'),false);
  assert.equal(validDay('2026-2-01'),false);
  assert.equal(addDays('2024-02-29',1),'2024-03-01');
  const period={start:'2024-02-27',end:'2024-02-29'};
  assert.deepEqual(previousPeriod(period),{start:'2024-02-24',end:'2024-02-26'});
  assert.deepEqual(readPeriod(new URLSearchParams({start:'2024-03-01',end:'2024-02-01'}),period),period);
  assert.equal(within([{date:'2024-02-27'},{date:'2024-02-29'},{date:'2024-03-01'}],period).length,2);
});

test('distingue sinistros sem hora da contagem observada igual a zero',()=>{
  assert.equal(byAccidentHour([{hour:null}])[0].value,null);
  const values=byAccidentHour([{hour:12},{hour:12},{hour:null}]);
  assert.equal(values[0].value,0);
  assert.equal(values[12].value,2);
});

test('a busca indexada preserva todos os registros nas datas de início e fim',()=>{
  const rows=['2024-02-26','2024-02-27','2024-02-27','2024-02-29','2024-02-29','2024-03-01'].map((date,id)=>({date,id}));
  for(const period of [
    {start:'2024-02-27',end:'2024-02-29'},
    {start:'2024-02-28',end:'2024-02-28'},
    {start:'2020-01-01',end:'2030-01-01'},
  ]){
    assert.deepEqual(withinSortedDates(rows,period),within(rows,period));
  }
});

test('mantém lacunas das medições e preserva contagem real igual a zero',()=>{
  assert.deepEqual(byTraffic([{road:'A',volume:0}],['A','B'],row=>row.road,'volume'),[
    {label:'A',value:0},{label:'B',value:null},
  ]);
});

test('agrega velocidade amostral pela razão de distância e tempo totais',()=>{
  const rows=[{road:'A',speed:36,distanceMeters:1000,durationSeconds:100},{road:'A',speed:72,distanceMeters:6000,durationSeconds:300}];
  assert.equal(measuredSpeed(rows),63);
  assert.deepEqual(byTraffic(rows,['A'],row=>row.road,'speed'),[{label:'A',value:63}]);
  assert.equal(measuredSpeed([]),null);
});
