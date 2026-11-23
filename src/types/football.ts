export type LeagueId =
  | 'premier_league'
  | 'laliga'
  | 'serie_a'
  | 'bundesliga'
  | 'ligue_1';

export type LeagueFilter = LeagueId | 'all';

export type DataSourceMode = 'database' | 'none' | 'sandbox' | 'csv';

export interface DbStatusSummary {
  configured: boolean;
  supabaseConfigured: boolean;
  connected: boolean;
  schemaReady: boolean;
  error: string | null;
  counts: {
    leagues: number;
    seasons: number;
    teams: number;
    matches: number;
    predictions: number;
  };
  lastImportAt: string | null;
  lastImportFilename: string | null;
  lastPredictionAt: string | null;
}

export type ConfidenceTier = 'A' | 'B' | 'C' | 'DESCARTADO';

export type NavSectionId =
  | 'dashboard'
  | 'matches_today'
  | 'all_leagues'
  | 'ai_analysis'
  | 'predictions'
  | 'value_finder'
  | 'model_comparator'
  | 'history'
  | 'performance'
  | 'monitoring'
  | 'settings';

export interface LeagueInfo {
  id: LeagueId;
  name: string;
  country: string;
  season: string;
  teamsCount: number;
}

export interface RecentWindowStats {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface SplitPerformance {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number | null;
  xgAgainst: number | null;
}

export interface TeamAbsence {
  player: string;
  reason: 'lesión' | 'sanción' | 'duda';
  impact: 'alta' | 'media' | 'baja';
}

export interface TeamStatisticalProfile {
  id: string;
  leagueId: LeagueId;
  name: string;
  shortName: string;
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  xg: number | null;
  xga: number | null;
  totalShots: number | null;
  shotsOnTarget: number | null;
  offensiveEfficiency: number | null; // % conversión o goles/tiro a puerta
  defensiveEfficiency: number | null; // % paradas / xGA vs goles encajados
  cleanSheets: number;
  bttsRate: number; // 0..1
  over15Rate: number; // 0..1
  over25Rate: number; // 0..1
  over35Rate: number; // 0..1
  over45Rate: number; // 0..1
  cornersForAvg: number | null;
  cornersAgainstAvg: number | null;
  yellowCardsAvg: number | null;
  redCardsTotal: number | null;
  homePerformance: SplitPerformance;
  awayPerformance: SplitPerformance;
  last5: RecentWindowStats;
  last10: RecentWindowStats | null;
  last15: RecentWindowStats | null;
  vsSimilarLevelPPG: number | null;
  restDays: number | null;
  scheduleCongestion: 'baja' | 'media' | 'alta' | null;
  absences: TeamAbsence[] | null;
  probableLineup: string[] | null;
  recentCoachChange: boolean;
  recentTrend: 'ascendente' | 'estable' | 'descendente';
  eloRating: number;
  missingFields: string[];
}

export interface MarketOdds1X2 {
  home: number;
  draw: number;
  away: number;
  bookmaker: string;
}

export interface ExtraMarketOdds {
  over25?: number;
  under25?: number;
  bttsYes?: number;
  bttsNo?: number;
}

export interface ThreeWayProbabilities {
  home: number; // 0..1
  draw: number; // 0..1
  away: number; // 0..1
}

export interface PredictionFactor {
  label: string;
  value: string;
  impact: 'home' | 'away' | 'neutral';
}

export interface ModelBreakdown {
  poisson: ThreeWayProbabilities;
  dixonColes?: ThreeWayProbabilities;
  elo: ThreeWayProbabilities;
  machineLearning: ThreeWayProbabilities;
  recentForm: ThreeWayProbabilities;
  homeAway: ThreeWayProbabilities;
  marketDeVigged: ThreeWayProbabilities | null;
  ensemble: ThreeWayProbabilities;
  modelSpread: number; // máxima discrepancia entre modelos en puntos porcentuales
}

export interface ScoreMatrixCell {
  homeGoals: number;
  awayGoals: number;
  probability: number; // 0..1
}

export interface MatchMarketsAnalysis {
  result: {
    homeWin: number;
    draw: number;
    awayWin: number;
    dc1X: number;
    dcX2: number;
    dc12: number;
  };
  goals: {
    over05: number;
    over15: number;
    over25: number;
    over35: number;
    over45: number;
    under15: number;
    under25: number;
    under35: number;
    under45: number;
    bttsYes: number;
    bttsNo: number;
  };
  teamGoals: {
    homeOver05: number;
    homeOver15: number;
    homeOver25: number;
    awayOver05: number;
    awayOver15: number;
    awayOver25: number;
  };
  corners: {
    available: boolean;
    expectedTotal: number | null;
    expectedHome: number | null;
    expectedAway: number | null;
    over95Prob: number | null;
    under95Prob: number | null;
    note?: string;
  };
  cards: {
    available: boolean;
    expectedTotal: number | null;
    expectedHome: number | null;
    expectedAway: number | null;
    disciplinaryRisk: 'bajo' | 'moderado' | 'alto' | null;
    note?: string;
  };
}

export interface ValueOpportunity {
  id: string;
  matchId: string;
  matchLabel: string;
  leagueId: LeagueId;
  market: string;
  selection: string;
  modelProb: number; // 0..1
  decimalOdds: number;
  impliedProbRaw: number; // 1 / odds
  impliedProbNoMargin: number | null;
  fairOdds: number; // 1 / modelProb
  edge: number; // modelProb - impliedProbNoMargin (o raw si no hay contraparte)
  expectedValue: number; // (modelProb * decimalOdds) - 1
  confidenceTier: ConfidenceTier;
  hasStatisticalValue: boolean;
  rejectionReason?: string;
  bookmaker?: string;
  oddsCapturedAt?: string | null;
  isExpiredOdds?: boolean;
  kickoffUtc?: string;
}

export interface MatchRecord {
  id: string;
  leagueId: LeagueId;
  date: string; // YYYY-MM-DD
  kickoffTime: string; // HH:mm
  kickoffUtc?: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  isSynthetic: boolean;
  dataCompleteness: number; // 0..100
  missingDataNotes: string[];
  h2hSummary: {
    matches: number;
    homeWins: number;
    draws: number;
    awayWins: number;
    avgGoals: number;
  } | null;
  expectedLambdaHome: number;
  expectedLambdaAway: number;
  dixonColesRho?: number;
  homeElo?: number;
  awayElo?: number;
  confidenceInterval90?: {
    home: [number, number];
    draw: [number, number];
    away: [number, number];
  };
  keyFactors?: PredictionFactor[];
  smallSampleWarning?: string | null;
  matchStatus?: string;
  actualScore?: string;
  oddsCapturedAt?: string | null;
  odds1X2: MarketOdds1X2 | null;
  extraOdds: ExtraMarketOdds | null;
  models: ModelBreakdown;
  confidenceTier: ConfidenceTier;
  confidenceReasons: string[];
}

export interface PredictionHistoryItem {
  id: string;
  recordedAtUtc: string;
  kickoffUtc: string;
  leagueId: LeagueId;
  matchLabel: string;
  market: string;
  selection: string;
  predictedProb: number;
  oddsAtPrediction: number;
  expectedScore: string;
  modelVersion: string;
  confidenceTier: ConfidenceTier;
  status: 'pendiente' | 'acertada' | 'fallada';
  actualResult: string | null;
  brierScore: number | null;
  logLoss: number | null;
  simulatedRoiUnit: number | null;
  isSynthetic: boolean;
}

export interface CalibrationBin {
  binLabel: string;
  meanPredicted: number;
  observedFrequency: number;
  sampleCount: number;
}

export interface EnsembleWeights {
  poisson: number;
  elo: number;
  machineLearning: number;
  recentForm: number;
  homeAway: number;
}

export interface QualityFilterThresholds {
  minCompletenessPct: number;
  maxModelSpreadPct: number;
  minExpectedValuePct: number;
  strictModeNoForce: boolean;
}

export type ProviderId = 'football_data' | 'api_football' | 'the_odds_api';

export interface ProviderCapabilities {
  id: ProviderId;
  name: string;
  baseUrl: string;
  pricingSummary: string;
  rateLimitSummary: string;
  termsNote: string;
  supportsSchedules: boolean;
  supportsHistoricalResults: boolean;
  supportsStandings: boolean;
  supportsTeamStats: boolean;
  supportsXg: boolean;
  supportsOdds: boolean;
}

export interface ProviderStatusInfo {
  id: ProviderId;
  name: string;
  configured: boolean;
  envVarName: string;
  capabilities: ProviderCapabilities;
  quotaRemaining: string | null;
  lastSyncedAt: string | null;
}

export interface SyncLogEntry {
  id: number;
  providerId: string;
  leagueId: string | null;
  status: 'success' | 'partial' | 'error';
  matchesUpserted: number;
  teamsUpserted: number;
  oddsInserted: number;
  requestsUsed: number;
  quotaRemaining: string | null;
  warnings: string[];
  errorMessage: string | null;
  syncedAt: string;
}

export interface SyncExecutionSummary {
  provider: ProviderId;
  leaguesSynced: LeagueId[];
  teamsUpserted: number;
  matchesUpserted: number;
  oddsInserted: number;
  requestsUsed: number;
  quotaRemaining: string | null;
  warnings: string[];
}

export interface DataAuditReport {
  generatedAtUtc: string;
  totals: {
    matches: number;
    teams: number;
    finishedMatches: number;
    finishedWithResults: number;
    scheduledMatches: number;
    duplicateFixtureGroups: number;
    potentialDuplicateTeamGroups: number;
    dateRangeMinUtc: string | null;
    dateRangeMaxUtc: string | null;
  };
  oddsAudit: {
    totalOddsRows: number;
    matchesWithOdds: number;
    upcomingMatchesWithOdds: number;
    finishedMatchesWithOdds: number;
    expiredOddsRows: number;
    markets: string[];
    bookmakers: string[];
  };
  coverage: {
    teamSeasonStatsRows: number;
    teamMatchStatsRows: number;
    xgRows: number;
    lineupRows: number;
    injuryRows: number;
  };
  byLeague: {
    leagueId: string;
    total: number;
    finished: number;
    scheduled: number;
    withOdds: number;
  }[];
  bySeason: {
    seasonId: string;
    total: number;
    finished: number;
    scheduled: number;
  }[];
  byStatus: {
    status: string;
    count: number;
  }[];
  missingDataGaps: string[];
}

export interface BacktestModelMetric {
  modelKey: string;
  modelLabel: string;
  sampleCount: number;
  accuracyPct: number;
  accuracyCi95?: [number, number];
  brierScore: number;
  brierCi95?: [number, number];
  logLoss: number;
  logLossCi95?: [number, number];
  ece: number;
}

export interface BacktestLeagueMetric {
  leagueId: string;
  matchesEvaluated: number;
  accuracyPct: number;
  accuracyCi95?: [number, number];
  brierScore: number;
  brierCi95?: [number, number];
  logLoss: number;
  logLossCi95?: [number, number];
}

export interface BacktestFoldSummary {
  foldIndex: number;
  startDate: string;
  endDate: string;
  trainMatchCount?: number;
  trainMlSamplesBeforeFold?: number;
  trainEndDate?: string;
  matchesEvaluated: number;
  accuracyPct: number;
  accuracyCi95?: [number, number];
  brierScore: number;
  logLoss: number;
  rhoFitted: number;
}

export interface BacktestDatasetAudit {
  totalChronologicalFinished: number;
  warmupMatches: number;
  warmupEligibleMlSamples: number;
  warmupSkippedColdStart: number;
  evaluatedMatches: number;
  evalEligibleMlSamples: number;
  evalSkippedColdStart: number;
  finalLiveRefitSamples: number;
  overlapCount: number;
  chronologicalOrderVerified: boolean;
  leakageAuditPassed: boolean;
  explanation: string;
}

export interface BacktestRunSummary {
  runId: string;
  createdAtUtc: string;
  cutoffUtc?: string;
  leagueFilter: LeagueFilter;
  seasonFilter: string;
  calibrationMethod: 'platt' | 'isotonic' | 'none';
  weightsUsed?: EnsembleWeights;
  warmupMatches: number;
  evaluatedMatches: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  fittedRho: number;
  mlTrainedSamples: number;
  ece: number;
  datasetAudit?: BacktestDatasetAudit;
  oddsCoverage: {
    matchesWithHistoricalOdds: number;
    valueBetsSimulated: number;
    roiPct: number | null;
    yieldUnits: number | null;
    note?: string;
  };
  modelMetrics: BacktestModelMetric[];
  byLeague: BacktestLeagueMetric[];
  bySeason: {
    seasonId: string;
    matchesEvaluated: number;
    accuracyPct: number;
    accuracyCi95?: [number, number];
    brierScore: number;
    logLoss: number;
  }[];
  calibrationBins: CalibrationBin[];
  folds: BacktestFoldSummary[];
}

export interface BacktestReproductionResult {
  originalRunId: string;
  originalSummary: BacktestRunSummary;
  reproducedSummary: BacktestRunSummary;
  reproducibilityCheck: {
    identicalMatchCount: boolean;
    brierDiff: number;
    logLossDiff: number;
    accuracyDiff: number;
    eceDiff: number;
    exactMatch: boolean;
  };
}

export interface ActiveTrainedModelInfo {
  id: string;
  name: string;
  weights: EnsembleWeights;
  calibrationMethod: string;
  trainedUntilUtc: string | null;
  rho: number;
  mlTrainedSamples: number;
  evalMetrics: {
    brierScore?: number;
    logLoss?: number;
    accuracyPct?: number;
    ece?: number;
    evaluatedMatches?: number;
  } | null;
}

export interface DetectedValueOpportunityRecord {
  id: string;
  matchId: string;
  matchLabel: string;
  leagueId: LeagueId;
  kickoffUtc: string;
  modelVersionId: string;
  market: string;
  selection: string;
  bookmaker: string;
  modelProb: number;
  decimalOdds: number;
  openingOdds?: number | null;
  closingOdds?: number | null;
  clvPct?: number | null;
  impliedProbRaw: number;
  impliedProbDevig: number | null;
  fairOdds: number;
  edgePp: number;
  expectedValue: number;
  confidenceTier: ConfidenceTier;
  oddsCapturedAt: string;
  status: 'pendiente' | 'ganada' | 'perdida' | 'anulada';
  actualResult: string | null;
  realizedRoiUnit: number | null;
  createdAt: string;
  settledAt: string | null;
}

export interface ProviderEnrichmentEvaluation {
  id: string;
  name: string;
  status: 'configurado' | 'evaluado_no_contratado' | 'descartado_tos';
  pricingSummary: string;
  big5Coverage: string;
  historicalAvailability: string;
  rateLimits: string;
  termsSummary: string;
  supports: {
    xg: boolean;
    shots: boolean;
    corners: boolean;
    cards: boolean;
    lineups: boolean;
    injuries: boolean;
    homeAwaySplits: boolean;
    closingOdds: boolean;
  };
  recommendedRole: string;
}

export interface OddsSnapshotPoint {
  id: number;
  decimalOdds: number;
  capturedAt: string;
  minutesToKickoff: number | null;
  isClosing: boolean;
}

export interface OddsHistoryTimeline {
  matchId: string;
  matchLabel: string;
  leagueId: LeagueId;
  kickoffUtc: string;
  matchStatus: string;
  bookmaker: string;
  market: string;
  selection: string;
  openingOdds: number;
  openingCapturedAt: string;
  latestOdds: number;
  latestCapturedAt: string;
  closingOdds: number | null;
  closingCapturedAt: string | null;
  deltaOdds: number;
  deltaPct: number;
  snapshotCount: number;
  linkedOpportunitiesCount: number;
  snapshots: OddsSnapshotPoint[];
}

export interface SystemAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'degradacion' | 'cuotas_caducadas' | 'mercado_bloqueado' | 'validacion_modelo' | 'cobertura_datos';
  title: string;
  detail: string;
  actionHint?: string;
}

export interface PerformanceBreakdownRow {
  groupKey: string;
  groupLabel: string;
  totalPredictions: number;
  settledCount: number;
  pendingCount: number;
  wins: number;
  hitRatePct: number | null;
  hitRateCi95: [number, number] | null;
  brierScore: number | null;
  logLoss: number | null;
  ece: number | null;
  realizedRoiPct: number | null;
  realizedYieldUnits: number | null;
  clvAvgPct: number | null;
  clvSampleCount: number;
}

export interface MonitoringConfigState {
  autoOddsCaptureEnabled: boolean;
  captureIntervalMinutes: number;
  closingWindowMinutes: number;
  minRemainingCreditsGuard: number;
  autoSettleEnabled: boolean;
  lastAutoOddsRunAt: string | null;
  lastAutoSettleRunAt: string | null;
}

export interface MonitoringDashboardData {
  generatedAtUtc: string;
  config: MonitoringConfigState;
  alerts: SystemAlert[];
  blockedMarkets: {
    market: string;
    reason: string;
    currentRows: number;
    requiredMinimum: string;
  }[];
  modelValidationStatus: {
    isValidated: boolean;
    statusLabel: string;
    reasons: string[];
    byLeague: {
      leagueId: LeagueId;
      evaluatedMatches: number;
      logLoss: number | null;
      status: 'validado' | 'muestra_pequena' | 'alerta_degradacion' | 'sin_evaluar';
    }[];
  };
  liveRealMetrics: {
    totalPredictionsLogged: number;
    pendingCount: number;
    settledCount: number;
    wins: number;
    losses: number;
    hitRatePct: number | null;
    hitRateCi95: [number, number] | null;
    brierScore: number | null;
    logLoss: number | null;
    ece: number | null;
    realizedRoiPct: number | null;
    realizedYieldUnits: number | null;
    clvAvgPct: number | null;
    clvSampleCount: number;
    profitabilityDisclaimer: string;
    byLeague: PerformanceBreakdownRow[];
    byMarket: PerformanceBreakdownRow[];
    bySeason: PerformanceBreakdownRow[];
    byModel: PerformanceBreakdownRow[];
  };
  providerEvaluations: ProviderEnrichmentEvaluation[];
}


