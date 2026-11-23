# Football AI Predictor — Arquitectura del Sistema (Fases 1 a 11)

## 1. Visión Técnica y Principios de Diseño

Football AI Predictor es una plataforma de análisis estadístico y modelado probabilístico para las cinco grandes ligas europeas (**Premier League, LaLiga, Serie A, Bundesliga y Ligue 1**).

### Principios innegociables
1. **Separación estricta de datos**: Nunca se mezclan datos reales de API/CSV con datos sintéticos de prueba. El origen de los datos (`none`, `sandbox`, `csv`, `api`) es explícito en todo momento.
2. **Sin fuga de información futura (No Data Leakage)**: Toda predicción se registra con marca temporal previa al inicio del partido (`created_at < kickoff_utc`), congelando cuotas y variables de entrada disponibles en ese instante.
3. **Evaluación probabilística real**: Más allá del acierto binario, el rendimiento se evalúa con **Brier Score**, **Log Loss**, **curvas de calibración** y **ROI simulado** fuera de muestra.
4. **Incertidumbre explícita**: Si faltan variables críticas (xG, alineaciones, bajas, histórico suficiente), la confianza se degrada automáticamente (`A` -> `B` -> `C` -> `DESCARTADO`). Si ningún partido supera el umbral de calidad, el sistema no fuerza pronósticos.

---

## 2. Arquitectura de Carpetas (Planificada para Fases 1–11)

```text
/
├── ARCHITECTURE.md                 # Documentación de arquitectura y roadmap por fases
├── metadata.json                   # Metadatos de aplicación
├── index.html                      # Entrypoint HTML + tipografía (Outfit, Plus Jakarta Sans, JetBrains Mono)
├── server.ts                       # (Fase 3-4) Servidor Node/Express + proxy seguro hacia APIs/Python ML
├── src/
│   ├── types/
│   │   └── football.ts             # Contratos TypeScript: ligas, equipos (27 métricas), modelos, mercados, EV
│   ├── data/
│   │   └── sandboxDataset.ts       # Dataset sintético de prueba claramente etiquetado (Fase 2 UI Sandbox)
│   ├── utils/
│   │   ├── previewMath.ts          # Motor matemático cliente: Poisson, matriz de marcadores, EV, Brier, LogLoss
│   │   └── csvImporter.ts          # Parser y validador CSV + generador de plantilla descargable
│   ├── services/                   # (Fase 3-4) Adaptadores de proveedores deportivos (Provider Adapter Pattern)
│   │   ├── providers/              # API-Football, Football-Data.org, Sportmonks, The Odds API
│   │   └── repository.ts           # Capa de persistencia (PostgreSQL / Drizzle / Supabase)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx         # Menú lateral de 10 secciones (responsive desktop/mobile)
│   │   │   └── TopBar.tsx          # Barra superior con breadcrumb, filtro global de liga y fuente de datos
│   │   ├── ui/
│   │   │   └── DataSourceBanner.tsx# Indicador transparente de fuente activa (Sin API / Sandbox / CSV)
│   │   ├── charts/
│   │   │   └── SimpleCharts.tsx    # Curva de calibración, tendencia Brier/LogLoss, matriz Poisson, comparador
│   │   └── MatchAnalyzerDrawer.tsx # Analizador completo de partido (botón ANALIZAR PARTIDO)
│   └── views/                      # 10 vistas principales de la plataforma
│       ├── DashboardView.tsx
│       ├── MatchesTodayView.tsx
│       ├── LeaguesView.tsx
│       ├── AiAnalysisView.tsx
│       ├── PredictionsView.tsx
│       ├── ValueFinderView.tsx
│       ├── ModelComparatorView.tsx
│       ├── HistoryView.tsx
│       ├── PerformanceView.tsx
│       └── SettingsView.tsx
└── ml_engine/                      # (Fase 5-10) Microservicio Python FastAPI opcional para entrenamiento ML
    ├── app/
    │   ├── main.py                 # Endpoints REST (/predict, /calibrate, /backtest)
    │   ├── models/
    │   │   ├── poisson.py          # Poisson bivariado / Dixon-Coles
    │   │   ├── elo.py              # Elo dinámico ajustado por diferencia de goles y localía
    │   │   ├── ml_models.py        # LightGBM / XGBoost / Random Forest / Regresión Logística
    │   │   ├── form_home_away.py   # Ventanas 5/10/15 y descomposición local/visitante
    │   │   └── ensemble.py         # Combinador ponderado + Calibración Isotónica / Platt
    │   └── backtesting/
    │       └── walk_forward.py     # Validación temporal estricta por temporada
```

---

## 3. Diseño de Base de Datos Relacional (Fase 3)

Entidades normalizadas para PostgreSQL:
1. `leagues` (`id`, `code`, `name`, `country`, `season`, `tier`)
2. `teams` (`id`, `league_id`, `name`, `short_name`, `external_refs_json`)
3. `players` (`id`, `team_id`, `name`, `position`, `status`)
4. `matches` (`id`, `league_id`, `season`, `matchday`, `kickoff_utc`, `home_team_id`, `away_team_id`, `status`)
5. `match_results` (`match_id`, `home_goals`, `away_goals`, `ht_home_goals`, `ht_away_goals`, `settled_at`)
6. `team_match_stats` (`match_id`, `team_id`, `is_home`, `xg`, `xga`, `shots`, `shots_on_target`, `corners`, `yellow_cards`, `red_cards`, `possession`)
7. `lineups` (`match_id`, `team_id`, `formation`, `starters_json`, `confirmed`, `fetched_at`)
8. `injuries_suspensions` (`id`, `team_id`, `player_id`, `reason`, `severity`, `expected_return`, `updated_at`)
9. `odds_snapshots` (`id`, `match_id`, `bookmaker`, `market`, `selection`, `decimal_odds`, `captured_at`, `is_closing`)
10. `model_versions` (`id`, `name`, `weights_json`, `calibration_method`, `trained_until_utc`, `created_at`)
11. `predictions` (`id`, `match_id`, `model_version_id`, `created_at`, `data_completeness_score`, `confidence_tier`, `model_outputs_json`, `markets_json`, `score_matrix_json`)
12. `prediction_outcomes` (`prediction_id`, `market`, `selection`, `predicted_prob`, `odds_used`, `actual_outcome`, `brier_score`, `log_loss`, `simulated_roi`, `evaluated_at`)
13. `calibration_history` (`id`, `model_version_id`, `league_id`, `window_end`, `bin_data_json`, `brier_score`, `log_loss`)

---

## 4. Fuentes de Datos Investigadas (Fase 4 — Provider Adapter)

Para evitar acoplamiento, la capa `DataProviderAdapter` normaliza respuestas de cualquier proveedor externo:
- **Football-Data.org**: Cobertura gratuita limitada de las 5 grandes ligas (resultados, tablas, calendario básico; sin xG ni alineaciones detalladas en tier gratuito; límite ~10 req/min).
- **API-Football (API-Sports)**: Cobertura amplia (tablas, eventos, estadísticas de partido, lesiones, alineaciones, cuotas pre-partido; plan gratuito 100 req/día; planes de pago desde ~19 USD/mes).
- **Sportmonks Football API**: Datos avanzados incluyendo xG en planes superiores, lesiones y alineaciones; precios por liga/add-on.
- **The Odds API**: Cuotas decimales multi-bookmaker (1X2, Totals/Over-Under) para comparar probabilidades implícitas; tier gratuito de 500 créditos/mes.
- **Importación CSV (ej. Football-Data.co.uk)**: Gratuita, ideal para backtesting histórico multi-temporada de resultados, tiros, córners, tarjetas y cuotas de cierre.

---

## 5. Hoja de Ruta por Fases

- **FASE 1 (Completada en esta entrega)**: Arquitectura modular, contratos de dominio TypeScript, diseño de esquema BD y adaptadores.
- **FASE 2 (Completada en esta entrega)**: Interfaz Dark Mode completa con las 10 vistas operativas, gráficos SVG de calibración/tendencias/matriz, analizador de partido, Value Finder matemático e importador CSV.
- **FASE 3**: PostgreSQL + migraciones (13 tablas) + CRUD de ligas, equipos y partidos.
- **FASE 4**: Integración de proveedores reales (Football-Data / API-Football / The Odds API) con caché y control de rate-limit.
- **FASE 5**: Motor Poisson / Dixon-Coles completo en backend.
- **FASE 6**: Elo dinámico por liga + modelos ML (LightGBM / XGBoost / Random Forest / Regresión Logística) con validación temporal.
- **FASE 7**: Ensemble ponderado, calibración Isotónica / Platt y penalización automática por discrepancia o datos faltantes.
- **FASE 8**: Escáner automatizado de mercados y detección de Valor (EV) con eliminación de margen.
- **FASE 9**: Registro inmutable pre-partido y liquidación automática post-partido.
- **FASE 10**: Backtesting walk-forward por temporadas y detección de deriva (model drift).
- **FASE 11**: Contenerización Docker, hardening de seguridad y despliegue productivo.
