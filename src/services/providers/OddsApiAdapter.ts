import { z } from 'zod';
import { LeagueId } from '../../types/football.ts';
import {
  getCachedProviderResponse,
  getProviderQuota,
  setCachedProviderResponse,
  updateProviderQuota,
} from './rateLimiter.ts';
import {
  NormalizedOddsRecord,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderFetchResult,
} from './types.ts';

const ODDS_SPORT_KEYS: Record<LeagueId, string> = {
  premier_league: 'soccer_epl',
  laliga: 'soccer_spain_la_liga',
  serie_a: 'soccer_italy_serie_a',
  bundesliga: 'soccer_germany_bundesliga',
  ligue_1: 'soccer_france_ligue_one',
};

const oddsEventSchema = z.object({
  id: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z
    .array(
      z.object({
        key: z.string(),
        title: z.string(),
        markets: z.array(
          z.object({
            key: z.string(),
            outcomes: z.array(
              z.object({
                name: z.string(),
                price: z.number(),
                point: z.number().optional(),
              })
            ),
          })
        ),
      })
    )
    .default([]),
});

const oddsResponseSchema = z.array(oddsEventSchema);

export class OddsApiAdapter implements ProviderAdapter {
  readonly id = 'the_odds_api' as const;
  readonly envVarName = 'ODDS_API_KEY';
  readonly capabilities: ProviderCapabilities = {
    id: 'the_odds_api',
    name: 'The Odds API (v4)',
    baseUrl: 'https://api.the-odds-api.com/v4',
    pricingSummary: 'Plan gratuito $0/mes (500 créditos/mes); planes pagos desde $30/mes (20K créditos).',
    rateLimitSummary: 'Consumo por créditos = mercados × regiones (ej. h2h+totals en región eu = 2 créditos/llamada).',
    termsNote: 'Provee únicamente cuotas pre-partido/en vivo; requiere combinar con Football-Data o API-Football para resultados y tablas.',
    supportsSchedules: true,
    supportsHistoricalResults: false,
    supportsStandings: false,
    supportsTeamStats: false,
    supportsXg: false,
    supportsOdds: true,
  };

  private getApiKey(): string {
    return (process.env.ODDS_API_KEY ?? '').trim();
  }

  isConfigured(): boolean {
    return this.getApiKey().length > 0;
  }

  getQuotaRemaining(): string | null {
    return getProviderQuota(this.id);
  }

  async fetchLeagueData(params: {
    leagueId: LeagueId;
    seasonYear?: number;
  }): Promise<ProviderFetchResult> {
    const sportKey = ODDS_SPORT_KEYS[params.leagueId];
    const cacheKey = `odds:${sportKey}`;
    const cached = getCachedProviderResponse<z.infer<typeof oddsResponseSchema>>(cacheKey);

    let events: z.infer<typeof oddsResponseSchema>;
    let requestsUsed = 0;

    if (cached) {
      events = cached;
    } else {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw new Error('ODDS_API_KEY no configurada en el servidor.');
      }

      const url = new URL(`${this.capabilities.baseUrl}/sports/${sportKey}/odds`);
      url.searchParams.set('regions', 'eu');
      url.searchParams.set('markets', 'h2h,totals');
      url.searchParams.set('oddsFormat', 'decimal');
      url.searchParams.set('apiKey', apiKey);

      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });

      const rem = res.headers.get('x-requests-remaining');
      const used = res.headers.get('x-requests-used');
      if (rem) {
        updateProviderQuota(this.id, `${rem} créditos restantes (usados: ${used ?? '?'})`);
      }

      if (!res.ok) {
        let upstreamDetail = '';
        try {
          const errBody = (await res.json()) as { message?: string; error_code?: string };
          if (errBody?.message) {
            upstreamDetail = ` (${errBody.message})`;
          } else if (errBody?.error_code) {
            upstreamDetail = ` (${errBody.error_code})`;
          }
        } catch {
          // Ignorar cuerpo no JSON
        }
        if (res.status === 401) {
          throw new Error(`The Odds API rechazó ODDS_API_KEY (401)${upstreamDetail}.`);
        }
        if (res.status === 429) {
          throw new Error(`The Odds API devolvió 429 (límite de frecuencia excedido)${upstreamDetail}.`);
        }
        throw new Error(`The Odds API respondió HTTP ${res.status}${upstreamDetail}.`);
      }

      const raw = await res.json();
      events = oddsResponseSchema.parse(raw);
      requestsUsed = 2; // 2 mercados (h2h, totals) * 1 región (eu)
      setCachedProviderResponse(cacheKey, events, 180_000);
    }

    const odds: NormalizedOddsRecord[] = [];
    const nowIso = new Date().toISOString();

    for (const ev of events) {
      // Tomar la primera casa de apuestas europea con mercado h2h completo (o pinnacle/betfair si está disponible)
      const preferred =
        ev.bookmakers.find((b) => ['pinnacle', 'betfair_ex_eu', 'onexbet', 'marathonbet'].includes(b.key)) ??
        ev.bookmakers[0];
      if (!preferred) continue;

      const h2h = preferred.markets.find((m) => m.key === 'h2h');
      if (h2h) {
        const homeOutcome = h2h.outcomes.find((o) => o.name === ev.home_team);
        const awayOutcome = h2h.outcomes.find((o) => o.name === ev.away_team);
        const drawOutcome = h2h.outcomes.find((o) => o.name.toLowerCase() === 'draw');

        if (homeOutcome && homeOutcome.price > 1) {
          odds.push({
            leagueId: params.leagueId,
            kickoffUtc: ev.commence_time,
            homeTeamName: ev.home_team,
            awayTeamName: ev.away_team,
            bookmaker: preferred.title,
            market: '1X2',
            selection: '1',
            decimalOdds: homeOutcome.price,
            capturedAtUtc: nowIso,
          });
        }
        if (drawOutcome && drawOutcome.price > 1) {
          odds.push({
            leagueId: params.leagueId,
            kickoffUtc: ev.commence_time,
            homeTeamName: ev.home_team,
            awayTeamName: ev.away_team,
            bookmaker: preferred.title,
            market: '1X2',
            selection: 'X',
            decimalOdds: drawOutcome.price,
            capturedAtUtc: nowIso,
          });
        }
        if (awayOutcome && awayOutcome.price > 1) {
          odds.push({
            leagueId: params.leagueId,
            kickoffUtc: ev.commence_time,
            homeTeamName: ev.home_team,
            awayTeamName: ev.away_team,
            bookmaker: preferred.title,
            market: '1X2',
            selection: '2',
            decimalOdds: awayOutcome.price,
            capturedAtUtc: nowIso,
          });
        }
      }

      const totals = preferred.markets.find((m) => m.key === 'totals');
      if (totals) {
        const over25 = totals.outcomes.find((o) => o.name === 'Over' && o.point === 2.5);
        const under25 = totals.outcomes.find((o) => o.name === 'Under' && o.point === 2.5);
        if (over25 && over25.price > 1) {
          odds.push({
            leagueId: params.leagueId,
            kickoffUtc: ev.commence_time,
            homeTeamName: ev.home_team,
            awayTeamName: ev.away_team,
            bookmaker: preferred.title,
            market: 'OU25',
            selection: 'Over 2.5',
            decimalOdds: over25.price,
            capturedAtUtc: nowIso,
          });
        }
        if (under25 && under25.price > 1) {
          odds.push({
            leagueId: params.leagueId,
            kickoffUtc: ev.commence_time,
            homeTeamName: ev.home_team,
            awayTeamName: ev.away_team,
            bookmaker: preferred.title,
            market: 'OU25',
            selection: 'Under 2.5',
            decimalOdds: under25.price,
            capturedAtUtc: nowIso,
          });
        }
      }
    }

    return {
      provider: this.id,
      leagueId: params.leagueId,
      teams: [],
      teamStats: [],
      matches: [],
      odds,
      requestsUsed,
      quotaRemaining: this.getQuotaRemaining(),
      warnings: [
        'The Odds API proporciona cuotas de próximos partidos; no incluye clasificación ni resultados históricos.',
      ],
    };
  }
}
