export type LeagueId =
  | 'premier_league'
  | 'laliga'
  | 'serie_a'
  | 'bundesliga'
  | 'ligue_1';

export type LeagueFilter = LeagueId | 'all';

export type DataSourceMode = 'none' | 'sandbox' | 'csv';

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

export interface ModelBreakdown {
  poisson: ThreeWayProbabilities;
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
}

export interface MatchRecord {
  id: string;
  leagueId: LeagueId;
  date: string; // YYYY-MM-DD
  kickoffTime: string; // HH:mm
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
