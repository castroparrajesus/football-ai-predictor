-- Football AI Predictor — Migración 0005: Enriquecimiento, Historial Inmutable de Cuotas,
-- Seguimiento Pre-partido, Reproducibilidad de Backtesting y Monitorización (Fase 6)

-- 1. Ampliar metadatos de seguimiento pre-partido y CLV en predictions / prediction_outcomes / value_opportunities_log
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS bookmaker TEXT,
  ADD COLUMN IF NOT EXISTS fair_odds NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS closing_odds NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS clv_pct NUMERIC(8,4);

ALTER TABLE prediction_outcomes
  ADD COLUMN IF NOT EXISTS closing_odds NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS clv_pct NUMERIC(8,4);

ALTER TABLE value_opportunities_log
  ADD COLUMN IF NOT EXISTS opening_odds NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS closing_odds NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS clv_pct NUMERIC(8,4);

-- 2. Ampliar backtest_runs con parámetros deterministas para reproducibilidad por runId
ALTER TABLE backtest_runs
  ADD COLUMN IF NOT EXISTS cutoff_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS weights_json JSONB,
  ADD COLUMN IF NOT EXISTS dataset_audit_json JSONB;

-- 3. Ampliar odds_snapshots con minutos hasta el inicio y protección ante actualizaciones/borrados accidentales
ALTER TABLE odds_snapshots
  ADD COLUMN IF NOT EXISTS minutes_to_kickoff INTEGER;

-- Evitar duplicados exactos en el mismo instante (misma captura) conservando el historial de cambios
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_closing ON odds_snapshots(match_id, market, selection, is_closing, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_match_version ON predictions(match_id, model_version_id, selected_market);

-- 4. Configuración persistente de monitorización y captura automática pre-partido
CREATE TABLE IF NOT EXISTS monitoring_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auto_odds_capture_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  capture_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (capture_interval_minutes BETWEEN 30 AND 1440),
  closing_window_minutes INTEGER NOT NULL DEFAULT 90 CHECK (closing_window_minutes BETWEEN 15 AND 240),
  min_remaining_credits_guard INTEGER NOT NULL DEFAULT 50 CHECK (min_remaining_credits_guard >= 0),
  auto_settle_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_auto_odds_run_at TIMESTAMPTZ,
  last_auto_settle_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO monitoring_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- 5. Función y triggers de inmutabilidad para odds_snapshots (append-only salvo marcado inicial de cierre)
CREATE OR REPLACE FUNCTION prevent_odds_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'odds_snapshots es inmutable: no se permiten eliminaciones históricas.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.decimal_odds IS DISTINCT FROM OLD.decimal_odds
       OR NEW.bookmaker IS DISTINCT FROM OLD.bookmaker
       OR NEW.market IS DISTINCT FROM OLD.market
       OR NEW.selection IS DISTINCT FROM OLD.selection
       OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
      RAISE EXCEPTION 'odds_snapshots es inmutable: no se pueden alterar cuotas históricas registradas.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_odds_snapshots_immutable ON odds_snapshots;
CREATE TRIGGER trg_odds_snapshots_immutable
  BEFORE UPDATE OR DELETE ON odds_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION prevent_odds_snapshot_mutation();

ALTER TABLE monitoring_config ENABLE ROW LEVEL SECURITY;
