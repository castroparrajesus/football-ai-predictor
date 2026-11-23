import {
  ActiveTrainedModelInfo,
  BacktestReproductionResult,
  BacktestRunSummary,
  CalibrationBin,
  ConfidenceTier,
  DataAuditReport,
  DbStatusSummary,
  DetectedValueOpportunityRecord,
  EnsembleWeights,
  LeagueFilter,
  LeagueInfo,
  MatchRecord,
  MonitoringConfigState,
  MonitoringDashboardData,
  OddsHistoryTimeline,
  PredictionHistoryItem,
  ProviderId,
  ProviderStatusInfo,
  QualityFilterThresholds,
  SyncExecutionSummary,
  SyncLogEntry,
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

  getProvidersStatus: () =>
    requestJson<{
      providers: ProviderStatusInfo[];
      recentLogs: SyncLogEntry[];
    }>('/api/providers/status'),

  runProviderSync: (payload: {
    provider: ProviderId;
    leagueId: LeagueFilter;
    seasonYear?: number;
    includeOdds?: boolean;
  }) =>
    requestJson<SyncExecutionSummary>('/api/sync/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAuditReport: () => requestJson<DataAuditReport>('/api/audit'),

  getBacktestHistory: () => requestJson<BacktestRunSummary[]>('/api/backtest/history'),

  runBacktest: (payload: {
    leagueId: LeagueFilter;
    seasonId?: string;
    calibrationMethod: 'platt' | 'isotonic' | 'none';
    trainAndActivate: boolean;
  }) =>
    requestJson<BacktestRunSummary>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getActiveTrainedModel: () => requestJson<ActiveTrainedModelInfo | null>('/api/model/active'),

  getValueOpportunities: (leagueId?: string) => {
    const qs = leagueId && leagueId !== 'all' ? `?league=${encodeURIComponent(leagueId)}` : '';
    return requestJson<DetectedValueOpportunityRecord[]>(`/api/value-opportunities${qs}`);
  },

  saveValueOpportunity: (payload: {
    matchId: string;
    modelVersionId?: string;
    market: string;
    selection: string;
    bookmaker: string;
    modelProb: number;
    decimalOdds: number;
    impliedProbRaw: number;
    impliedProbDevig: number | null;
    fairOdds: number;
    edgePp: number;
    expectedValue: number;
    confidenceTier: ConfidenceTier;
    oddsCapturedAt?: string | null;
  }) =>
    requestJson<{ id: string }>('/api/value-opportunities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  settleValueOpportunities: () =>
    requestJson<{ settledCount: number }>('/api/value-opportunities/settle', {
      method: 'POST',
    }),

  reproduceBacktest: (runId: string) =>
    requestJson<BacktestReproductionResult>(
      `/api/backtest/${encodeURIComponent(runId)}/reproduce`,
      { method: 'POST' }
    ),

  getMonitoringDashboard: (leagueId?: string) => {
    const qs = leagueId && leagueId !== 'all' ? `?league=${encodeURIComponent(leagueId)}` : '';
    return requestJson<MonitoringDashboardData>(`/api/monitoring/dashboard${qs}`);
  },

  updateMonitoringConfig: (payload: Partial<MonitoringConfigState>) =>
    requestJson<MonitoringConfigState>('/api/monitoring/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getOddsHistory: (leagueId?: string, limit = 180) => {
    const params = new URLSearchParams();
    if (leagueId && leagueId !== 'all') params.set('league', leagueId);
    params.set('limit', String(limit));
    return requestJson<OddsHistoryTimeline[]>(`/api/odds/history?${params.toString()}`);
  },

  captureOddsNow: (leagueId: LeagueFilter) =>
    requestJson<{
      executed: boolean;
      skippedReason?: string;
      oddsInserted: number;
      requestsUsed: number;
      quotaRemaining: string | null;
    }>('/api/odds/capture-now', {
      method: 'POST',
      body: JSON.stringify({ leagueId }),
    }),

  captureUpcomingPredictions: (leagueId: LeagueFilter) =>
    requestJson<{
      registeredCount: number;
      skippedExisting: number;
      skippedDiscarded: number;
      withMarketOddsCount: number;
      withoutMarketOddsCount: number;
      modelVersionId: string;
    }>('/api/predictions/capture-upcoming', {
      method: 'POST',
      body: JSON.stringify({ leagueId }),
    }),

  autoSettlePending: () =>
    requestJson<{
      settledPredictions: number;
      settledValueOpportunities: number;
      skippedUnsupported: number;
      ranAtUtc: string;
    }>('/api/predictions/auto-settle', {
      method: 'POST',
    }),
};
