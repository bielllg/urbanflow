"""Refresh UrbanFlow's Belo Horizonte snapshots from the published sources."""

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZipFile
from zoneinfo import ZoneInfo

import requests
from pyproj import Geod, Transformer
from shapely import STRtree, from_geojson, from_wkt, make_valid, points, to_geojson, transform


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CKAN = "https://dados.pbh.gov.br"
TO_WGS84 = Transformer.from_crs(31983, 4326, always_xy=True)
GEOD = Geod(ellps="WGS84")
BRT = ZoneInfo("America/Sao_Paulo")
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
csv.field_size_limit(4_000_000)


def normalized(value):
    return "".join(
        char for char in unicodedata.normalize("NFKD", value.strip()).casefold()
        if not unicodedata.combining(char)
    )


def clean(value):
    return (value or "").strip()


def number(value):
    try:
        result = float(clean(value).replace(",", "."))
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def event_time(value):
    value = clean(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def lat_lon_ok(lng, lat):
    return (lng is not None and lat is not None
            and -44.15 <= lng <= -43.65 and -20.25 <= lat <= -19.58)


class Download:
    def __init__(self, folder, seed_folder=None):
        self.folder = folder
        self.seed_folder = seed_folder

    def get(self, url, seed=None, limit=150_000_000):
        if self.seed_folder and seed:
            supplied = self.seed_folder / f"urbanflow-sample-{seed}"
            if supplied.is_file() and 0 < supplied.stat().st_size <= limit:
                return supplied
        name = hashlib.sha256(url.encode()).hexdigest()
        path = self.folder / name
        if path.exists():
            return path
        try:
            with requests.get(url, timeout=(12, 50), stream=True,
                              headers={"User-Agent": "UrbanFlow/1.0 (public data import)"}) as response:
                response.raise_for_status()
                size = 0
                with path.open("wb") as output:
                    for chunk in response.iter_content(65_536):
                        size += len(chunk)
                        if size > limit:
                            raise ValueError("download exceeds size limit")
                        output.write(chunk)
        except requests.RequestException:
            powershell = shutil.which("pwsh") or shutil.which("powershell")
            if os.name != "nt" or not powershell:
                raise
            env = {**os.environ, "URBANFLOW_FETCH_URL": url, "URBANFLOW_FETCH_PATH": str(path)}
            subprocess.run(
                [powershell, "-NoProfile", "-NonInteractive", "-Command",
                 "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri $env:URBANFLOW_FETCH_URL "
                 "-OutFile $env:URBANFLOW_FETCH_PATH -TimeoutSec 80"],
                env=env, check=True, timeout=90, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        if not 0 < path.stat().st_size <= limit:
            path.unlink(missing_ok=True)
            raise ValueError("download size outside allowed range")
        return path

    def package(self, slug):
        path = self.get(f"{CKAN}/api/3/action/package_show?id={slug}", limit=5_000_000)
        envelope = json.loads(path.read_bytes())
        if not envelope.get("success"):
            raise ValueError(f"CKAN returned no package for {slug}")
        return envelope["result"]


def csv_rows(path):
    raw = path.read_bytes()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("cp1252")
    first_line = content.splitlines()[0]
    delimiter = ";" if ";" in first_line else ","
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    for row in reader:
        yield {normalized(key).replace(" ", "_"): clean(value)
               for key, value in row.items() if key is not None}


def csv_resources(package):
    entries = [resource for resource in package["resources"]
               if resource.get("format", "").upper() == "CSV"]
    return sorted(entries, key=lambda resource: resource.get("name", ""))


def source(id_, name, slug, package=None, **fields):
    return {
        "id": id_, "name": name, "url": f"{CKAN}/dataset/{slug}",
        "license": (package or {}).get("license_title"), "status": "available",
        "importedAt": datetime.now(timezone.utc).isoformat(), **fields,
    }


def round_coords(value):
    if isinstance(value, list):
        return [round_coords(item) for item in value]
    return round(value, 6)


def geometry_json(geometry):
    result = json.loads(to_geojson(transform(geometry, TO_WGS84.transform, interleaved=False)))
    result["coordinates"] = round_coords(result["coordinates"])
    return result


def assign_neighborhoods(records, include_region=False):
    path = DATA / "neighborhoods.json"
    if not path.is_file():
        return
    boundaries = json.loads(path.read_bytes())["features"]
    if not boundaries:
        return
    geometries = [from_geojson(json.dumps(feature["geometry"])) for feature in boundaries]
    valid = [(index, row) for index, row in enumerate(records)
             if lat_lon_ok(row.get("lng"), row.get("lat"))]
    if not valid:
        return
    coordinates = points([(row["lng"], row["lat"]) for _, row in valid])
    row_indices, feature_indices = STRtree(geometries).query(coordinates, predicate="within")
    seen = set()
    for match, feature in zip(row_indices, feature_indices):
        index, row = valid[match]
        if index in seen:
            continue
        seen.add(index)
        properties = boundaries[feature]["properties"]
        row["neighborhoodId"] = properties["id"]
        row["neighborhood"] = properties["name"]
        if include_region and properties.get("region"):
            row["region"] = properties["region"]


def boundaries(fetch):
    slug = "bairro-popular"
    package = fetch.package(slug)
    resource = csv_resources(package)[-1]
    secondary_sources = []
    population = {}
    population_slug = "pop-domic-bairro-2022"
    try:
        population_package = fetch.package(population_slug)
        population_resource = csv_resources(population_package)[-1]
        for row in csv_rows(fetch.get(population_resource["url"], "population")):
            population[row["num_bairro"]] = {
                "name": row["bairro"], "population": int(row["populacao"]),
            }
        secondary_sources.append(source(
            "population", "População por bairro · Censo 2022", population_slug, population_package,
            observedAt="2022-08-01", coverage="População residente nos bairros de Belo Horizonte",
            detail="População de referência do Censo 2022. Vinculada ao código oficial do bairro.",
        ))
    except Exception as error:
        secondary_sources.append(source(
            "population", "População por bairro · Censo 2022", population_slug,
            status="unavailable", detail=str(error),
        ))

    regional_names, regional_geometries, regional_tree = [], [], None
    regional_slug = "regiao-administrativa"
    try:
        regional_package = fetch.package(regional_slug)
        regional_resource = csv_resources(regional_package)[-1]
        for row in csv_rows(fetch.get(regional_resource["url"], "regional")):
            name = row.get("nome") or row.get("nome_regional") or row.get("regional")
            if name and row.get("geometria"):
                regional_names.append(name.title())
                regional_geometries.append(make_valid(from_wkt(row["geometria"])))
        if regional_geometries:
            regional_tree = STRtree(regional_geometries)
            secondary_sources.append(source(
                "regions", "Regiões administrativas · PBH", regional_slug, regional_package,
                coverage=f"{len(regional_geometries)} geometrias regionais",
                detail="Regionais atribuídas a bairros e pontos por interseção espacial.",
            ))
    except Exception as error:
        secondary_sources.append(source(
            "regions", "Regiões administrativas · PBH", regional_slug,
            status="unavailable", detail=str(error),
        ))

    features = []
    for row in csv_rows(fetch.get(resource["url"], "bairros")):
        geometry = make_valid(from_wkt(row["geometria"]))
        if geometry.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        id_, name = row["codigo"], row["nome"]
        properties = {"id": id_, "name": name}
        census = population.get(id_)
        if census and normalized(census["name"]) == normalized(name):
            properties["population"] = census["population"]
        if regional_tree is not None:
            candidates = regional_tree.query(geometry, predicate="intersects")
            if len(candidates):
                winner = max(candidates, key=lambda i: regional_geometries[i].intersection(geometry).area)
                properties["region"] = regional_names[winner]
        features.append({
            "type": "Feature", "id": id_, "properties": properties,
            "geometry": geometry_json(geometry.simplify(2, preserve_topology=True)),
        })
    if not features:
        raise ValueError("no neighborhood geometries")
    return {"type": "FeatureCollection", "features": features}, [
        source("neighborhoods", "Bairro Popular · PBH", slug, package,
               observedAt=resource.get("last_modified", "")[:10],
               coverage=f"{len(features)} polígonos de bairros, conjuntos e vilas",
               detail="Malha oficial em EPSG:31983 reprojetada para WGS84. Geometrias simplificadas em 2 m."),
        *secondary_sources,
    ]


def streets(fetch):
    slug = "trecho-logradouro-2"
    package = fetch.package(slug)
    resource = csv_resources(package)[-1]
    features = []
    for row in csv_rows(fetch.get(resource["url"], "streets")):
        name = row.get("nome_logradouro") or row.get("nome")
        if not name or not row.get("geometria"):
            continue
        kind = row.get("desc_sigla_tipo_lograd") or row.get("sigla_tipo_logradouro")
        if kind and not normalized(name).startswith(normalized(kind) + " "):
            name = f"{kind.title()} {name}"
        id_ = row.get("id_trecho_logradouro") or row.get("id")
        geometry = from_wkt(row["geometria"])
        if not id_ or geometry.geom_type not in ("LineString", "MultiLineString") or geometry.is_empty:
            continue
        length = number(row.get("comprimento"))
        properties = {"id": id_, "name": name}
        if length is not None:
            properties["length"] = length
        features.append({
            "type": "Feature", "id": id_, "properties": properties,
            "geometry": geometry_json(geometry.simplify(1)),
        })
    if not features:
        raise ValueError("no named streets")
    return {"type": "FeatureCollection", "features": features}, [
        source("streets", "Trecho Logradouro · BHGeo", slug, package,
               observedAt=resource.get("last_modified", "")[:10],
               coverage=f"{len(features)} trechos de logradouro com nome",
               detail="Geometrias cadastrais reprojetadas para WGS84 e simplificadas em 1 m."),
    ]


def accidents(fetch):
    slug = "relacao-de-ocorrencias-de-acidentes-de-transito-com-vitima"
    spatial_slug = "ocorrencia-sinistro-transito-com-vitima"
    package = fetch.package(slug)
    spatial_package = fetch.package(spatial_slug)
    annual = [resource for resource in csv_resources(package)
              if re.fullmatch(r"si-bol[-_]\d{4}", resource.get("name", ""))]
    spatial = csv_resources(spatial_package)[-1]

    def process(resource, fallback=False):
        file = fetch.get(resource["url"], "spatial" if fallback else
                         "accidents" if resource["name"].endswith("2024") else None)
        unique = {}
        for row in csv_rows(file):
            id_ = row.get("numero_boletim", "")
            raw_timestamp = row.get("data_hora_boletim", "")
            timestamp = event_time(raw_timestamp)
            if not timestamp or not id_:
                continue
            hour_informed = normalized(row.get("hora_informada", "")) in ("", "sim", "s")
            hour = timestamp.hour if hour_informed and ":" in raw_timestamp else None
            accident_type = row.get("desc_tipo_acidente") or row.get("descricao_tipo_acidente")
            region = row.get("desc_regional") or row.get("descricao_regional")
            fatal_flag = normalized(row.get("indicador_fatalidade", ""))
            fatal = True if fatal_flag in ("sim", "s") else False if fatal_flag in ("nao", "n") else None
            x, y = number(row.get("coordenada_x")), number(row.get("coordenada_y"))
            if fallback and row.get("geometria"):
                position = from_wkt(row["geometria"])
                if position.geom_type == "Point" and not position.is_empty:
                    x, y = position.x, position.y
            lng, lat = (None, None)
            if x is not None and y is not None and 560_000 < x < 660_000 and 7_700_000 < y < 7_900_000:
                lng, lat = TO_WGS84.transform(x, y)
            has_coords = lat_lon_ok(lng, lat)
            record = {
                "id": id_, "date": timestamp.date().isoformat(), "hour": hour,
                "type": accident_type.lower().capitalize() if accident_type else "Tipo não informado",
                "region": region.title() if region and normalized(region) != "nao informado" else "Regional não informada",
                "lat": round(lat, 6) if has_coords else None,
                "lng": round(lng, 6) if has_coords else None, "fatal": fatal,
            }
            if id_ not in unique or (unique[id_]["lat"] is None and has_coords):
                unique[id_] = record
        if not unique:
            raise ValueError(f"no valid records in {resource['name']}")
        return unique

    def attempt(resource):
        try:
            return process(resource, resource is spatial)
        except Exception as error:
            print(f"{resource['name']}: {error}", file=sys.stderr, flush=True)
            return None

    records = {}
    missing = []
    with ThreadPoolExecutor(max_workers=7) as pool:
        for resource, batch in zip([spatial, *annual], pool.map(attempt, [spatial, *annual])):
            if batch:
                for id_, record in batch.items():
                    original = records.get(id_)
                    if record["lat"] is None and original:
                        record["lat"], record["lng"] = original["lat"], original["lng"]
                    records[id_] = record
            else:
                missing.append(resource["name"])
    if not records:
        raise ValueError("no accident data imported")
    result = sorted(records.values(), key=lambda row: (row["date"], row["id"]))
    mappable = sum(row["lat"] is not None for row in result)
    detail = (f"{mappable:,} boletins georreferenciados. Boletins anuais têm prioridade "
              "sobre a camada geográfica. Chave de deduplicação: número do boletim.")
    if missing:
        detail += " Recursos indisponíveis: " + ", ".join(missing) + "."
    return result, [
        source("accidents", "Boletins de sinistros com vítima · BHTRANS", slug, package,
               observedAt=result[-1]["date"], coverage=f"{result[0]['date']} a {result[-1]['date']}",
               detail=detail, missingResources=missing),
        source("accidents-spatial", "Ocorrência Sinistro Trânsito com Vítima · BHGeo",
               spatial_slug, spatial_package, status="unavailable" if spatial["name"] in missing else "available",
               coverage="Ocorrências com vítima georreferenciadas na camada municipal",
               detail="Camada EPSG:31983. Associação aos boletins pelo número publicado."),
    ]


def speed(fetch):
    slug = "velocidade-nos-corredores"
    package = fetch.package(slug)
    resource = next(entry for entry in csv_resources(package) if entry["name"] == "Velocidade nos Corredores")
    groups = {}
    previous = None
    rejected = 0
    for row in csv_rows(fetch.get(resource["url"], "speed")):
        ts = event_time(row.get("horario"))
        lng, lat = number(row.get("long")), number(row.get("lat"))
        corridor = row.get("codigo"), row.get("via"), row.get("sentido")
        if not ts or not lat_lon_ok(lng, lat) or not corridor[0] or not corridor[1]:
            previous = None
            rejected += 1
            continue
        if previous and previous[0] == corridor:
            elapsed = (ts - previous[1]).total_seconds()
            if 0 < elapsed <= 2:
                _, _, distance = GEOD.inv(previous[2], previous[3], lng, lat)
                if distance * 3.6 / elapsed <= 140:
                    key = (ts.date().isoformat(), ts.hour, *corridor)
                    group = groups.setdefault(key, [0, 0, 0, 0, 0])
                    group[0] += distance
                    group[1] += elapsed
                    group[2] += 1
                    group[3] += lat
                    group[4] += lng
                else:
                    rejected += 1
        previous = corridor, ts, lng, lat

    result = []
    for (day, hour, code, road, direction), (meters, seconds, count, lats, lngs) in sorted(groups.items()):
        result.append({
            "id": f"{code}:{direction}:{day}:{hour}", "date": day, "hour": hour,
            "region": "Regional não atribuída", "road": road, "direction": direction,
            "speed": round(3.6 * meters / seconds, 2), "distanceMeters": round(meters, 2),
            "durationSeconds": seconds, "samples": count,
            "lat": round(lats / count, 6), "lng": round(lngs / count, 6),
        })
    if not result:
        raise ValueError("no valid consecutive GPS measurements")
    return result, [
        source("traffic", "Pesquisa de velocidade nos corredores · SUMOB", slug, package,
               observedAt=result[-1]["date"], coverage=f"{result[0]['date']} a {result[-1]['date']}",
               detail="Observação histórica, agrupada por corredor, sentido, dia e hora. "
               "Distância geodésica acumulada dividida pelo tempo acumulado. A regional corresponde "
               "à localização aproximada do grupo. Pares consecutivos de 1–2 s "
               f"limitados a 140 km/h para excluir saltos de GPS. {rejected:,} linhas ou pares rejeitados."),
    ]


def radar(fetch):
    slug = "contagens-volumetricas-de-radares"
    package = fetch.package(slug)
    # Explicit historical window: a published, bounded archive with verified hourly members.
    resource_url = "https://servicosbhtrans.pbh.gov.br/Bhtrans/webservice/AGOSTO_2021.zip"
    grouped = {}
    hours = set()
    excluded = 0
    with ZipFile(fetch.get(resource_url, "radar", limit=165_000_000)) as archive:
        for member in archive.infolist():
            filename = member.filename.rsplit("/", 1)[-1]
            match = re.fullmatch(r"(\d{8})_(\d{2})\.json", filename)
            if not match:
                continue
            day, hour = date.fromisoformat(match[1]).isoformat(), int(match[2])
            if hour > 23 or member.file_size > 120_000_000:
                raise ValueError(f"unexpected radar archive member: {filename}")
            prefix = f"{day}T{hour:02d}"
            records = json.loads(archive.read(member).decode("utf-8-sig"))
            hours.add((day, hour))
            for row in records:
                equipment, timestamp = row.get("ID EQP"), row.get("DATA HORA", "")
                if equipment is None or not timestamp.startswith(prefix):
                    excluded += 1
                    continue
                address = row.get("ENDERE�O", "").strip()
                direction = row.get("SENTIDO", "").strip()
                key = day, hour, str(equipment), address, direction
                group = grouped.get(key)
                if group is None:
                    lng, lat = number(row.get("LONGITUDE")), number(row.get("LATITUDE"))
                    group = [0, lng, lat]
                    grouped[key] = group
                group[0] += 1

    result = []
    for (day, hour, equipment, address, direction), (volume, lng, lat) in sorted(grouped.items()):
        address = (address.replace(" n� ", " nº ")
                   .replace(" n�", " nº").replace("�", ""))
        record = {
            "id": f"{day}:{hour}:{equipment}:{address}:{direction}", "date": day, "hour": hour,
            "equipmentId": equipment, "region": "Regional não atribuída",
            "road": address or f"Radar {equipment}", "direction": direction, "volume": volume,
            "lat": lat if lat_lon_ok(lng, lat) else None, "lng": lng if lat_lon_ok(lng, lat) else None,
        }
        result.append(record)
    if not result:
        raise ValueError("no radar passings accepted")
    equipment_count = len({point["equipmentId"] for point in result})
    return result, [
        source("radar", "Contagens volumétricas de radares · BHTRANS", slug, package,
               observedAt=result[-1]["date"], coverage=f"{len(hours)} horas publicadas em agosto de 2021",
               detail=f"{equipment_count} equipamentos identificados no arquivo AGOSTO_2021.zip. "
               "Volume por hora e equipamento nos intervalos presentes. "
               f"Horas ausentes permanecem vazias. {excluded:,} registros sem equipamento ou fora do intervalo."),
    ]


def gtfs_rows(archive, name):
    if name not in archive.namelist():
        return
    with io.TextIOWrapper(archive.open(name), encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def gtfs_date(value):
    return date.fromisoformat(value) if value else None


def transit(fetch):
    slug = "gtfs"
    package = fetch.package(slug)
    resource = next(entry for entry in package["resources"] if entry["url"].lower().endswith(".zip"))
    with ZipFile(fetch.get(resource["url"], "gtfs")) as archive:
        info = next(gtfs_rows(archive, "feed_info.txt"), {})
        start = gtfs_date(info.get("feed_start_date"))
        end = gtfs_date(info.get("feed_end_date"))
        reference = datetime.now(BRT).date()
        if start:
            reference = max(reference, start)
        if end:
            reference = min(reference, end)

        start_window = max(start, reference - timedelta(days=7)) if start else reference - timedelta(days=7)
        end_window = min(end, reference + timedelta(days=14)) if end else reference + timedelta(days=14)
        dates = [start_window + timedelta(days=i) for i in range((end_window - start_window).days + 1)]
        services = defaultdict(set)
        for row in gtfs_rows(archive, "calendar.txt"):
            for day in dates:
                if (row["start_date"] <= day.strftime("%Y%m%d") <= row["end_date"]
                        and row[WEEKDAYS[day.weekday()]] == "1"):
                    services[row["service_id"]].add(day.isoformat())
        window_dates = {day.isoformat() for day in dates}
        for row in gtfs_rows(archive, "calendar_dates.txt"):
            day = gtfs_date(row["date"]).isoformat()
            if day in window_dates:
                if row["exception_type"] == "1":
                    services[row["service_id"]].add(day)
                elif row["exception_type"] == "2":
                    services[row["service_id"]].discard(day)
        routes = {}
        for row in gtfs_rows(archive, "routes.txt"):
            id_ = row["route_id"]
            routes[id_] = {
                "id": id_, "name": row.get("route_long_name") or row.get("route_short_name") or id_,
                "shortName": row.get("route_short_name") or id_,
                "color": "#" + row["route_color"] if re.fullmatch("[A-Fa-f0-9]{6}", row.get("route_color", "")) else None,
                "trips": 0, "stops": [], "hours": [0] * 24, "calendar": {},
            }
        stops = {}
        for row in gtfs_rows(archive, "stops.txt"):
            lat, lng = number(row["stop_lat"]), number(row["stop_lon"])
            if lat_lon_ok(lng, lat):
                stops[row["stop_id"]] = {"id": row["stop_id"], "name": row["stop_name"], "lat": lat, "lng": lng}

        trips, frequencies, examples = {}, defaultdict(Counter), {}
        for row in gtfs_rows(archive, "trips.txt"):
            route_id = row["route_id"]
            if route_id not in routes:
                continue
            shape = row.get("shape_id") or ""
            direction = row.get("direction_id") or ""
            days = services[row["service_id"]]
            trips[row["trip_id"]] = (route_id, days)
            if shape:
                frequencies[(route_id, direction)][shape] += int(reference.isoformat() in days) or 0
                examples.setdefault((route_id, direction, shape), row["trip_id"])
        route_shapes = defaultdict(list)
        selected_trips = defaultdict(list)
        for (route_id, direction), counts in frequencies.items():
            shape = counts.most_common(1)[0][0]
            route_shapes[route_id].append((direction, shape))
            selected_trips[examples[(route_id, direction, shape)]].append((route_id, direction))
        shape_points = {shape: [] for shapes in route_shapes.values() for _, shape in shapes}
        for row in gtfs_rows(archive, "shapes.txt"):
            if row["shape_id"] not in shape_points:
                continue
            lat, lng = number(row["shape_pt_lat"]), number(row["shape_pt_lon"])
            if lat_lon_ok(lng, lat):
                shape_points[row["shape_id"]].append((int(row["shape_pt_sequence"]), [lng, lat]))

        departures, selected_stops, route_stop_ids = {}, defaultdict(list), defaultdict(set)
        for row in gtfs_rows(archive, "stop_times.txt"):
            trip_id = row["trip_id"]
            trip = trips.get(trip_id)
            if trip is None:
                continue
            route_id, _ = trip
            sequence = int(row["stop_sequence"])
            stop_id = row["stop_id"]
            if stop_id in stops:
                route_stop_ids[route_id].add(stop_id)
                for key in selected_trips.get(trip_id, ()):
                    selected_stops[key].append((sequence, stop_id))
            departure = row.get("departure_time") or row.get("arrival_time")
            if departure and re.fullmatch(r"\d{1,3}:[0-5]\d:[0-5]\d", departure):
                hour = int(departure.split(":", 1)[0])
                if trip_id not in departures or sequence < departures[trip_id][0]:
                    departures[trip_id] = sequence, hour

        for trip_id, (_, hour) in departures.items():
            route_id, days = trips[trip_id]
            route = routes[route_id]
            for day in days:
                by_hour = route["calendar"].setdefault(day, [0] * 24)
                by_hour[hour % 24] += 1
        for id_, route in routes.items():
            hours = route["calendar"].get(reference.isoformat(), [0] * 24)
            route["hours"], route["trips"] = hours, sum(hours)
            route["stops"] = sorted(route_stop_ids[id_])
            route["shapes"] = [
                {"direction": direction, "coordinates": [point for _, point in sorted(shape_points[shape])],
                 "stops": [stop for _, stop in sorted(selected_stops[(id_, direction)])]}
                for direction, shape in sorted(route_shapes[id_]) if len(shape_points[shape]) > 1
            ]
            if route["shapes"]:
                route["shape"] = route["shapes"][0]["coordinates"]

    if not routes or not stops:
        raise ValueError("empty GTFS routes or stops")
    snapshot = {
        "routes": list(routes.values()), "stops": list(stops.values()),
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "version": info.get("feed_version"), "scheduleDate": reference.isoformat(),
        "scheduleStart": start_window.isoformat(), "scheduleEnd": end_window.isoformat(),
    }
    return snapshot, [
        source("transit", "Horários programados GTFS · SUMOB", slug, package,
               observedAt=reference.isoformat(), coverage=f"{len(routes)} linhas e {len(stops)} paradas",
               detail=f"Viagens programadas por dia de serviço entre {start_window} e {end_window}. "
               "Partidas após meia-noite permanecem no dia operacional e aparecem na hora civil correspondente."),
    ]


def vehicle_lines(fetch):
    slug = "tempo_real_onibus_-_coordenada"
    package = fetch.package(slug)
    resource = next(
        entry for entry in package["resources"]
        if entry["id"] == "150bddd0-9a2c-4731-ade9-54aa56717fb6"
    )
    mapping = {}
    for row in csv_rows(fetch.get(resource["url"], limit=2_000_000)):
        code, line = row["numerolinha"], row["linha"]
        if not code or not line:
            continue
        if code in mapping and mapping[code] != line:
            raise ValueError(f"código de linha convencional ambíguo: {code}")
        mapping[code] = line
    if not mapping:
        raise ValueError("tabela de códigos de linha vazia")
    return mapping, [
        source("vehicle-lines", "Conversão de linhas do GPS convencional · PBH", slug, package,
               coverage=f"{len(mapping)} códigos de linha do sistema convencional",
               detail="Tabela oficial NumeroLinha → Linha. Preserva zeros à esquerda e sufixos de variante."),
    ]


def operations(fetch):
    slug = "mapa-de-controle-operacional-mco-consolidado-a-partir-de-abril-de-2022"
    package = fetch.package(slug)
    months = dict(zip(("janeiro", "fevereiro", "marco", "abril", "maio", "junho",
                       "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"), range(1, 13)))
    editions = []
    for entry in csv_resources(package):
        match = re.fullmatch(r"mco_([a-z]+)_(\d{4})", normalized(entry.get("name", "")))
        if match and match[1] in months:
            editions.append((int(match[2]), months[match[1]], entry))
    if not editions:
        raise ValueError("nenhuma edição mensal encontrada no catálogo MCO")
    year, month, entry = max(editions, key=lambda item: item[:2])
    period = f"{year:04d}-{month:02d}"
    path = fetch.get(entry["url"], "mco-" + period + ".csv")
    lines, days = Counter(), Counter()
    records, rejected = 0, 0
    for row in csv_rows(path):
        instant = event_time(row.get("viagem"))
        route = row.get("linha")
        passengers = number(row.get("total_usuarios"))
        if not instant or instant.strftime("%Y-%m") != period or not route or passengers is None or passengers < 0 or not passengers.is_integer():
            rejected += 1
            continue
        records += 1
        lines[route] += int(passengers)
        days[instant.date().isoformat()] += int(passengers)
    if not records:
        raise ValueError("nenhum registro MCO válido")
    value = {
        "month": period, "records": records, "passengers": sum(days.values()),
        "byLine": [{"label": line, "value": count} for line, count in lines.most_common()],
        "byDay": [{"label": day, "value": days[day]} for day in sorted(days)],
        "resource": entry["url"],
    }
    return value, [source("mco", "Mapa de Controle Operacional · SUMOB", slug, package,
                          observedAt=max(days), coverage=f"{period} · {records} registros válidos",
                          detail=f"Soma do campo TOTAL USUARIOS. Exclui registros de bloqueios BHBUS e de transferência MOVE conforme a fonte. {rejected} linhas descartadas.")]


def atomic_json(path, value):
    target = path.with_suffix(".json.tmp")
    try:
        with target.open("w", encoding="utf-8", newline="\n") as output:
            json.dump(value, output, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            output.write("\n")
        os.replace(target, path)
    finally:
        target.unlink(missing_ok=True)


IMPORTERS = {
    "neighborhoods": boundaries,
    "streets": streets,
    "accidents": accidents,
    "traffic": speed,
    "transit": transit,
    "radar": radar,
    "vehicle-lines": vehicle_lines,
    "mco": operations,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="*", metavar="FONTE",
                        help=f"default: {', '.join(IMPORTERS)}")
    parser.add_argument("--seed-folder", type=Path, help="Folder containing explicitly predownloaded official resources.")
    args = parser.parse_args()
    targets = args.sources or list(IMPORTERS)
    if any(target not in IMPORTERS for target in targets):
        parser.error(f"fonte desconhecida. Opções: {', '.join(IMPORTERS)}")
    DATA.mkdir(exist_ok=True)
    lock = DATA / ".ingest.lock"
    try:
        lock.mkdir()
    except FileExistsError:
        parser.error("uma ingestão já está em execução")
    try:
        path = DATA / "sources.json"
        existing = json.loads(path.read_bytes()) if path.is_file() else []
        catalog = {entry["id"]: entry for entry in existing}
        errors = []
        with tempfile.TemporaryDirectory(prefix="urbanflow-") as temp:
            fetch = Download(Path(temp), args.seed_folder)
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = {target: pool.submit(IMPORTERS[target], fetch) for target in dict.fromkeys(targets)}
                for target, future in futures.items():
                    try:
                        snapshot, entries = future.result()
                        output = DATA / (target + ".json")
                        missing = [item for entry in entries for item in entry.get("missingResources", [])]
                        if missing and output.is_file() and target in catalog and not catalog[target].get("missingResources"):
                            raise ValueError("recursos indisponíveis, mantendo a versão completa anterior: " + ", ".join(missing))
                        if target in ("accidents", "traffic", "radar"):
                            assign_neighborhoods(snapshot, include_region=target != "accidents")
                        atomic_json(output, snapshot)
                        catalog.update({entry["id"]: entry for entry in entries})
                        if missing:
                            errors.append(target)
                        print(f"{target}: {entries[0].get('coverage', 'importado')}", flush=True)
                    except Exception as error:
                        errors.append(target)
                        entry = catalog.get(target, {"id": target, "name": target, "status": "unavailable"})
                        entry["lastAttemptAt"] = datetime.now(timezone.utc).isoformat()
                        entry["lastError"] = str(error)
                        catalog[target] = entry
                        print(f"{target}: {error}", file=sys.stderr, flush=True)
        atomic_json(path, list(catalog.values()))
        return int(bool(errors))
    finally:
        lock.rmdir()


if __name__ == "__main__":
    sys.exit(main())
