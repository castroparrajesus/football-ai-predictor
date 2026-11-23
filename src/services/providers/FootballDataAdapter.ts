import { z } from 'zod';
import { LeagueId } from '../../types/football.ts';
import {
  buildCanonicalTeamId,
  deriveSeasonIdFromDate,
  seasonStartYearFromDate,
} from './DataNormalizer.ts';
import {
  enforceProviderRateLimit,
  getCachedProviderResponse,
  getProviderQuota,
  setCachedProviderResponse,
  updateProviderQuota,
} from './rateLimiter.ts';
import {
  NormalizedMatchRecord,
  NormalizedTeamRecord,
  NormalizedTeamSeasonStats,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderFetchResult,
} from './types.ts';

const LEAGUE_CODE_MAP: Record<LeagueId, string> = {
  premier_league: 'PL',
  laliga: 'PD',
  serie_a: 'SA',
  bundesliga: 'BL1',
  ligue_1: 'FL1',
};

const standingsResponseSchema = z.object({
  season: z
    .object({
      startDate: z.string().optional(),
    })
    .optional(),
  standings: z
    .array(
      z.object({
        type: z.string(),
        table: z.array(
          z.object({
            position: z.number(),
            team: z.object({
              id: z.number(),
              name: z.string(),
              shortName: z.string().nullable().optional(),
              tla: z.string().nullable().optional(),
            }),
            playedGames: z.number(),
            form: z.string().nullable().optional(),
            won: z.number(),
            draw: z.number(),
            lost: z.number(),
            points: z.number(),
            goalsFor: z.number(),
            goalsAgainst: z.number(),
          })
        ),
      })
    )
    .default([]),
});

const matchesResponseSchema = z.object({
  matches: z
    .array(
      z.object({
        id: z.number(),
        utcDate: z.string(),
        status: z.string(),
        matchday: z.number().nullable().optional(),
        homeTeam: z.object({
          id: z.number().nullable(),
          name: z.string().nullable(),
          shortName: z.string().nullable().optional(),
          tla: z.string().nullable().optional(),
        }),
        awayTeam: z.object({
          id: z.number().nullable(),
          name: z.string().nullable(),
          shortName: z.string().nullable().optional(),
          tla: z.string().nullable().optional(),
        }),
        score: z.object({
          fullTime: z.object({
            home: z.number().nullable(),
            away: z.number().nullable(),
          }),
          halfTime: z
            .object({
              home: z.number().nullable(),
              away: z.number().nullable(),
            })
            .optional(),
        }),
      })
    )
    .default([]),
});

function mapFdStatus(status: string): NormalizedMatchRecord['status'] {
  switch (status) {
    case 'FINISHED':
      return 'finished';
    case 'IN_PLAY':
    case 'PAUSED':
      return 'live';
    case 'POSTPONED':
    case 'SUSPENDED':
      return 'postponed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'scheduled';
  }
}

export class FootballDataAdapter implements ProviderAdapter {
  readonly id = 'football_data' as const;
  readonly envVarName = 'FOOTBALL_DATA_API_KEY';
  readonly capabilities: ProviderCapabilities = {
    id: 'football_data',
    name: 'Football-Data.org (v4)',
    baseUrl: 'https://api.football-data.org/v4',
    pricingSummary: 'Gratuito €0/mes (12 competiciones principales, incluye las 5 grandes ligas).',
    rateLimitSummary: '10 peticiones/minuto (tier gratuito).',
    termsNote: 'Requiere cabecera X-Auth-Token. Sin xG ni cuotas de apuestas en tier gratuito.',
    supportsSchedules: true,
    supportsHistoricalResults: true,
    supportsStandings: true,
    supportsTeamStats: true,
    supportsXg: false,
    supportsOdds: false,
  };

  private getApiKey(): string {
    return (process.env.FOOTBALL_DATA_API_KEY ?? '').trim();
  }

  isConfigured(): boolean {
    return this.getApiKey().length > 0;
  }

  getQuotaRemaining(): string | null {
    return getProviderQuota(this.id);
  }

  private async fetchJson<T>(pathSuffix: string, schema: z.ZodType<T>): Promise<{ data: T; fromCache: boolean }> {
    const cacheKey = `fd:${pathSuffix}`;
    const cached = getCachedProviderResponse<T>(cacheKey);
    if (cached) {
      return { data: cached, fromCache: true };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('FOOTBALL_DATA_API_KEY no configurada en el servidor.');
    }

    await enforceProviderRateLimit(this.id, 6200);

    const url = `${this.capabilities.baseUrl}${pathSuffix}`;
    const res = await fetch(url, {
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
    });

    const minAvail = res.headers.get('x-requests-available-minute');
    if (minAvail) {
      updateProviderQuota(this.id, `${minAvail} req/min restantes`);
    }

    if (res.status === 429) {
      throw new Error('Football-Data.org devolvió 429 (límite de 10 req/min alcanzado). Espera 60s.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Token de Football-Data.org rechazado o sin permisos para esta competición.');
    }
    if (!res.ok) {
      throw new Error(`Football-Data.org respondió HTTP ${res.status}.`);
    }

    const raw = await res.json();
    const parsed = schema.parse(raw);
    setCachedProviderResponse(cacheKey, parsed, 180_000);
    return { data: parsed, fromCache: false };
  }

  async fetchLeagueData(params: {
    leagueId: LeagueId;
    seasonYear?: number;
  }): Promise<ProviderFetchResult> {
    const code = LEAGUE_CODE_MAP[params.leagueId];
    const seasonYear = params.seasonYear ?? seasonStartYearFromDate();
    const seasonId = `${seasonYear}-${seasonYear + 1}`;
    const warnings: string[] = [
      'Football-Data.org (v4) no proporciona xG/xGA ni cuotas de casas de apuestas en su API gratuita.',
    ];

    let requestsUsed = 0;

    const standingsCall = await this.fetchJson(
      `/competitions/${code}/standings?season=${seasonYear}`,
      standingsResponseSchema
    );
    if (!standingsCall.fromCache) requestsUsed += 1;

    const matchesCall = await this.fetchJson(
      `/competitions/${code}/matches?season=${seasonYear}`,
      matchesResponseSchema
    );
    if (!matchesCall.fromCache) requestsUsed += 1;

    const teamsMap = new Map<string, NormalizedTeamRecord>();
    const statsMap = new Map<string, NormalizedTeamSeasonStats>();

    const totalTable = standingsCall.data.standings.find((s) => s.type === 'TOTAL')?.table ?? [];
    const homeTable = standingsCall.data.standings.find((s) => s.type === 'HOME')?.table ?? [];
    const awayTable = standingsCall.data.standings.find((s) => s.type === 'AWAY')?.table ?? [];

    const homeByExternalId = new Map(homeTable.map((r) => [r.team.id, r]));
    const awayByExternalId = new Map(awayTable.map((r) => [r.team.id, r]));

    for (const row of totalTable) {
      const canonicalId = buildCanonicalTeamId(params.leagueId, row.team.name);
      const shortName = (row.team.tla || row.team.shortName || row.team.name.slice(0, 3))
        .toUpperCase()
        .slice(0, 6);

      teamsMap.set(canonicalId, {
        canonicalId,
        leagueId: params.leagueId,
        name: row.team.name,
        shortName,
        externalRefKey: this.id,
        externalId: row.team.id,
      });

      const h = homeByExternalId.get(row.team.id);
      const a = awayByExternalId.get(row.team.id);

      statsMap.set(canonicalId, {
        teamCanonicalId: canonicalId,
        teamName: row.team.name,
        leagueId: params.leagueId,
        seasonId,
        position: row.position,
        points: row.points,
        played: row.playedGames,
        won: row.won,
        drawn: row.draw,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        xg: null,
        xga: null,
        homePlayed: h?.playedGames ?? null,
        homeWon: h?.won ?? null,
        homeDrawn: h?.draw ?? null,
        homeLost: h?.lost ?? null,
        homeGf: h?.goalsFor ?? null,
        homeGa: h?.goalsAgainst ?? null,
        awayPlayed: a?.playedGames ?? null,
        awayWon: a?.won ?? null,
        awayDrawn: a?.draw ?? null,
        awayLost: a?.lost ?? null,
        awayGf: a?.goalsFor ?? null,
        awayGa: a?.goalsAgainst ?? null,
        formString: row.form ?? null,
        sourceProvider: this.id,
      });
    }

    const matches: NormalizedMatchRecord[] = [];
    for (const m of matchesCall.data.matches) {
      if (!m.homeTeam.name || !m.awayTeam.name) continue;
      const homeCanonical = buildCanonicalTeamId(params.leagueId, m.homeTeam.name);
      const awayCanonical = buildCanonicalTeamId(params.leagueId, m.awayTeam.name);

      if (!teamsMap.has(homeCanonical) && m.homeTeam.id) {
        teamsMap.set(homeCanonical, {
          canonicalId: homeCanonical,
          leagueId: params.leagueId,
          name: m.homeTeam.name,
          shortName: (m.homeTeam.tla || m.homeTeam.name.slice(0, 3)).toUpperCase(),
          externalRefKey: this.id,
          externalId: m.homeTeam.id,
        });
      }
      if (!teamsMap.has(awayCanonical) && m.awayTeam.id) {
        teamsMap.set(awayCanonical, {
          canonicalId: awayCanonical,
          leagueId: params.leagueId,
          name: m.awayTeam.name,
          shortName: (m.awayTeam.tla || m.awayTeam.name.slice(0, 3)).toUpperCase(),
          externalRefKey: this.id,
          externalId: m.awayTeam.id,
        });
      }

      matches.push({
        externalId: `fd_${m.id}`,
        provider: this.id,
        leagueId: params.leagueId,
        seasonId: deriveSeasonIdFromDate(m.utcDate),
        matchday: m.matchday ?? 0,
        kickoffUtc: m.utcDate,
        homeTeamName: m.homeTeam.name,
        awayTeamName: m.awayTeam.name,
        homeTeamExternalId: m.homeTeam.id ?? undefined,
        awayTeamExternalId: m.awayTeam.id ?? undefined,
        status: mapFdStatus(m.status),
        homeGoals: m.score.fullTime.home,
        awayGoals: m.score.fullTime.away,
        htHomeGoals: m.score.halfTime?.home ?? null,
        htAwayGoals: m.score.halfTime?.away ?? null,
      });
    }

    return {
      provider: this.id,
      leagueId: params.leagueId,
      teams: Array.from(teamsMap.values()),
      teamStats: Array.from(statsMap.values()),
      matches,
      odds: [],
      requestsUsed,
      quotaRemaining: this.getQuotaRemaining(),
      warnings,
    };
  }
}
