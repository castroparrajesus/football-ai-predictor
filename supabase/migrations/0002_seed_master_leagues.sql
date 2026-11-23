-- Football AI Predictor — Migración 0002: Datos maestros iniciales (5 Grandes Ligas, Temporadas y Modelo Base)
-- Nota: Solo datos maestros estructurales. NO inserta partidos ni estadísticas inventadas.

INSERT INTO leagues (id, code, name, country, tier, teams_count)
VALUES
  ('premier_league', 'E0', 'Premier League', 'Inglaterra', 1, 20),
  ('laliga', 'SP1', 'LaLiga', 'España', 1, 20),
  ('serie_a', 'I1', 'Serie A', 'Italia', 1, 20),
  ('bundesliga', 'D1', 'Bundesliga', 'Alemania', 1, 18),
  ('ligue_1', 'F1', 'Ligue 1', 'Francia', 1, 18)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  teams_count = EXCLUDED.teams_count;

INSERT INTO seasons (id, label, start_date, end_date, is_current)
VALUES
  ('2025-2026', 'Temporada 2025/26', '2025-08-01', '2026-06-30', FALSE),
  ('2026-2027', 'Temporada 2026/27', '2026-08-01', '2027-06-30', TRUE)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  is_current = EXCLUDED.is_current;

INSERT INTO model_versions (id, name, weights, thresholds, calibration_method, is_active)
VALUES (
  'ensemble-v1-phase3',
  'Ensemble Base Fase 3',
  '{"poisson": 0.25, "elo": 0.22, "machineLearning": 0.25, "recentForm": 0.14, "homeAway": 0.14}'::jsonb,
  '{"minCompletenessPct": 75, "maxModelSpreadPct": 12, "minExpectedValuePct": 2.5, "strictModeNoForce": false}'::jsonb,
  'uncalibrated',
  TRUE
)
ON CONFLICT (id) DO NOTHING;
