import type {PageId} from './pages';

export function dashboardQueryFor(page:PageId, search:URLSearchParams){
  const query=new URLSearchParams(search);
  for(const key of ['selected','route','mode','layers','street','compareRegion','incidentType','fatal']) query.delete(key);
  query.set('view',page==='relatorios'&&query.get('dataset')==='transito'?'transito':page);
  query.sort();
  return query;
}
