import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import { runMigrations } from './src/db/migrate.ts';
import {
  createPredictionSnapshotInDb,
  getActiveModelConfigFromDb,
  getDbStatusSummary,
  getDetectedValueOpportunities,
  getLeaguesFromDb,
  getMatchesFromDb,
  getPerformanceMetricsFromDb,
  getPredictionHistoryFromDb,
  getSeasonsFromDb,
  getTeamsFromDb,
  persistCsvBatchToDb,
  saveDetectedValueOpportunity,
  settleDetectedValueOpportunities,
  settlePredictionInDb,
  updateActiveModelConfigInDb,
  updateMatchResultInDb,
} from './src/db/repository.ts';
import { dataSyncService } from './src/services/providers/DataSyncService.ts';
import { runDatabaseAudit } from './src/services/engine/dataAudit.ts';
import {
  getActiveTrainedModelFromDb,
  getBacktestByRunId,
  getBacktestHistoryFromDb,
  reproduceBacktestByRunId,
  runWalkForwardBacktest,
} from './src/services/engine/backtestService.ts';
import {
  autoSettleAllPendingInDb,
  capturePreMatchOddsSnapshot,
  captureUpcomingPredictionsBatchInDb,
  getMonitoringDashboardData,
  getOddsHistoryTimelines,
  startMonitoringScheduler,
  updateMonitoringConfig,
} from './src/services/engine/monitoringService.ts';

dotenv.config();

const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production';

const leagueIdSchema = z.enum([
  'premier_league',
  'laliga',
  'serie_a',
  'bundesliga',
  'ligue_1',
]);

const csvImportSchema = z.object({
  filename: z.string().min(1).max(200),
  rows: z
    .array(
      z.object({
        leagueId: leagueIdSchema,
        seasonId: z.string().min(4).max(20).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kickoffTime: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
        matchday: z.number().int().min(0).max(60).optional(),
        homeTeamName: z.string().min(2).max(100),
        awayTeamName: z.string().min(2).max(100),
        lambdaHome: z.number().positive().max(10).nullable().optional(),
        lambdaAway: z.number().positive().max(10).nullable().optional(),
        oddsHome: z.number().gt(1.0).max(200).nullable().optional(),
        oddsDraw: z.number().gt(1.0).max(200).nullable().optional(),
        oddsAway: z.number().gt(1.0).max(200).nullable().optional(),
        bookmaker: z.string().max(80).optional(),
        homeGoals: z.number().int().min(0).max(30).nullable().optional(),
        awayGoals: z.number().int().min(0).max(30).nullable().optional(),
        homeShots: z.number().int().min(0).max(100).nullable().optional(),
        awayShots: z.number().int().min(0).max(100).nullable().optional(),
        homeShotsOnTarget: z.number().int().min(0).max(100).nullable().optional(),
        awayShotsOnTarget: z.number().int().min(0).max(100).nullable().optional(),
        homeCorners: z.number().int().min(0).max(50).nullable().optional(),
        awayCorners: z.number().int().min(0).max(50).nullable().optional(),
        homeYellowCards: z.number().int().min(0).max(20).nullable().optional(),
        awayYellowCards: z.number().int().min(0).max(20).nullable().optional(),
        homeXg: z.number().min(0).max(15).nullable().optional(),
        awayXg: z.number().min(0).max(15).nullable().optional(),
      })
    )
    .min(1)
    .max(2000),
});

const createPredictionSchema = z.object({
  matchId: z.string().min(1).max(150),
  modelVersionId: z.string().max(80).optional(),
  confidenceTier: z.enum(['A', 'B', 'C', 'DESCARTADO']),
  dataCompletenessScore: z.number().int().min(0).max(100),
  expectedScore: z.string().min(3).max(15),
  modelOutputs: z.record(z.string(), z.unknown()),
  markets: z.record(z.string(), z.unknown()),
  scoreMatrix: z.array(z.unknown()).optional(),
  selectedMarket: z.string().min(1).max(100),
  selectedSelection: z.string().min(1).max(120),
  predictedProb: z.number().gt(0).lt(1),
  oddsAtPrediction: z.number().gte(1.0).max(500),
  bookmaker: z.string().max(80).nullable().optional(),
  fairOdds: z.number().gt(1.0).max(500).nullable().optional(),
});

const matchResultSchema = z.object({
  homeGoals: z.number().int().min(0).max(30),
  awayGoals: z.number().int().min(0).max(30),
  htHomeGoals: z.number().int().min(0).max(30).optional(),
  htAwayGoals: z.number().int().min(0).max(30).optional(),
});

const settlePredictionSchema = z.object({
  actualOutcome: z.union([z.literal(0), z.literal(1)]),
  actualResult: z.string().min(1).max(30),
});

const modelConfigSchema = z.object({
  weights: z.object({
    poisson: z.number().min(0).max(1),
    elo: z.number().min(0).max(1),
    machineLearning: z.number().min(0).max(1),
    recentForm: z.number().min(0).max(1),
    homeAway: z.number().min(0).max(1),
  }),
  thresholds: z.object({
    minCompletenessPct: z.number().min(0).max(100),
    maxModelSpreadPct: z.number().min(1).max(100),
    minExpectedValuePct: z.number().min(0).max(100),
    strictModeNoForce: z.boolean(),
  }),
});

const syncRunSchema = z.object({
  provider: z.enum(['football_data', 'api_football', 'the_odds_api']),
  leagueId: z.enum([
    'premier_league',
    'laliga',
    'serie_a',
    'bundesliga',
    'ligue_1',
    'all',
  ]),
  seasonYear: z.number().int().min(2020).max(2030).optional(),
  includeOdds: z.boolean().optional(),
});

const backtestRunSchema = z.object({
  leagueId: z
    .enum(['premier_league', 'laliga', 'serie_a', 'bundesliga', 'ligue_1', 'all'])
    .default('all'),
  seasonId: z.string().max(25).optional(),
  calibrationMethod: z.enum(['platt', 'isotonic', 'none']).default('platt'),
  trainAndActivate: z.boolean().default(true),
});

const valueOppCreateSchema = z.object({
  matchId: z.string().min(1).max(150),
  modelVersionId: z.string().max(80).optional(),
  market: z.string().min(1).max(100),
  selection: z.string().min(1).max(120),
  bookmaker: z.string().min(1).max(80),
  modelProb: z.number().gt(0).lt(1),
  decimalOdds: z.number().gt(1.0).max(500),
  impliedProbRaw: z.number().gt(0).lt(1),
  impliedProbDevig: z.number().gt(0).lt(1).nullable(),
  fairOdds: z.number().gt(1.0).max(500),
  edgePp: z.number().min(-100).max(100),
  expectedValue: z.number().min(-1).max(50),
  confidenceTier: z.enum(['A', 'B', 'C', 'DESCARTADO']),
  oddsCapturedAt: z.string().nullable().optional(),
});

const monitoringConfigSchema = z.object({
  autoOddsCaptureEnabled: z.boolean().optional(),
  captureIntervalMinutes: z.number().int().min(30).max(1440).optional(),
  closingWindowMinutes: z.number().int().min(15).max(240).optional(),
  minRemainingCreditsGuard: z.number().int().min(0).max(10000).optional(),
  autoSettleEnabled: z.boolean().optional(),
});

const leagueScopeBodySchema = z.object({
  leagueId: z
    .enum(['premier_league', 'laliga', 'serie_a', 'bundesliga', 'ligue_1', 'all'])
    .default('all'),
});

function handleApiError(res: Response, err: unknown, fallbackMessage: string) {
  const status = (err as { statusCode?: number })?.statusCode ?? 500;
  const message =
    status === 503 || status === 404 || status === 400
      ? (err as Error).message
      : fallbackMessage;
  if (status >= 500) {
    console.error('[API Error]:', err instanceof Error ? err.message : err);
  }
  res.status(status).json({ ok: false, error: message });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Estado y migración de PostgreSQL / Supabase
  app.get('/api/health/db', async (_req: Request, res: Response) => {
    try {
      const status = await getDbStatusSummary();
      res.json({ ok: true, data: status });
    } catch (err) {
      handleApiError(res, err, 'Error verificando estado de la base de datos.');
    }
  });

  app.post('/api/db/migrate', async (_req: Request, res: Response) => {
    try {
      const result = await runMigrations();
      res.json({ ok: true, data: result });
    } catch (err) {
      handleApiError(res, err, 'Error ejecutando migraciones en PostgreSQL.');
    }
  });

  // Proveedores de datos deportivos reales (Fase 4)
  app.get('/api/providers/status', async (_req: Request, res: Response) => {
    try {
      const data = await dataSyncService.getProvidersStatus();
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando estado de proveedores de datos.');
    }
  });

  app.post('/api/sync/run', async (req: Request, res: Response) => {
    const parsed = syncRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Parámetros de sincronización inválidos.',
        details: parsed.error.issues.slice(0, 5),
      });
      return;
    }

    try {
      const summary = await dataSyncService.syncFromProvider({
        provider: parsed.data.provider,
        leagueFilter: parsed.data.leagueId,
        seasonYear: parsed.data.seasonYear,
        includeOdds: parsed.data.includeOdds,
      });
      res.json({ ok: true, data: summary });
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status) {
        handleApiError(res, err, 'Error sincronizando datos desde el proveedor.');
        return;
      }
      // Errores controlados de proveedor externo (cuota, permisos, HTTP)
      const providerMsg =
        err instanceof Error &&
        (err.message.includes('429') ||
          err.message.includes('401') ||
          err.message.includes('403') ||
          err.message.includes('Football-Data.org') ||
          err.message.includes('API-Football') ||
          err.message.includes('The Odds API') ||
          err.message.includes('ODDS_API_KEY') ||
          err.message.includes('API_FOOTBALL_KEY') ||
          err.message.includes('FOOTBALL_DATA_API_KEY'))
          ? err.message
          : 'Error obteniendo o guardando datos del proveedor deportivo.';
      console.error('[Sync Error]:', err instanceof Error ? err.message : err);
      res.status(502).json({ ok: false, error: providerMsg });
    }
  });

  // Catálogos y consultas
  app.get('/api/leagues', async (_req: Request, res: Response) => {
    try {
      const data = await getLeaguesFromDb();
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando ligas.');
    }
  });

  app.get('/api/seasons', async (_req: Request, res: Response) => {
    try {
      const data = await getSeasonsFromDb();
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando temporadas.');
    }
  });

  app.get('/api/teams', async (req: Request, res: Response) => {
    try {
      const league = typeof req.query.league === 'string' ? req.query.league : undefined;
      const data = await getTeamsFromDb(league);
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando equipos y estadísticas.');
    }
  });

  app.get('/api/matches', async (req: Request, res: Response) => {
    try {
      const leagueId = typeof req.query.league === 'string' ? req.query.league : undefined;
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const data = await getMatchesFromDb({ leagueId, date, status });
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando partidos.');
    }
  });

  app.post('/api/matches/import-csv', async (req: Request, res: Response) => {
    const parsed = csvImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Datos de importación CSV inválidos.',
        details: parsed.error.issues.slice(0, 10),
      });
      return;
    }

    try {
      const result = await persistCsvBatchToDb(parsed.data);
      res.status(201).json({ ok: true, data: result });
    } catch (err) {
      handleApiError(res, err, 'Error guardando lote CSV en PostgreSQL.');
    }
  });

  app.put('/api/matches/:id/result', async (req: Request, res: Response) => {
    const matchId = req.params.id;
    const parsed = matchResultSchema.safeParse(req.body);
    if (!matchId || !parsed.success) {
      res.status(400).json({ ok: false, error: 'Marcador o identificador de partido inválido.' });
      return;
    }

    try {
      await updateMatchResultInDb(matchId, parsed.data);
      res.json({ ok: true });
    } catch (err) {
      handleApiError(res, err, 'Error actualizando resultado del partido.');
    }
  });

  app.get('/api/predictions/history', async (req: Request, res: Response) => {
    try {
      const league = typeof req.query.league === 'string' ? req.query.league : undefined;
      const data = await getPredictionHistoryFromDb(league);
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando historial de pronósticos.');
    }
  });

  app.post('/api/predictions', async (req: Request, res: Response) => {
    const parsed = createPredictionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Snapshot de pronóstico inválido.',
        details: parsed.error.issues.slice(0, 5),
      });
      return;
    }

    try {
      const created = await createPredictionSnapshotInDb(parsed.data);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleApiError(res, err, 'Error registrando snapshot de pronóstico.');
    }
  });

  app.post('/api/predictions/:id/settle', async (req: Request, res: Response) => {
    const predictionId = req.params.id;
    const parsed = settlePredictionSchema.safeParse(req.body);
    if (!predictionId || !parsed.success) {
      res.status(400).json({ ok: false, error: 'Datos de liquidación inválidos.' });
      return;
    }

    try {
      const outcome = await settlePredictionInDb(predictionId, parsed.data);
      res.json({ ok: true, data: outcome });
    } catch (err) {
      handleApiError(res, err, 'Error liquidando pronóstico.');
    }
  });

  app.get('/api/performance', async (req: Request, res: Response) => {
    try {
      const league = typeof req.query.league === 'string' ? req.query.league : undefined;
      const data = await getPerformanceMetricsFromDb(league);
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando métricas de rendimiento.');
    }
  });

  app.get('/api/model-config', async (_req: Request, res: Response) => {
    try {
      const data = await getActiveModelConfigFromDb();
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error leyendo configuración de modelo.');
    }
  });

  app.put('/api/model-config', async (req: Request, res: Response) => {
    const parsed = modelConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Configuración de pesos o umbrales inválida.' });
      return;
    }

    try {
      await updateActiveModelConfigInDb(parsed.data);
      res.json({ ok: true });
    } catch (err) {
      handleApiError(res, err, 'Error guardando configuración de modelo.');
    }
  });

  // Motor Predictivo Avanzado, Auditoría y Backtesting Walk-Forward (Fase 5)
  app.get('/api/audit', async (_req: Request, res: Response) => {
    try {
      const report = await runDatabaseAudit();
      res.json({ ok: true, data: report });
    } catch (err) {
      handleApiError(res, err, 'Error ejecutando auditoría de base de datos.');
    }
  });

  app.get('/api/backtest/history', async (_req: Request, res: Response) => {
    try {
      const history = await getBacktestHistoryFromDb();
      res.json({ ok: true, data: history });
    } catch (err) {
      handleApiError(res, err, 'Error consultando historial de backtesting.');
    }
  });

  app.post('/api/backtest/run', async (req: Request, res: Response) => {
    const parsed = backtestRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Parámetros de backtesting inválidos.',
        details: parsed.error.issues.slice(0, 5),
      });
      return;
    }

    try {
      const activeCfg = await getActiveModelConfigFromDb().catch(() => null);
      const result = await runWalkForwardBacktest({
        leagueFilter: parsed.data.leagueId,
        seasonId: parsed.data.seasonId,
        calibrationMethod: parsed.data.calibrationMethod,
        weights: activeCfg?.weights,
        persistRun: true,
        trainAndActivate: parsed.data.trainAndActivate,
      });
      res.json({ ok: true, data: result.summary });
    } catch (err) {
      handleApiError(res, err, 'Error ejecutando entrenamiento y backtest walk-forward.');
    }
  });

  app.get('/api/model/active', async (_req: Request, res: Response) => {
    try {
      const active = await getActiveTrainedModelFromDb();
      if (!active) {
        res.json({ ok: true, data: null });
        return;
      }
      res.json({
        ok: true,
        data: {
          id: active.id,
          name: active.name,
          weights: active.weights,
          calibrationMethod: active.calibrationMethod,
          trainedUntilUtc: active.trainedUntilUtc,
          rho: active.rho,
          mlTrainedSamples: active.mlModel.trainedSamples,
          evalMetrics: active.evalMetrics,
        },
      });
    } catch (err) {
      handleApiError(res, err, 'Error consultando versión de modelo activa.');
    }
  });

  app.get('/api/value-opportunities', async (req: Request, res: Response) => {
    try {
      const league = typeof req.query.league === 'string' ? req.query.league : undefined;
      const rows = await getDetectedValueOpportunities(league);
      res.json({ ok: true, data: rows });
    } catch (err) {
      handleApiError(res, err, 'Error consultando oportunidades de valor registradas.');
    }
  });

  app.post('/api/value-opportunities', async (req: Request, res: Response) => {
    const parsed = valueOppCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Datos de oportunidad de valor inválidos.',
        details: parsed.error.issues.slice(0, 5),
      });
      return;
    }

    try {
      const created = await saveDetectedValueOpportunity(parsed.data);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleApiError(res, err, 'Error registrando oportunidad de valor.');
    }
  });

  app.post('/api/value-opportunities/settle', async (_req: Request, res: Response) => {
    try {
      const settled = await settleDetectedValueOpportunities();
      res.json({ ok: true, data: settled });
    } catch (err) {
      handleApiError(res, err, 'Error liquidando oportunidades de valor pendientes.');
    }
  });

  // Fase 6: Reproducibilidad de backtesting, histórico inmutable de cuotas, seguimiento y monitorización
  app.get('/api/backtest/:runId', async (req: Request, res: Response) => {
    const runId = req.params.runId;
    if (!runId || runId.length > 80) {
      res.status(400).json({ ok: false, error: 'Identificador de backtest inválido.' });
      return;
    }
    try {
      const summary = await getBacktestByRunId(runId);
      if (!summary) {
        res.status(404).json({ ok: false, error: 'Ejecución de backtesting no encontrada.' });
        return;
      }
      res.json({ ok: true, data: summary });
    } catch (err) {
      handleApiError(res, err, 'Error consultando ejecución de backtesting.');
    }
  });

  app.post('/api/backtest/:runId/reproduce', async (req: Request, res: Response) => {
    const runId = req.params.runId;
    if (!runId || runId.length > 80) {
      res.status(400).json({ ok: false, error: 'Identificador de backtest inválido.' });
      return;
    }
    try {
      const reproduction = await reproduceBacktestByRunId(runId);
      res.json({ ok: true, data: reproduction });
    } catch (err) {
      handleApiError(res, err, 'Error reproduciendo backtesting por runId.');
    }
  });

  app.get('/api/monitoring/dashboard', async (req: Request, res: Response) => {
    try {
      const leagueId = typeof req.query.league === 'string' ? req.query.league : undefined;
      const data = await getMonitoringDashboardData({ leagueId });
      res.json({ ok: true, data });
    } catch (err) {
      handleApiError(res, err, 'Error consultando panel de monitorización y control.');
    }
  });

  app.put('/api/monitoring/config', async (req: Request, res: Response) => {
    const parsed = monitoringConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Configuración de monitorización inválida.',
        details: parsed.error.issues.slice(0, 5),
      });
      return;
    }
    try {
      const updated = await updateMonitoringConfig(parsed.data);
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleApiError(res, err, 'Error guardando configuración de monitorización.');
    }
  });

  app.get('/api/odds/history', async (req: Request, res: Response) => {
    try {
      const leagueId = typeof req.query.league === 'string' ? req.query.league : undefined;
      const limit =
        typeof req.query.limit === 'string' && Number.isFinite(Number(req.query.limit))
          ? Math.max(10, Math.min(400, Number(req.query.limit)))
          : 180;
      const timelines = await getOddsHistoryTimelines({ leagueId, limit });
      res.json({ ok: true, data: timelines });
    } catch (err) {
      handleApiError(res, err, 'Error consultando histórico inmutable de cuotas.');
    }
  });

  app.post('/api/odds/capture-now', async (req: Request, res: Response) => {
    const parsed = leagueScopeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Ámbito de liga inválido para captura de cuotas.' });
      return;
    }
    try {
      const result = await capturePreMatchOddsSnapshot({
        leagueId: parsed.data.leagueId,
        respectCreditGuard: true,
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      handleApiError(res, err, 'Error capturando snapshot pre-partido de cuotas.');
    }
  });

  app.post('/api/predictions/capture-upcoming', async (req: Request, res: Response) => {
    const parsed = leagueScopeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Ámbito de liga inválido.' });
      return;
    }
    try {
      const result = await captureUpcomingPredictionsBatchInDb({
        leagueId: parsed.data.leagueId,
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      handleApiError(res, err, 'Error registrando predicciones pre-partido en lote.');
    }
  });

  app.post('/api/predictions/auto-settle', async (_req: Request, res: Response) => {
    try {
      const result = await autoSettleAllPendingInDb();
      res.json({ ok: true, data: result });
    } catch (err) {
      handleApiError(res, err, 'Error ejecutando liquidación automática de resultados.');
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Football AI Predictor] Server listening on http://0.0.0.0:${PORT}`);
    startMonitoringScheduler();
  });
}

startServer().catch((err) => {
  console.error('[Server Fatal Startup Error]:', err);
  process.exit(1);
});
