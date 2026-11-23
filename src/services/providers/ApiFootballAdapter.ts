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

const API_FOOTBALL_LEAGUE_IDS: Record<LeagueId, number> = {
  premier_league: 39,
  laliga: 140,
  serie_a: 135,
  bundesliga: 78,
  ligue_1: 61,
};

const apiFootballEnvelopeSchema = z.object({
  errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  response: z.array(z.unknown()).default([]),
});

const fixtureItemSchema = z.object({
  fixture: z.object({
    id: z.number(),
    date: z.string(),
    status: z.object({
      short: z.string(),
    }),
  }),
  league: z.object({
    season: z.number().optional(),
    round: z.string().nullable().optional(),
  }),
  teams: z.object({
    home: z.object({
      id: z.number(),
      name: z.string(),
    }),
    away: z.object({
      id: z.number(),
      name: z.string(),
    }),
  }),
  goals: z.object({
    home: z.number().nullable(),
    away: z.number().nullable(),
  }),
  score: z
    .object({
      halftime: z
        .object({
          home: z.number().nullable(),
          away: z.number().nullable(),
        })
        .optional(),
    })
    .optional(),
});

const standingsGroupSchema = z.object({
  league: z.object({
    standings: z.array(
      z.array(
        z.object({
          rank: z.number(),
          team: z.object({
            id: z.number(),
            name: z.string(),
          }),
          points: z.number(),
          form: z.string().nullable().optional(),
          all: z.object({
            played: z.number(),
            win: z.number(),
            draw: z.number(),
            lose: z.number(),
            goals: z.object({
              for: z.number(),
              against: z.number(),
            }),
          }),
          home: z
            .object({
              played: z.number(),
              win: z.number(),
              draw: z.number(),
              lose: z.number(),
              goals: z.object({
                for: z.number(),
                against: z.number(),
              }),
            })
            .optional(),
          away: z
            .object({
              played: z.number(),
              win: z.number(),
              draw: z.number(),
              lose: z.number(),
              goals: z.object({
                for: z.number(),
                against: z.number(),
              }),
            })
            .optional(),
        })
      )
    ),
  }),
});

function mapAfStatus(short: string): NormalizedMatchRecord['status'] {
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['1H', 'HT', '2H', 'ET', 'P', 'LIVE'].includes(short)) return 'live';
  if (['PST', 'SUSP', 'INT'].includes(short)) return 'postponed';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  return 'scheduled';
}

function extractRoundNumber(roundStr: string | null | undefined): number {
  if (!roundStr) return 0;
  const match = roundStr.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export class ApiFootballAdapter implements ProviderAdapter {
  readonly id = 'api_football' as const;
  readonly envVarName = 'API_FOOTBALL_KEY';
  readonly capabilities: ProviderCapabilities = {
    id: 'api_football',
    name: 'API-Football (API-Sports v3)',
    baseUrl: 'https://v3.football.api-sports.io',
    pricingSummary: 'Plan gratuito $0/mes (100 peticiones/día); planes pagos desde ~$19/mes.',
    rateLimitSummary: '100 req/día y ~10 req/min en tier gratuito (acceso limitado a temporadas recientes).',
    termsNote: 'Requiere cabecera x-apisports-key. xG disponible solo en fixtures concretos vía /fixtures/statistics.',
    supportsSchedules: true,
    supportsHistoricalResults: true,
    supportsStandings: true,
    supportsTeamStats: true,
    supportsXg: false,
    supportsOdds: false,
  };

  private getApiKey(): string {
    return (process.env.API_FOOTBALL_KEY ?? '').trim();
  }

  isConfigured(): boolean {
    return this.getApiKey().length > 0;
  }

  getQuotaRemaining(): string | null {
    return getProviderQuota(this.id);
  }

  private async fetchEndpoint(pathSuffix: string): Promise<{ response: unknown[]; fromCache: boolean }> {
    const cacheKey = `af:${pathSuffix}`;
    const cached = getCachedProviderResponse<unknown[]>(cacheKey);
    if (cached) {
      return { response: cached, fromCache: true };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('API_FOOTBALL_KEY no configurada en el servidor.');
    }

    await enforceProviderRateLimit(this.id, 6200);

    const url = `${this.capabilities.baseUrl}${pathSuffix}`;
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': apiKey,
        Accept: 'application/json',
      },
    });

    const dailyRem = res.headers.get('x-ratelimit-requests-remaining');
    if (dailyRem) {
      updateProviderQuota(this.id, `${dailyRem} req/día restantes`);
    }

    if (res.status === 429) {
      throw new Error('API-Football devolvió 429 (límite diario o por minuto alcanzado).');
    }
    if (!res.ok) {
      throw new Error(`API-Football respondió HTTP ${res.status}.`);
    }

    const raw = await res.json();
    const parsed = apiFootballEnvelopeSchema.parse(raw);

    if (
      parsed.errors &&
      ((Array.isArray(parsed.errors) && parsed.errors.length > 0) ||
        (!Array.isArray(parsed.errors) && Object.keys(parsed.errors).length > 0))
    ) {
      throw new Error(`API-Football devolvió error de validación: ${JSON.stringify(parsed.errors)}`);
    }

    setCachedProviderResponse(cacheKey, parsed.response, 180_000);
    return { response: parsed.response, fromCache: false };
  }

  async fetchLeagueData(params: {
    leagueId: LeagueId;
    seasonYear?: number;
  }): Promise<ProviderFetchResult> {
    const afLeagueId = API_FOOTBALL_LEAGUE_IDS[params.leagueId];
    const seasonYear = params.seasonYear ?? seasonStartYearFromDate();
    const seasonId = `${seasonYear}-${seasonYear + 1}`;
    const warnings: string[] = [
      'API-Football v3 en tier gratuito tiene cuota de 100 req/día; sincronización optimizada a 2 llamadas por liga (/standings + /fixtures).',
    ];

    let requestsUsed = 0;

    const standingsCall = await this.fetchEndpoint(
      `/standings?league=${afLeagueId}&season=${seasonYear}`
    );
    if (!standingsCall.fromCache) requestsUsed += 1;

    const fixturesCall = await this.fetchEndpoint(
      `/fixtures?league=${afLeagueId}&season=${seasonYear}`
    );
    if (!fixturesCall.fromCache) requestsUsed += 1;

    const teamsMap = new Map<string, NormalizedTeamRecord>();
    const statsMap = new Map<string, NormalizedTeamSeasonStats>();

    for (const item of standingsCall.response) {
      const parsed = standingsGroupSchema.safeParse(item);
      if (!parsed.success) continue;
      const primaryTable = parsed.data.league.standings[0] ?? [];

      for (const row of primaryTable) {
        const canonicalId = buildCanonicalTeamId(params.leagueId, row.team.name);
        teamsMap.set(canonicalId, {
          canonicalId,
          leagueId: params.leagueId,
          name: row.team.name,
          shortName: row.team.name.slice(0, 3).toUpperCase(),
          externalRefKey: this.id,
          externalId: row.team.id,
        });

        statsMap.set(canonicalId, {
          teamCanonicalId: canonicalId,
          teamName: row.team.name,
          leagueId: params.leagueId,
          seasonId,
          position: row.rank,
          points: row.points,
          played: row.all.played,
          won: row.all.win,
          drawn: row.all.draw,
          lost: row.all.lose,
          goalsFor: row.all.goals.for,
          goalsAgainst: row.all.goals.against,
          xg: null,
          xga: null,
          homePlayed: row.home?.played ?? null,
          homeWon: row.home?.win ?? null,
          homeDrawn: row.home?.draw ?? null,
          homeLost: row.home?.lose ?? null,
          homeGf: row.home?.goals.for ?? null,
          homeGa: row.home?.goals.against ?? null,
          awayPlayed: row.away?.played ?? null,
          awayWon: row.away?.win ?? null,
          awayDrawn: row.away?.draw ?? null,
          awayLost: row.away?.lose ?? null,
          awayGf: row.away?.goals.for ?? null,
          awayGa: row.away?.goals.against ?? null,
          formString: row.form ?? null,
          sourceProvider: this.id,
        });
      }
    }

    const matches: NormalizedMatchRecord[] = [];
    for (const item of fixturesCall.response) {
      const parsed = fixtureItemSchema.safeParse(item);
      if (!parsed.success) continue;
      const f = parsed.data;

      const homeCanonical = buildCanonicalTeamId(params.leagueId, f.teams.home.name);
      const awayCanonical = buildCanonicalTeamId(params.leagueId, f.teams.away.name);

      if (!teamsMap.has(homeCanonical)) {
        teamsMap.set(homeCanonical, {
          canonicalId: homeCanonical,
          leagueId: params.leagueId,
          name: f.teams.home.name,
          shortName: f.teams.home.name.slice(0, 3).toUpperCase(),
          externalRefKey: this.id,
          externalId: f.teams.home.id,
        });
      }
      if (!teamsMap.has(awayCanonical)) {
        teamsMap.set(awayCanonical, {
          canonicalId: awayCanonical,
          leagueId: params.leagueId,
          name: f.teams.away.name,
          shortName: f.teams.away.name.slice(0, 3).toUpperCase(),
          externalRefKey: this.id,
          externalId: f.teams.away.id,
        });
      }

      matches.push({
        externalId: `af_${f.fixture.id}`,
        provider: this.id,
        leagueId: params.leagueId,
        seasonId: f.league.season ? `${f.league.season}-${f.league.season + 1}` : deriveSeasonIdFromDate(f.fixture.date),
        matchday: extractRoundNumber(f.league.round),
        kickoffUtc: f.fixture.date,
        homeTeamName: f.teams.home.name,
        awayTeamName: f.teams.away.name,
        homeTeamExternalId: f.teams.home.id,
        awayTeamExternalId: f.teams.away.id,
        status: mapAfStatus(f.fixture.status.short),
        homeGoals: f.goals.home,
        awayGoals: f.goals.away,
        htHomeGoals: f.score?.halftime?.home ?? null,
        htAwayGoals: f.score?.halftime?.away ?? null,
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
