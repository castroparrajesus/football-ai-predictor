import {
  CalibrationBin,
  ConfidenceTier,
  DbStatusSummary,
  EnsembleWeights,
  LeagueInfo,
  MatchRecord,
  PredictionHistoryItem,
  QualityFilterThresholds,
  TeamStatisticalProfile,
} from '../types/football';
import type { ParsedCsvRowForDb } from '../utils/csvImporter';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `Error HTTP ${res.status}`);
  }
  return body.data as T;
}

export const apiClient = {
  getDbHealth: () => requestJson<DbStatusSummary>('/api/health/db'),

  runMigrations: () =>
    requestJson<{ applied: string[]; alreadyApplied: string[] }>('/api/db/migrate', {
      method: 'POST',
    }),

  getLeagues: () => requestJson<LeagueInfo[]>('/api/leagues'),

  getTeams: (leagueId?: string) => {
    const qs = leagueId && leagueId !== 'all' ? `?league=${encodeURIComponent(leagueId)}` : '';
    return requestJson<TeamStatisticalProfile[]>(`/api/teams${qs}`);
  },

  getMatches: (leagueId?: string, date?: string) => {
    const params = new URLSearchParams();
    if (leagueId && leagueId !== 'all') params.set('league', leagueId);
    if (date && date !== 'all') params.set('date', date);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestJson<MatchRecord[]>(`/api/matches${qs}`);
  },

  importCsvToDb: (filename: string, rows: ParsedCsvRowForDb[]) =>
    requestJson<{ batchId: string; inserted: number; skippedDuplicate: number }>(
      '/api/matches/import-csv',
      {
        method: 'POST',
        body: JSON.stringify({ filename, rows }),
      }
    ),

  updateMatchResult: (matchId: string, homeGoals: number, awayGoals: number) =>
    requestJson<void>(`/api/matches/${encodeURIComponent(matchId)}/result`, {
      method: 'PUT',
      body: JSON.stringify({ homeGoals, awayGoals }),
    }),

  getPredictionHistory: (leagueId?: string) => {
    const qs = leagueId && leagueId !== 'all' ? `?league=${encodeURIComponent(leagueId)}` : '';
    return requestJson<PredictionHistoryItem[]>(`/api/predictions/history${qs}`);
  },

  createPredictionSnapshot: (payload: {
    matchId: string;
    confidenceTier: ConfidenceTier;
    dataCompletenessScore: number;
    expectedScore: string;
    modelOutputs: unknown;
    markets: unknown;
    scoreMatrix?: unknown;
    selectedMarket: string;
    selectedSelection: string;
    predictedProb: number;
    oddsAtPrediction: number;
  }) =>
    requestJson<{ id: string; createdAt: string }>('/api/predictions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  settlePrediction: (id: string, actualOutcome: 0 | 1, actualResult: string) =>
    requestJson<{ brierScore: number; logLoss: number; simulatedRoiUnit: number }>(
      `/api/predictions/${encodeURIComponent(id)}/settle`,
      {
        method: 'POST',
        body: JSON.stringify({ actualOutcome, actualResult }),
      }
    ),

  getPerformance: (leagueId?: string) => {
    const qs = leagueId && leagueId !== 'all' ? `?league=${encodeURIComponent(leagueId)}` : '';
    return requestJson<{
      calibrationBins: CalibrationBin[];
      trendSeries: { label: string; brier: number; logLoss: number; roiPct: number }[];
    }>(`/api/performance${qs}`);
  },

  getModelConfig: () =>
    requestJson<{
      id: string;
      weights: EnsembleWeights;
      thresholds: QualityFilterThresholds;
    } | null>('/api/model-config'),

  updateModelConfig: (weights: EnsembleWeights, thresholds: QualityFilterThresholds) =>
    requestJson<void>('/api/model-config', {
      method: 'PUT',
      body: JSON.stringify({ weights, thresholds }),
    }),
};
