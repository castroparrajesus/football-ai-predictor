-- Football AI Predictor — Migración 0004: Motor Predictivo Avanzado, Backtesting Walk-Forward y Registro de Valor (Fase 5)

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS trained_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS eval_metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  model_version_id TEXT REFERENCES model_versions(id) ON DELETE SET NULL,
  league_filter TEXT NOT NULL DEFAULT 'all',
  season_filter TEXT,
  calibration_method TEXT NOT NULL DEFAULT 'platt',
  total_matches_evaluated INTEGER NOT NULL DEFAULT 0,
  warmup_matches INTEGER NOT NULL DEFAULT 0,
  summary_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS value_opportunities_log (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version_id TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  model_prob NUMERIC(6,5) NOT NULL CHECK (model_prob > 0 AND model_prob < 1),
  decimal_odds NUMERIC(8,4) NOT NULL CHECK (decimal_odds > 1.0),
  implied_prob_raw NUMERIC(6,5) NOT NULL,
  implied_prob_devig NUMERIC(6,5),
  fair_odds NUMERIC(8,4) NOT NULL,
  edge_pp NUMERIC(7,4) NOT NULL,
  expected_value NUMERIC(8,5) NOT NULL,
  confidence_tier TEXT NOT NULL,
  odds_captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'ganada', 'perdida', 'anulada')),
  actual_result TEXT,
  realized_roi_unit NUMERIC(8,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CONSTRAINT uq_value_opp_match_sel UNIQUE (match_id, market, selection, bookmaker)
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_value_opps_match ON value_opportunities_log(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_value_opps_status ON value_opportunities_log(status);

ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE value_opportunities_log ENABLE ROW LEVEL SECURITY;
