CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS urbanflow_snapshot (
  name text PRIMARY KEY,
  content jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS urbanflow_geometry (
  source text NOT NULL,
  id text NOT NULL,
  properties jsonb NOT NULL,
  geom geometry(Geometry,4326) NOT NULL,
  PRIMARY KEY (source,id)
);

CREATE INDEX IF NOT EXISTS urbanflow_geometry_geom ON urbanflow_geometry USING gist (geom);
