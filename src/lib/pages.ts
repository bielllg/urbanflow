import {House,Map,TrendingUp,TriangleAlert,BusFront,ChartNoAxesCombined,FileText,Settings} from 'lucide-react';

export const pages=[
  {id:'visao-geral',label:'Visão geral',title:'Visão geral da mobilidade',subtitle:'Acompanhe os indicadores de mobilidade de Belo Horizonte.',icon:House},
  {id:'mapa',label:'Mapa ao vivo',title:'Mapa de mobilidade',subtitle:'Explore vias, sinistros e transporte público por região.',icon:Map},
  {id:'transito',label:'Trânsito',title:'Análise de trânsito',subtitle:'Consulte as medições disponíveis nos corredores e vias monitoradas.',icon:TrendingUp},
  {id:'acidentes',label:'Acidentes',title:'Segurança viária',subtitle:'Explore os registros de sinistros de trânsito com vítima em Belo Horizonte.',icon:TriangleAlert},
  {id:'transporte-publico',label:'Transporte público',title:'Transporte público',subtitle:'Consulte itinerários, pontos e viagens programadas do transporte municipal.',icon:BusFront},
  {id:'analise-historica',label:'Análise histórica',title:'Análise histórica',subtitle:'Compare recortes e identifique padrões nos registros de mobilidade.',icon:ChartNoAxesCombined},
  {id:'relatorios',label:'Relatórios',title:'Relatórios de mobilidade',subtitle:'Exporte registros e indicadores com o recorte e a metodologia de cada fonte.',icon:FileText},
  {id:'configuracoes',label:'Configurações',title:'Configurações',subtitle:'Gerencie preferências e acompanhe a disponibilidade das fontes.',icon:Settings},
] as const;
export type PageId=typeof pages[number]['id'];
export function isPage(value:string):value is PageId { return pages.some(page=>page.id===value); }
