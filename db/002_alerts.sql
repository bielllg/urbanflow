CREATE TABLE IF NOT EXISTS urbanflow_alert_delivery (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS urbanflow_alert_delivery_pending
  ON urbanflow_alert_delivery (next_attempt) WHERE sent_at IS NULL;
