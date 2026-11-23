-- Football AI Predictor — Migración 0001: Esquema inicial normalizado (PostgreSQL / Supabase)
-- Seguro para ejecución idempotente (CREATE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Ligas (Datos maestros)
CREATE TABLE IF NOT EXISTS leagues (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  teams_count INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Temporadas
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Equipos
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  elo_rating NUMERIC(7,2) NOT NULL DEFAULT 1500.00,
  external_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_teams_league_name UNIQUE (league_id, name)
);

-- 4. Jugadores
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Partidos
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  matchday INTEGER NOT NULL DEFAULT 0,
  kickoff_utc TIMESTAMPTZ NOT NULL,
  home_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  away_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  source_type TEXT NOT NULL DEFAULT 'csv' CHECK (source_type IN ('api', 'csv', 'manual')),
  external_id TEXT,
  expected_lambda_home NUMERIC(6,3),
  expected_lambda_away NUMERIC(6,3),
  data_completeness INTEGER NOT NULL DEFAULT 0 CHECK (data_completeness BETWEEN 0 AND 100),
  missing_data_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_distinct_teams CHECK (home_team_id <> away_team_id),
  CONSTRAINT uq_match_fixture UNIQUE (league_id, season_id, home_team_id, away_team_id, kickoff_utc)
);

-- 6. Resultados de partidos
CREATE TABLE IF NOT EXISTS match_results (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  home_goals INTEGER NOT NULL CHECK (home_goals >= 0),
  away_goals INTEGER NOT NULL CHECK (away_goals >= 0),
  ht_home_goals INTEGER CHECK (ht_home_goals >= 0),
  ht_away_goals INTEGER CHECK (ht_away_goals >= 0),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Estadísticas de equipo por partido
CREATE TABLE IF NOT EXISTS team_match_stats (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_home BOOLEAN NOT NULL,
  xg NUMERIC(6,3),
  xga NUMERIC(6,3),
  shots INTEGER,
  shots_on_target INTEGER,
  corners INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  possession NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_match_stats UNIQUE (match_id, team_id)
);

-- 8. Alineaciones
CREATE TABLE IF NOT EXISTS lineups (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  formation TEXT,
  starters JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_match_team_lineup UNIQUE (match_id, team_id)
);

-- 9. Lesiones y sanciones
CREATE TABLE IF NOT EXISTS injuries_suspensions (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('lesión', 'sanción', 'duda')),
  severity TEXT NOT NULL DEFAULT 'media' CHECK (severity IN ('alta', 'media', 'baja')),
  expected_return DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Cuotas y snapshots de mercado
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  decimal_odds NUMERIC(8,4) NOT NULL CHECK (decimal_odds > 1.0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_closing BOOLEAN NOT NULL DEFAULT FALSE
);

-- 11. Versiones y configuración de modelos
CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  weights JSONB NOT NULL,
  thresholds JSONB NOT NULL,
  calibration_method TEXT NOT NULL DEFAULT 'none',
  trained_until_utc TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Pronósticos y snapshots pre-partido
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version_id TEXT NOT NULL REFERENCES model_versions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_completeness_score INTEGER NOT NULL CHECK (data_completeness_score BETWEEN 0 AND 100),
  confidence_tier TEXT NOT NULL CHECK (confidence_tier IN ('A', 'B', 'C', 'DESCARTADO')),
  expected_score TEXT NOT NULL,
  model_outputs JSONB NOT NULL,
  markets JSONB NOT NULL,
  score_matrix JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_market TEXT NOT NULL DEFAULT 'Resultado 1X2',
  selected_selection TEXT NOT NULL,
  predicted_prob NUMERIC(6,5) NOT NULL CHECK (predicted_prob > 0 AND predicted_prob < 1),
  odds_at_prediction NUMERIC(8,4) NOT NULL CHECK (odds_at_prediction >= 1.0),
  source_type TEXT NOT NULL DEFAULT 'db'
);

-- 13. Resultados y liquidación de pronósticos
CREATE TABLE IF NOT EXISTS prediction_outcomes (
  id BIGSERIAL PRIMARY KEY,
  prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  predicted_prob NUMERIC(6,5) NOT NULL,
  odds_used NUMERIC(8,4) NOT NULL,
  actual_outcome SMALLINT NOT NULL CHECK (actual_outcome IN (0, 1)),
  actual_result TEXT NOT NULL,
  brier_score NUMERIC(8,6) NOT NULL,
  log_loss NUMERIC(8,6) NOT NULL,
  simulated_roi NUMERIC(8,4) NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_prediction_outcome UNIQUE (prediction_id, market, selection)
);

-- 14. Historial de calibración y evaluación
CREATE TABLE IF NOT EXISTS calibration_history (
  id BIGSERIAL PRIMARY KEY,
  model_version_id TEXT NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
  league_id TEXT REFERENCES leagues(id) ON DELETE SET NULL,
  window_end TIMESTAMPTZ NOT NULL,
  bin_data JSONB NOT NULL,
  brier_score NUMERIC(8,6) NOT NULL,
  log_loss NUMERIC(8,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Auditoría de importaciones CSV / sincronizaciones
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  filename TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_skipped_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_invalid INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de consulta eficiente
CREATE INDEX IF NOT EXISTS idx_teams_league ON teams(league_id);
CREATE INDEX IF NOT EXISTS idx_matches_league_kickoff ON matches(league_id, kickoff_utc DESC);
CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON matches(kickoff_utc DESC);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_odds_match_market ON odds_snapshots(match_id, market, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_evaluated ON prediction_outcomes(evaluated_at DESC);

-- Seguridad RLS en Supabase: bloquea acceso directo anónimo PostgREST;
-- todas las lecturas/escrituras pasan por el backend Express autenticado vía DATABASE_URL.
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_match_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE injuries_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- Políticas de solo lectura pública únicamente para catálogo maestro de ligas/temporadas si se consultara vía anon
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'leagues' AND policyname = 'leagues_public_read'
  ) THEN
    CREATE POLICY leagues_public_read ON leagues FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'seasons' AND policyname = 'seasons_public_read'
  ) THEN
    CREATE POLICY seasons_public_read ON seasons FOR SELECT USING (true);
  END IF;
END $$;
