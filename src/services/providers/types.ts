import { LeagueId } from '../../types/football.ts';

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

export interface NormalizedTeamRecord {
  canonicalId: string;
  leagueId: LeagueId;
  name: string;
  shortName: string;
  externalRefKey: ProviderId;
  externalId: string | number;
}

export interface NormalizedTeamSeasonStats {
  teamCanonicalId: string;
  teamName: string;
  leagueId: LeagueId;
  seasonId: string;
  position: number | null;
  points: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  xg: number | null;
  xga: number | null;
  homePlayed: number | null;
  homeWon: number | null;
  homeDrawn: number | null;
  homeLost: number | null;
  homeGf: number | null;
  homeGa: number | null;
  awayPlayed: number | null;
  awayWon: number | null;
  awayDrawn: number | null;
  awayLost: number | null;
  awayGf: number | null;
  awayGa: number | null;
  formString: string | null;
  sourceProvider: ProviderId;
}

export interface NormalizedMatchRecord {
  externalId: string;
  provider: ProviderId;
  leagueId: LeagueId;
  seasonId: string;
  matchday: number;
  kickoffUtc: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamExternalId?: string | number;
  awayTeamExternalId?: string | number;
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
  homeGoals: number | null;
  awayGoals: number | null;
  htHomeGoals: number | null;
  htAwayGoals: number | null;
}

export interface NormalizedOddsRecord {
  leagueId: LeagueId;
  kickoffUtc: string;
  homeTeamName: string;
  awayTeamName: string;
  bookmaker: string;
  market: '1X2' | 'OU25';
  selection: string;
  decimalOdds: number;
  capturedAtUtc: string;
}

export interface ProviderFetchResult {
  provider: ProviderId;
  leagueId: LeagueId;
  teams: NormalizedTeamRecord[];
  teamStats: NormalizedTeamSeasonStats[];
  matches: NormalizedMatchRecord[];
  odds: NormalizedOddsRecord[];
  requestsUsed: number;
  quotaRemaining: string | null;
  warnings: string[];
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly envVarName: string;
  readonly capabilities: ProviderCapabilities;
  isConfigured(): boolean;
  getQuotaRemaining(): string | null;
  fetchLeagueData(params: {
    leagueId: LeagueId;
    seasonYear?: number;
  }): Promise<ProviderFetchResult>;
}
