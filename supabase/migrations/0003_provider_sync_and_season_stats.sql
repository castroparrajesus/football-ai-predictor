-- Football AI Predictor — Migración 0003: Estadísticas de temporada por equipo y logs de sincronización (Fase 4)

CREATE TABLE IF NOT EXISTS team_season_stats (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  position INTEGER,
  points INTEGER,
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  drawn INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  goals_for INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  xg NUMERIC(7,3),
  xga NUMERIC(7,3),
  home_played INTEGER,
  home_won INTEGER,
  home_drawn INTEGER,
  home_lost INTEGER,
  home_gf INTEGER,
  home_ga INTEGER,
  away_played INTEGER,
  away_won INTEGER,
  away_drawn INTEGER,
  away_lost INTEGER,
  away_gf INTEGER,
  away_ga INTEGER,
  form_string TEXT,
  source_provider TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_season_stats UNIQUE (team_id, season_id)
);

CREATE TABLE IF NOT EXISTS provider_sync_logs (
  id BIGSERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL,
  league_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  matches_upserted INTEGER NOT NULL DEFAULT 0,
  teams_upserted INTEGER NOT NULL DEFAULT 0,
  odds_inserted INTEGER NOT NULL DEFAULT 0,
  requests_used INTEGER NOT NULL DEFAULT 0,
  quota_remaining TEXT,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_season_stats_league ON team_season_stats(league_id, season_id);
CREATE INDEX IF NOT EXISTS idx_provider_sync_logs_date ON provider_sync_logs(synced_at DESC);

ALTER TABLE team_season_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_sync_logs ENABLE ROW LEVEL SECURITY;
