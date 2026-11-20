'use client';

import { Crosshair, Layers3, Minus, Plus, Search } from 'lucide-react';
import {
  LngLatBounds,
  Map as LibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

type MobilityMapProps = {
  layers: string[];
  collection: FeatureCollection;
  selected?: string | null;
  onSelect?: (feature: Feature) => void;
  focus?: [number, number] | null;
  compact?: boolean;
  dark?: boolean;
  onLayersChange?: (layers: string[]) => void;
  onBoundsChange?: (bounds: string) => void;
};

type SearchHit = { id: string; kind: string; name: string; route?: string; lat?: number; lng?: number; feature?: Feature };

const center: [number, number] = [-43.9393, -19.9257];
const baseStyle = process.env.NEXT_PUBLIC_MAP_STYLE || 'https://tiles.openfreemap.org/styles/liberty';
const roadLabels = ['highway-name-path', 'highway-name-minor', 'highway-name-major'];
const hiddenBaseLabels = new Set(['highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us']);
const source = 'urbanflow-data';
const accidentSource = 'urbanflow-accidents';
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const catalogKinds: Record<string, string> = { Via: 'street', Bairro: 'neighborhood', 'Ponto de ônibus': 'stop', 'Linha programada': 'route', 'Endereço':'address' };

const legend: Record<string, { label: string; color: string }> = {
  traffic: { label: 'Medição viária', color: '#157a82' },
  accident: { label: 'Sinistro', color: '#e2604f' },
  transit: { label: 'Ônibus observado', color: '#147f81' },
  stop: { label: 'Parada', color: '#3679ba' },
  route: { label: 'Itinerário', color: '#36a484' },
  neighborhood: { label: 'Bairro', color: '#7fa7a3' },
  street: { label: 'Trecho', color: '#899694' },
  heat: { label: 'Concentração de sinistros', color: '#e09841' },
};

const interactive = ['transit-points', 'accident-points', 'accident-clusters', 'traffic-points', 'stop-points', 'traffic-lines', 'route-lines', 'street-lines', 'neighborhood-fill'];
const prefix = 'urbanflow-';
const layerId = (id: string) => prefix + id;
const cameraDuration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280;
const ofKind = (kind: string): ExpressionSpecification => ['==', ['get', 'kind'], kind];
const featureId = (feature: Feature) => String(feature.properties?.id ?? feature.id ?? '');
const featureName = (feature: Feature) => String(feature.properties?.name ?? '');
const byGeometry = (type: string): ExpressionSpecification => ['==', ['geometry-type'], type];
const colorFrom = (fallback: string): ExpressionSpecification => ['to-color', ['get', 'color'], fallback];

function blankStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#1c2a2e' : '#e8ede7' } }],
  };
}

function styledBasemap(style: StyleSpecification, dark: boolean): StyleSpecification {
  const geographicLayers = style.layers.filter((layer) =>
    !hiddenBaseLabels.has(layer.id) && !('source-layer' in layer && layer['source-layer'] === 'poi'),
  );
  return {
    ...style,
    layers: geographicLayers.map((layer): LayerSpecification => {
      if (layer.type === 'background') {
        return { ...layer, paint: { ...layer.paint, 'background-color': dark ? '#202d31' : '#e7ede7' } };
      }
      if (layer.type === 'fill') {
        const colors: Record<string, string> = dark
          ? { building: '#28393b', water: '#203e44', park: '#293c35', landuse: '#263532', landcover: '#293c35' }
          : { building: '#d6dfd6', water: '#bdddd9', park: '#d4e5d4', landuse: '#e3e9e1', landcover: '#d9e8d8' };
        const color = colors[layer['source-layer'] ?? ''];
        if(dark && layer['source-layer']==='building'){
          return {...layer,paint:{...layer.paint,'fill-color':color,'fill-outline-color':'#324447'}};
        }
        if (color) return { ...layer, paint: { ...layer.paint, 'fill-color': color } };
      }
      if(dark && layer.type==='line' && layer['source-layer']==='building'){
        return {...layer,paint:{...layer.paint,'line-color':'#3a4b4d'}};
      }
      if (layer.type === 'line' && /^(road|bridge|tunnel)_/.test(layer.id) && !/rail/.test(layer.id)) {
        const casing = layer.id.endsWith('_casing');
        return { ...layer, paint: { ...layer.paint, 'line-color': dark ? (casing ? '#3b4b4f' : '#516266') : (casing ? '#cdd8d0' : '#f9fbf8') } };
      }
      if (layer.type === 'symbol' && layer.paint?.['text-color']) {
        return { ...layer, paint: { ...layer.paint, 'text-color': dark ? '#b2c2c1' : '#647973', 'text-halo-color': dark ? '#263538' : '#f1f4ef' } };
      }
      if (layer.type === 'fill-extrusion' && layer.id === 'building-3d') {
        return { ...layer, paint: { ...layer.paint, 'fill-extrusion-color': dark ? '#2c3f41' : '#d6dfd6' } };
      }
      return layer;
    }),
  };
}

function addOverlays(map: LibreMap) {
  const textLayer = map.getStyle().layers.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
  map.addSource(source, { type: 'geojson', data: empty });
  map.addSource(accidentSource, { type: 'geojson', data: empty, cluster: true, clusterRadius: 49, clusterMaxZoom: 15 });

  map.addLayer({
    id: layerId('neighborhood-fill'), type: 'fill', source, filter: ['all', ofKind('neighborhood'), byGeometry('Polygon')],
    paint: { 'fill-color': '#388982', 'fill-opacity': 0.08, 'fill-outline-color': '#6eaaa4' },
  }, textLayer);
  for (const kind of ['street', 'route', 'traffic']) {
    const width = kind === 'street' ? 1.5 : 5;
    map.addLayer({
      id: layerId(`${kind}-lines`), type: 'line', source, filter: ['all', ofKind(kind), byGeometry('LineString')],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorFrom(legend[kind].color), 'line-width': width, 'line-opacity': kind === 'street' ? 0.46 : 0.9 },
    }, textLayer);
  }
  map.addLayer({
    id: layerId('heat'), type: 'heatmap', source, filter: ['all', ofKind('accident'), byGeometry('Point')],
    paint: {
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 17, 26],
      'heatmap-opacity': 0.7,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,218,158,0)', 0.25, '#ffe1a2', 0.55, '#f39b5f', 1, '#c73c43'],
    },
  }, textLayer);

  for (const kind of ['traffic', 'stop', 'transit']) {
    map.addLayer({
      id: layerId(`${kind}-points`), type: 'circle', source,
      filter: ['all', ofKind(kind), byGeometry('Point')], minzoom: kind === 'stop' ? 13 : undefined,
      paint: { 'circle-color': colorFrom(legend[kind].color), 'circle-radius': kind === 'stop' ? 4 : 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.7 },
    });
  }
  map.addLayer({
    id: layerId('accident-clusters'), type: 'circle', source: accidentSource,
    filter: ['has', 'point_count'],
    paint: { 'circle-radius': ['step', ['get', 'point_count'], 12, 30, 16, 120, 21], 'circle-color': '#d75e4e', 'circle-stroke-color': '#fce1d9', 'circle-stroke-width': 2.5 },
  });
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: layerId('accident-cluster-labels'), type: 'symbol', source: accidentSource, filter: ['has', 'point_count'],
      layout: { 'text-field': ['to-string', ['get', 'point_count_abbreviated']], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': '#fff' },
    });
  }
  map.addLayer({
    id: layerId('accident-points'), type: 'circle', source: accidentSource, filter: ['!', ['has', 'point_count']],
    paint: { 'circle-radius': 6.5, 'circle-color': '#e2604f', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: layerId('selection-area'), type: 'fill', source, filter: ['all', byGeometry('Polygon'), ['==', ['get', 'id'], '']],
    paint: { 'fill-color': '#127981', 'fill-opacity': 0.21, 'fill-outline-color': '#127981' },
  }, textLayer);
  map.addLayer({
    id: layerId('selection-line'), type: 'line', source, filter: ['all', byGeometry('LineString'), ['==', ['get', 'id'], '']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#126f78', 'line-width': 6 },
  });
  map.addLayer({
    id: layerId('selection-point'), type: 'circle', source, filter: ['all', byGeometry('Point'), ['==', ['get', 'id'], '']],
    paint: { 'circle-radius': 10, 'circle-color': 'rgba(18,111,120,0.2)', 'circle-stroke-color': '#126f78', 'circle-stroke-width': 2 },
  });
}

function coordinates(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function moveTo(map: LibreMap, feature: Feature) {
  if (feature.geometry?.type === 'Point') {
    const point = feature.geometry.coordinates;
    if (coordinates(point)) map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: cameraDuration() });
    return;
  }
  if (!feature.geometry || feature.geometry.type === 'GeometryCollection') return;
  const bounds = new LngLatBounds();
  function visit(value: unknown) {
    if (coordinates(value)) bounds.extend(value);
    else if (Array.isArray(value)) value.forEach(visit);
  }
  visit(feature.geometry.coordinates);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 44, maxZoom: 16, linear:true, duration: cameraDuration() });
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function visibleStreets(map: LibreMap, point?: { x: number; y: number }): Feature[] {
  const layers = roadLabels.filter((id) => map.getLayer(id));
  if (layers.length === 0) return [];
  const tolerance = 8;
  const found = point
    ? map.queryRenderedFeatures([[point.x - tolerance, point.y - tolerance], [point.x + tolerance, point.y + tolerance]], { layers })
    : map.queryRenderedFeatures({ layers });
  return found.flatMap((item) => {
    const name = String(item.properties['name:pt'] || item.properties.name || '');
    if (!name || !['LineString', 'MultiLineString'].includes(item.geometry.type)) return [];
    return [{
      type: 'Feature' as const,
      geometry: item.geometry,
      properties: { id: `osm:${item.id ?? normalized(name)}`, kind: 'street', name, source: 'OpenStreetMap', partialGeometry: true },
    }];
  });
}

export default function MobilityMap({ layers, collection, selected = null, onSelect, focus = null, compact = false, dark = false, onLayersChange, onBoundsChange }: MobilityMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const current = useRef({ collection, onSelect });
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [basemap, setBasemap] = useState<StyleSpecification | null>(null);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'basemap' | 'webgl'>('loading');
  const [paintedTheme,setPaintedTheme]=useState<boolean|null>(null);
  const visibleStatus=mapStatus==='ready'&&paintedTheme!==dark?'loading':mapStatus;
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [visibleRoads, setVisibleRoads] = useState<Feature[]>([]);
  const [searchSelection, setSearchSelection] = useState<Feature | null>(null);
  const [catalog, setCatalog] = useState<{ query: string; hits: SearchHit[] }>({ query: '', hits: [] });
  const [lookup, setLookup] = useState('');
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [layerOverrides, setLayerOverrides] = useState<{ signature: string; values: Record<string, boolean> }>({ signature: '', values: {} });
  const focusLng = focus?.[0];
  const focusLat = focus?.[1];
  const signature = layers.join('|');
  const active = useMemo(() => {
    const next = new Set(layers);
    if (layerOverrides.signature !== signature) return next;
    for (const [kind, visible] of Object.entries(layerOverrides.values)) {
      if (visible) next.add(kind);
      else next.delete(kind);
    }
    return next;
  }, [layerOverrides, layers, signature]);
  const availableLayers = useMemo(() => new Set(collection.features.map((item) => item.properties?.kind).filter((kind) => typeof kind === 'string')), [collection]);
  const term = normalized(search);
  const results = useMemo(() => {
    if (term.length < 2) return [];
    const matches: SearchHit[] = [];
    const names = new Set<string>();
    function add(hit: SearchHit) {
      const name = normalized(hit.name);
      if (matches.length >= 8 || !name.includes(term) || names.has(name)) return;
      matches.push(hit);
      names.add(name);
    }
    function addFeature(feature: Feature) {
      const kind = feature.properties?.kind;
      if (['street', 'neighborhood', 'stop', 'route', 'traffic'].includes(kind)) {
        add({ id: featureId(feature), name: featureName(feature), kind, feature });
      }
    }
    for (const feature of collection.features) addFeature(feature);
    if (catalog.query === term) for (const hit of catalog.hits) add({ ...hit, kind: catalogKinds[hit.kind] ?? hit.kind });
    for (const feature of visibleRoads) addFeature(feature);
    return matches;
  }, [catalog, collection, term, visibleRoads]);

  useEffect(() => {
    if (!searchOpen || term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Catálogo indisponível');
        const hits = await response.json() as SearchHit[];
        setCatalog({ query: term, hits });
      } catch {
        if (!controller.signal.aborted) setCatalog({ query: term, hits: [] });
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchOpen, term]);

  const reportBounds = useRef(onBoundsChange);
  useEffect(() => { reportBounds.current = onBoundsChange; }, [onBoundsChange]);
  useEffect(() => { current.current = { collection, onSelect }; }, [collection, onSelect]);

  useEffect(() => {
    if (!container.current) return;
    let instance: LibreMap;
    try {
      setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
      instance = new LibreMap({
        container: container.current,
        style: blankStyle(false),
        center,
        zoom: compact ? 12 : 13.1,
        minZoom: 8,
        maxZoom: 20,
        maxBounds: [[-44.56, -20.35], [-43.25, -19.4]],
        dragRotate: false,
        pitchWithRotate: false,
        cooperativeGestures: compact,
        attributionControl: { compact: true },
      });
    } catch {
      const statusTimer = window.setTimeout(() => setMapStatus('webgl'), 0);
      return () => window.clearTimeout(statusTimer);
    }
    map.current = instance;
    instance.getCanvas().setAttribute('aria-label', 'Mapa de mobilidade de Belo Horizonte. Use as setas para mover e + ou − para aproximar ou afastar.');
    function publishBounds(){
      const bounds=instance.getBounds();
      const x=(bounds.getEast()-bounds.getWest())*.12;
      const y=(bounds.getNorth()-bounds.getSouth())*.12;
      reportBounds.current?.([bounds.getWest()-x,bounds.getSouth()-y,bounds.getEast()+x,bounds.getNorth()+y]
        .map((coordinate,index)=>(index<2?Math.floor(coordinate*1000):Math.ceil(coordinate*1000))/1000).join(','));
    }
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    instance.on('moveend',publishBounds);
    const initialBounds=window.requestAnimationFrame(publishBounds);
    instance.on('style.load', () => {
      if (!instance.getSource(source)) addOverlays(instance);
      setVersion((value) => value + 1);
    });
    instance.on('click', async (event) => {
      const visible = interactive.map(layerId).filter((id) => instance.getLayer(id));
      if (!current.current.onSelect) return;
      const features = visible.length ? instance.queryRenderedFeatures(event.point, { layers: visible }) : [];
      const first = visible.map((id) => features.find((feature) => feature.layer.id === id)).find(Boolean);
      if (!first || first.properties.kind === 'neighborhood') {
        const [street] = visibleStreets(instance, event.point);
        if (street) {
          setSearchSelection(street);
          current.current.onSelect(street);
          return;
        }
      }
      if (!first) return;
      if (first.properties.cluster_id != null && first.geometry.type === 'Point') {
        const cluster = instance.getSource<GeoJSONSource>(accidentSource);
        const point = first.geometry.coordinates;
        if (cluster && coordinates(point)) {
          try {
            const zoom = await cluster.getClusterExpansionZoom(first.properties.cluster_id);
            if (map.current === instance) instance.easeTo({ center: point, zoom, duration: cameraDuration() });
          } catch { /* Another filter may have replaced the cluster. */ }
        }
        return;
      }
      const actual = current.current.collection.features.find((item) => featureId(item) === featureId(first) && item.properties?.kind === first.properties.kind);
      current.current.onSelect?.(actual ?? first);
    });
    instance.on('mousemove', (event) => {
      const visible = interactive.map(layerId).filter((id) => instance.getLayer(id));
      instance.getCanvas().style.cursor = visible.length && instance.queryRenderedFeatures(event.point, { layers: visible }).length ? 'pointer' : '';
    });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(initialBounds);
      instance.remove();
      map.current = null;
    };
  }, [compact]);

  useEffect(() => {
    if (!map.current) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort('tempo limite'), 12000);
    let mounted = true;
    fetch(baseStyle, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Mapa-base indisponível');
        const style = await response.json() as StyleSpecification;
        if (style.version !== 8 || !Array.isArray(style.layers)) throw new Error('Estilo de mapa inválido');
        if (mounted) setBasemap(style);
      })
      .catch(() => { if (mounted) setMapStatus('basemap'); })
      .finally(() => window.clearTimeout(timer));
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, compact]);

  useEffect(() => {
    const instance=map.current;
    if(!instance)return;
    instance.setStyle(basemap ? styledBasemap(basemap, dark) : blankStyle(dark), { diff: false });
    if(!basemap)return;
    const timeout=window.setTimeout(()=>setMapStatus('basemap'),12000);
    function markReady(){
      window.clearTimeout(timeout);
      setPaintedTheme(dark);
      setMapStatus('ready');
    }
    instance.once('idle',markReady);
    return ()=>{
      window.clearTimeout(timeout);
      instance.off('idle',markReady);
    };
  }, [basemap, compact, dark]);

  useEffect(() => {
    const instance = map.current;
    const main = instance?.getSource<GeoJSONSource>(source);
    const accidents = instance?.getSource<GeoJSONSource>(accidentSource);
    if (!main || !accidents) return;
    const data = searchSelection && selected === featureId(searchSelection) && !collection.features.some((feature) => featureId(feature) === selected)
      ? { type: 'FeatureCollection' as const, features: [...collection.features, searchSelection] }
      : collection;
    main.setData(data);
    void accidents.setData({ type: 'FeatureCollection', features: collection.features.filter((item) => item.properties?.kind === 'accident' && item.geometry?.type === 'Point') });
  }, [collection, searchSelection, selected, version]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.getSource(source)) return;
    const groups: Record<string, string[]> = {
      accident: ['accident-points', 'accident-clusters', 'accident-cluster-labels'],
      traffic: ['traffic-points', 'traffic-lines'], transit: ['transit-points'], stop: ['stop-points'],
      route: ['route-lines'], street: ['street-lines'], neighborhood: ['neighborhood-fill'], heat: ['heat'],
    };
    for (const [kind, group] of Object.entries(groups)) {
      for (const id of group) {
        if (instance.getLayer(layerId(id))) instance.setLayoutProperty(layerId(id), 'visibility', active.has(kind) ? 'visible' : 'none');
      }
    }
  }, [active, version]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.getSource(source)) return;
    const idFilter: ExpressionSpecification | boolean = selected === null ? false : ['==', ['to-string', ['coalesce', ['get', 'id'], ['id'], '']], selected];
    instance.setFilter(layerId('selection-area'), ['all', byGeometry('Polygon'), idFilter]);
    instance.setFilter(layerId('selection-line'), ['all', byGeometry('LineString'), idFilter]);
    instance.setFilter(layerId('selection-point'), ['all', byGeometry('Point'), idFilter]);
  }, [selected, version]);

  useEffect(() => {
    if (focusLng !== undefined && focusLat !== undefined) {
      map.current?.easeTo({ center: [focusLng, focusLat], zoom: 15, duration: cameraDuration() });
    }
  }, [compact, focusLat, focusLng]);

  async function choose(hit: SearchHit) {
    setLookup('');
    try {
      let feature = hit.feature;
      if (!feature && hit.kind === 'stop' && hit.lng !== undefined && hit.lat !== undefined) {
        feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [hit.lng, hit.lat] }, properties: { id: hit.id, name: hit.name, kind: hit.kind, source: 'GTFS · SUMOB' } };
      }
      if (!feature) {
        setLookup('Carregando geometria…');
        const query = new URLSearchParams({ layers: hit.kind });
        if (hit.kind === 'street') query.set('street', hit.id);
        if (hit.kind === 'address') query.set('selected', hit.id);
        if (hit.route) query.set('route', hit.route);
        const response = await fetch(`/api/map?${query}`);
        if (!response.ok) throw new Error('Geometria indisponível');
        const payload = await response.json() as { collection: FeatureCollection };
        feature = payload.collection.features.find((candidate) => featureId(candidate) === hit.id);
        if (!feature && hit.route) feature = payload.collection.features.find((candidate) => candidate.properties?.kind === 'route');
      }
      if (!feature) throw new Error('Geometria indisponível');
      if (map.current) moveTo(map.current, feature);
      setSearchSelection(feature);
      onSelect?.(feature);
      setSearch(featureName(feature));
      setSearchOpen(false);
      setLookup('');
    } catch {
      setLookup('Geometria indisponível para este resultado');
    }
  }

  function toggleLayer(kind: string) {
    if (onLayersChange) {
      onLayersChange(active.has(kind) ? [...active].filter((item) => item !== kind) : [...active, kind]);
      return;
    }
    setLayerOverrides((previous) => ({ signature, values: { ...(previous.signature === signature ? previous.values : {}), [kind]: !active.has(kind) } }));
  }

  const visibleLegend = [...active].filter((kind) => legend[kind]);
  const layerChoices = Object.keys(legend).filter((kind) => active.has(kind) || availableLayers.has(kind) || (kind === 'heat' && availableLayers.has('accident')));

  return (
    <div className={`mobility-map${compact ? ' mobility-map--compact' : ''}${dark ? ' mobility-map--dark' : ''}`}>
      <div className="mobility-map__canvas" ref={container} />
      {!compact && mapStatus !== 'webgl' && (
        <div className="mobility-map__search" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
        }}>
          <form role="search" aria-label="Busca no mapa" onSubmit={(event) => { event.preventDefault(); if (results[0]) void choose(results[0]); }}>
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Buscar rua, bairro ou parada no mapa"
              aria-controls={searchOpen && term.length>=2?'mobility-map-results':undefined}
              placeholder="Buscar rua, bairro ou parada…"
              value={search}
              onFocus={() => { setSearchOpen(true); if (map.current) setVisibleRoads(visibleStreets(map.current)); }}
              onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); setLookup(''); }}
              onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); }}
            />
          </form>
          {searchOpen && term.length >= 2 && (
            <ul id="mobility-map-results" aria-label="Resultados no mapa">
              {lookup && <li className="mobility-map__no-result" role="status">{lookup}</li>}
              {results.length === 0 && <li className="mobility-map__no-result" role="status">{catalog.query === term ? 'Nenhum local nas fontes carregadas' : 'Buscando no catálogo…'}</li>}
              {results.map((hit) => <li key={`${hit.kind}:${hit.id}:${hit.name}`}>
                <button type="button" onClick={() => void choose(hit)}><strong>{hit.name}</strong><span>{hit.kind==='address'?'Endereço oficial':legend[hit.kind]?.label}</span></button>
              </li>)}
            </ul>
          )}
        </div>
      )}
      {mapStatus !== 'webgl' && <div className="mobility-map__controls" aria-label="Controles do mapa">
        <button type="button" aria-label="Aproximar" title="Aproximar" onClick={() => map.current?.zoomIn({duration:cameraDuration()})}><Plus size={18} /></button>
        <button type="button" aria-label="Afastar" title="Afastar" onClick={() => map.current?.zoomOut({duration:cameraDuration()})}><Minus size={18} /></button>
        {!compact && <button type="button" aria-label="Centralizar em Belo Horizonte" title="Centralizar em Belo Horizonte" onClick={() => map.current?.easeTo({ center, zoom: 13.1, duration:cameraDuration() })}><Crosshair size={17} /></button>}
        {!!layerChoices.length && <button type="button" aria-label="Camadas do mapa" title="Camadas do mapa" aria-expanded={layerMenuOpen} onClick={() => setLayerMenuOpen((value) => !value)}><Layers3 size={17} /></button>}
        {layerMenuOpen && <fieldset className="mobility-map__layers">
          <legend>Camadas</legend>
          {layerChoices.map((kind) => <label key={kind}><input type="checkbox" checked={active.has(kind)} onChange={() => toggleLayer(kind)} />{legend[kind].label}</label>)}
        </fieldset>}
      </div>}
      {!!visibleLegend.length && mapStatus !== 'webgl' && <aside className="mobility-map__legend" aria-label="Legenda do mapa">
        {!compact && <strong>Camadas visíveis</strong>}
        <div>{visibleLegend.map((kind) => <span key={kind}><i style={{ backgroundColor: legend[kind].color }} />{legend[kind].label}</span>)}</div>
      </aside>}
      {visibleStatus !== 'ready' && <div className="mobility-map__status" role="status">
        {visibleStatus === 'loading' && 'Carregando mapa-base…'}
        {visibleStatus === 'basemap' && <>Mapa-base indisponível. <button type="button" onClick={() => { setMapStatus('loading'); setAttempt((value) => value + 1); }}>Tentar novamente</button></>}
        {visibleStatus === 'webgl' && 'Mapa interativo indisponível neste navegador. Consulte os dados nas tabelas.'}
      </div>}
    </div>
  );
}
