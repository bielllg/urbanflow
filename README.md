# UrbanFlow

Plataforma de mobilidade urbana de Belo Horizonte. A interface inclui visão geral, mapa, trânsito, sinistros, transporte público, análise histórica, relatórios e configurações.

## Executar

```powershell
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Abra [UrbanFlow](http://127.0.0.1:3000). O modo padrão lê os snapshots reais incluídos em `data/`. O mapa-base e a posição de ônibus dependem de conexão com os respectivos serviços. Use a camada **Ônibus ao vivo** para consultar a posição e o timestamp do feed municipal.

## Atualizar as fontes

```powershell
python -m pip install -r scripts/requirements.txt
python -X utf8 scripts/ingest.py
```

A ingestão é independente do servidor web e preserva o último arquivo válido quando a aquisição falha. O workflow **Atualizar dados oficiais** importa o GTFS nas segundas, quartas e sextas e aceita outras fontes sob demanda. Só envia o snapshot ao GitHub após validar a fonte e executar os testes e o build. O projeto na Vercel precisa estar vinculado ao repositório para que esses commits atualizem o site automaticamente. A atualização na interface relê os snapshots publicados e consulta novamente os feeds das camadas ativas.

## Publicar em PostgreSQL/PostGIS

O armazenamento em arquivos permite rodar o projeto em uma máquina sem servidor de banco. Para publicar os snapshots transacionalmente em PostGIS, use uma instância com a extensão disponível ou o serviço local de Compose.

```powershell
docker compose up -d db
$env:DATABASE_URL = 'postgres://urbanflow:urbanflow-local@127.0.0.1:5432/urbanflow'
node scripts/publish.mjs
npm run dev -- --hostname 127.0.0.1 --port 3000
```

O publicador aplica a migração de `db/`, grava os snapshots e indexa geometrias de bairros e vias. Sempre republique após uma importação se utilizar o banco. Defina credenciais próprias em ambiente compartilhado. Veja as variáveis disponíveis em `.env.example`.

## Cobertura e metodologia

| Camada | Cobertura do material incluído |
| --- | --- |
| Sinistros com vítima | 207.455 boletins distintos entre 2011 e 31/08/2026. 123.491 boletins têm coordenadas. Derivados de [boletins BHTRANS](https://dados.pbh.gov.br/dataset/relacao-de-ocorrencias-de-acidentes-de-transito-com-vitima) e da [camada municipal](https://dados.pbh.gov.br/dataset/ocorrencia-sinistro-transito-com-vitima). |
| Território e população | 490 bairros com população residente do Censo 2022 e 56.354 trechos de logradouros. Dados [BHGeo](https://prefeitura.pbh.gov.br/prodabel/bhgeo) e [População e Domicílio por Bairro](https://dados.pbh.gov.br/dataset/pop-domic-bairro-2022). |
| Radares | 65 equipamentos com contagem em 141 horas publicadas de agosto de 2021. As lacunas permanecem ausentes. [BHTRANS](https://dados.pbh.gov.br/dataset/contagens-volumetricas-de-radares). |
| Velocidade amostral | 398 agregações por corredor, sentido, dia e hora de 20/08/2019 a 11/03/2020. Velocidade calculada por distância acumulada ÷ tempo acumulado no conjunto. [Pesquisa SUMOB](https://dados.pbh.gov.br/dataset/velocidade-nos-corredores). |
| Ônibus programados | Linhas, paradas e calendários de serviço do último snapshot disponível. A tela Transporte público exibe a vigência e avisa quando faltam até sete dias. [GTFS SUMOB](https://dados.pbh.gov.br/dataset/gtfs). |
| Ônibus observados | Última posição válida por veículo do [GPS da PBH](https://dados.pbh.gov.br/dataset/tempo_real_onibus_-_coordenada). O estado ao vivo usa a hora da observação e expira em dois minutos. |
| Operação convencional | Usuários registrados por dia e por linha no [MCO de setembro de 2026](https://dados.pbh.gov.br/dataset/mapa-de-controle-operacional-mco-consolidado-a-partir-de-abril-de-2022). A fonte explica a exclusão das entradas em bloqueios BHBUS e estações de transferência MOVE. |
| Endereços | Logradouro e número consultados no [Cadastro Técnico Municipal](https://dados.pbh.gov.br/dataset/endereco-cadastro-tecnico-municipal/resource/eda480b1-1050-46a9-a6b7-53b5800a7aba), com geometria oficial convertida de EPSG:31983 para WGS84. |
| Cartografia de fundo | [OpenFreeMap](https://openfreemap.org/) e contribuidores do [OpenStreetMap](https://www.openstreetmap.org/copyright). As exportações GeoJSON incluem as geometrias das camadas do UrbanFlow. |

Use o painel de fontes da aplicação para ver atribuição, licença, data e cobertura atualizadas. Os sinistros contam boletins únicos. Taxas territoriais usam população residente do Censo 2022 como denominador. Viagens e intervalos GTFS são programados. O aplicativo usa datas civis de São Paulo e mantém dias de serviço do GTFS.

A consulta de fluxo rodoviário por ponto exige uma chave TomTom autorizada e cobertura no local. Ative `TOMTOM_API_KEY` somente quando a licença permitir a exibição e o cache operacional. As bases públicas incluídas sustentam trânsito histórico e a posição atual de ônibus. Congestionamento municipal ao vivo, incidentes rodoviários correntes, medição de pontualidade e histórico observado de atrasos dependem de dados operacionais adicionais.

Os alertas de análise e os relatórios salvos ficam neste dispositivo. O histórico registra quando um recorte consultado satisfaz um limite. Entrega externa exige um canal de notificação. O CSV inclui o recorte completo e o PDF inclui resumo e amostra de até 100 registros.

## Operação em tempo real

- **Trânsito.** Defina `TOMTOM_API_KEY` no ambiente do servidor quando a conta autorizar a exibição de fluxo e incidentes. O fluxo é consultado por ponto. O painel de incidentes consulta o retângulo de Belo Horizonte e entorno e identifica o horário da consulta.
- **Transporte público.** Configure os endpoints HTTPS autorizados em `SUMOB_GTFS_RT_ALERTS_URL` e `SUMOB_GTFS_RT_UPDATES_URL`. A página valida carimbo de tempo e formato, exibe alertas vigentes e contabiliza atraso positivo apenas nas viagens cujo feed informa atraso. A posição GPS municipal é uma camada independente.
- **Alertas agendados.** Configure `URBANFLOW_ALERT_DATABASE_URL` para um PostgreSQL e execute `node --env-file=.env.local scripts/migrate-alerts.mjs` se a conexão estiver no arquivo local. No ambiente de produção, configure o mesmo banco, `CRON_SECRET`, `URBANFLOW_ALERT_WEBHOOK` (HTTPS), `URBANFLOW_ALERT_WEBHOOK_SECRET` (32 caracteres ou mais) e `URBANFLOW_ALERT_RULES`. As regras administrativas são um array JSON com objetos como `{"id":"limite-bh","name":"Limite de sinistros em BH","minimum":1200}`, opcionalmente com `region` usando o nome da regional. A rotina diária avalia o último recorte publicado de 30 dias. Os alertas pessoais da interface continuam no navegador.
- **Entrega.** O receptor do webhook deve verificar `x-urbanflow-signature` (HMAC-SHA256 do timestamp, um ponto e o corpo bruto), rejeitar timestamps antigos e deduplicar por `idempotency-key`. O servidor registra cada disparo no banco e tenta novamente entregas sem confirmação em até cinco execuções.

## Verificar

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Instale o navegador de teste com `npx playwright install chromium`. Com a aplicação em execução, use `node tests/browser.mjs` para verificar navegação, filtros, busca, exportações e responsividade e `node tests/accessibility.mjs` para a auditoria automatizada de acessibilidade. A CI executa ambos em Chromium.
