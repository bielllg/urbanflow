"""Render the overview preview from the official BHGeo neighborhood polygons."""

import json
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union


root = Path(__file__).resolve().parents[1]
snapshot = json.loads((root / "data/neighborhoods.json").read_bytes())
areas = [shape(feature["geometry"]).simplify(0.00012, preserve_topology=True)
         for feature in snapshot["features"]]
west, south, east, north = unary_union(areas).bounds
scale = min(660 / ((east - west) * 0.94), 310 / (north - south))


def ring_path(ring):
    coordinates = [(round(360 + (x - (west + east) / 2) * scale * 0.94, 1),
                    round(175 - (y - (south + north) / 2) * scale, 1))
                   for x, y in ring.coords]
    return "M" + " ".join(f"{x:g},{y:g}" for x, y in coordinates[:-1]) + "Z"


paths = []
colors = ("#edf4ef", "#dfece7", "#d3e8e3", "#c8e2db")
for index, area in enumerate(areas):
    polygons = area.geoms if area.geom_type == "MultiPolygon" else (area,)
    path = "".join(ring_path(polygon.exterior) + "".join(map(ring_path, polygon.interiors))
                   for polygon in polygons)
    paths.append(f'<path fill="{colors[index % len(colors)]}" d="{path}"/>')

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 350">'
       '<title>Limites de bairros de Belo Horizonte, BHGeo/PBH</title>'
       '<g stroke="#7cafa5" stroke-width=".6" stroke-linejoin="round" fill-rule="evenodd">'
       + "".join(paths) + '</g></svg>\n')
(root / "public").mkdir(exist_ok=True)
(root / "public/bh-bairros.svg").write_text(svg, encoding="utf-8")
