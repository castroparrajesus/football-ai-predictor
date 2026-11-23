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
  getLeaguesFromDb,
  getMatchesFromDb,
  getPerformanceMetricsFromDb,
  getPredictionHistoryFromDb,
  getSeasonsFromDb,
  getTeamsFromDb,
  persistCsvBatchToDb,
  settlePredictionInDb,
  updateActiveModelConfigInDb,
  updateMatchResultInDb,
} from './src/db/repository.ts';

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

function handleApiError(res: Response, err: unknown, fallbackMessage: string) {
  const status = (err as { statusCode?: number })?.statusCode ?? 500;
  const message =
    status === 503 || status === 404
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
  });
}

startServer().catch((err) => {
  console.error('[Server Fatal Startup Error]:', err);
  process.exit(1);
});
