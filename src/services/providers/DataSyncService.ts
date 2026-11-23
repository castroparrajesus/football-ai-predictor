import { LeagueId } from '../../types/football.ts';
import { getPool, isDatabaseConfigured } from '../../db/pool.ts';
import { ApiFootballAdapter } from './ApiFootballAdapter.ts';
import {
  buildCanonicalTeamId,
  computeRealPoissonLambdas,
  seasonStartYearFromDate,
} from './DataNormalizer.ts';
import { FootballDataAdapter } from './FootballDataAdapter.ts';
import { OddsApiAdapter } from './OddsApiAdapter.ts';
import {
  NormalizedOddsRecord,
  ProviderAdapter,
  ProviderFetchResult,
  ProviderId,
  ProviderStatusInfo,
} from './types.ts';

const ALL_LEAGUES: LeagueId[] = [
  'premier_league',
  'laliga',
  'serie_a',
  'bundesliga',
  'ligue_1',
];

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

export class DataSyncService {
  private readonly adapters: Record<ProviderId, ProviderAdapter>;

  constructor() {
    this.adapters = {
      football_data: new FootballDataAdapter(),
      api_football: new ApiFootballAdapter(),
      the_odds_api: new OddsApiAdapter(),
    };
  }

  getAdapter(id: ProviderId): ProviderAdapter {
    return this.adapters[id];
  }

  async getProvidersStatus(): Promise<{
    providers: ProviderStatusInfo[];
    recentLogs: SyncLogEntry[];
  }> {
    const lastSyncByProvider = new Map<string, string>();
    let recentLogs: SyncLogEntry[] = [];

    const pool = getPool();
    if (pool && isDatabaseConfigured()) {
      try {
        const res = await pool.query<{
          id: number;
          provider_id: string;
          league_id: string | null;
          status: 'success' | 'partial' | 'error';
          matches_upserted: number;
          teams_upserted: number;
          odds_inserted: number;
          requests_used: number;
          quota_remaining: string | null;
          warnings: unknown;
          error_message: string | null;
          synced_at: Date;
        }>(
          `SELECT
            id, provider_id, league_id, status, matches_upserted,
            teams_upserted, odds_inserted, requests_used, quota_remaining,
            warnings, error_message, synced_at
           FROM provider_sync_logs
           ORDER BY synced_at DESC
           LIMIT 20`
        );

        recentLogs = res.rows.map((r) => {
          if (!lastSyncByProvider.has(r.provider_id) && r.status !== 'error') {
            lastSyncByProvider.set(r.provider_id, new Date(r.synced_at).toISOString());
          }
          return {
            id: r.id,
            providerId: r.provider_id,
            leagueId: r.league_id,
            status: r.status,
            matchesUpserted: r.matches_upserted,
            teamsUpserted: r.teams_upserted,
            oddsInserted: r.odds_inserted,
            requestsUsed: r.requests_used,
            quotaRemaining: r.quota_remaining,
            warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
            errorMessage: r.error_message,
            syncedAt: new Date(r.synced_at).toISOString(),
          };
        });
      } catch {
        // Tabla aún no migrada o DB sin configurar
      }
    }

    const providers: ProviderStatusInfo[] = (Object.values(this.adapters) as ProviderAdapter[]).map(
      (adapter) => ({
        id: adapter.id,
        name: adapter.capabilities.name,
        configured: adapter.isConfigured(),
        envVarName: adapter.envVarName,
        capabilities: adapter.capabilities,
        quotaRemaining: adapter.getQuotaRemaining(),
        lastSyncedAt: lastSyncByProvider.get(adapter.id) ?? null,
      })
    );

    return { providers, recentLogs };
  }

  private async persistNormalizedResult(result: ProviderFetchResult): Promise<{
    teamsUpserted: number;
    matchesUpserted: number;
    oddsInserted: number;
  }> {
    const pool = getPool();
    if (!pool) {
      const err = new Error('PostgreSQL no configurado.');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }

    const client = await pool.connect();
    let teamsUpserted = 0;
    let matchesUpserted = 0;
    let oddsInserted = 0;

    try {
      await client.query('BEGIN');

      // 1. Asegurar temporadas referenciadas
      const seasonIds = new Set<string>([
        ...result.teamStats.map((s) => s.seasonId),
        ...result.matches.map((m) => m.seasonId),
      ]);
      for (const sid of seasonIds) {
        const startYear = Number(sid.split('-')[0]) || seasonStartYearFromDate();
        await client.query(
          `INSERT INTO seasons (id, label, start_date, end_date, is_current)
           VALUES ($1, $2, $3::date, $4::date, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            sid,
            `Temporada ${sid.replace('-', '/')}`,
            `${startYear}-07-15`,
            `${startYear + 1}-06-30`,
            sid === `${seasonStartYearFromDate()}-${seasonStartYearFromDate() + 1}`,
          ]
        );
      }

      // Helper para evitar conflictos con uq_teams_league_name si el equipo ya existe bajo otro ID (p.ej. CSV previo)
      const resolvedTeamIds = new Map<string, string>();
      const resolveAndUpsertTeam = async (params: {
        canonicalId: string;
        leagueId: LeagueId;
        name: string;
        shortName: string;
        externalRefs?: Record<string, string | number>;
      }): Promise<string> => {
        const cached = resolvedTeamIds.get(params.canonicalId);
        if (cached && !params.externalRefs) return cached;

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM teams
           WHERE id = $1 OR (league_id = $2 AND LOWER(name) = LOWER($3))
           LIMIT 1`,
          [params.canonicalId, params.leagueId, params.name]
        );

        const targetId = existing.rows[0]?.id ?? params.canonicalId;

        if (existing.rowCount && existing.rowCount > 0) {
          if (params.externalRefs) {
            await client.query(
              `UPDATE teams
               SET short_name = $2,
                   external_refs = teams.external_refs || $3::jsonb,
                   updated_at = NOW()
               WHERE id = $1`,
              [targetId, params.shortName, JSON.stringify(params.externalRefs)]
            );
          }
        } else {
          await client.query(
            `INSERT INTO teams (id, league_id, name, short_name, external_refs)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             ON CONFLICT (id) DO UPDATE SET
               short_name = EXCLUDED.short_name,
               external_refs = teams.external_refs || EXCLUDED.external_refs,
               updated_at = NOW()`,
            [
              targetId,
              params.leagueId,
              params.name,
              params.shortName,
              JSON.stringify(params.externalRefs ?? {}),
            ]
          );
          teamsUpserted += 1;
        }

        resolvedTeamIds.set(params.canonicalId, targetId);
        return targetId;
      };

      // 2. Upsert equipos normalizados
      for (const team of result.teams) {
        await resolveAndUpsertTeam({
          canonicalId: team.canonicalId,
          leagueId: team.leagueId,
          name: team.name,
          shortName: team.shortName,
          externalRefs: { [team.externalRefKey]: team.externalId },
        });
      }

      // 3. Upsert estadísticas de temporada por equipo
      const statsLookup = new Map<string, { played: number; gf: number; ga: number }>();
      for (const st of result.teamStats) {
        const dbTeamId = await resolveAndUpsertTeam({
          canonicalId: st.teamCanonicalId,
          leagueId: st.leagueId,
          name: st.teamName,
          shortName: st.teamName.slice(0, 3).toUpperCase(),
        });
        statsLookup.set(dbTeamId, {
          played: st.played,
          gf: st.goalsFor,
          ga: st.goalsAgainst,
        });

        await client.query(
          `INSERT INTO team_season_stats (
            team_id, league_id, season_id, position, points,
            played, won, drawn, lost, goals_for, goals_against,
            xg, xga,
            home_played, home_won, home_drawn, home_lost, home_gf, home_ga,
            away_played, away_won, away_drawn, away_lost, away_gf, away_ga,
            form_string, source_provider, updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13,
            $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24, $25,
            $26, $27, NOW()
          )
          ON CONFLICT (team_id, season_id) DO UPDATE SET
            position = EXCLUDED.position,
            points = EXCLUDED.points,
            played = EXCLUDED.played,
            won = EXCLUDED.won,
            drawn = EXCLUDED.drawn,
            lost = EXCLUDED.lost,
            goals_for = EXCLUDED.goals_for,
            goals_against = EXCLUDED.goals_against,
            xg = COALESCE(EXCLUDED.xg, team_season_stats.xg),
            xga = COALESCE(EXCLUDED.xga, team_season_stats.xga),
            home_played = COALESCE(EXCLUDED.home_played, team_season_stats.home_played),
            home_won = COALESCE(EXCLUDED.home_won, team_season_stats.home_won),
            home_drawn = COALESCE(EXCLUDED.home_drawn, team_season_stats.home_drawn),
            home_lost = COALESCE(EXCLUDED.home_lost, team_season_stats.home_lost),
            home_gf = COALESCE(EXCLUDED.home_gf, team_season_stats.home_gf),
            home_ga = COALESCE(EXCLUDED.home_ga, team_season_stats.home_ga),
            away_played = COALESCE(EXCLUDED.away_played, team_season_stats.away_played),
            away_won = COALESCE(EXCLUDED.away_won, team_season_stats.away_won),
            away_drawn = COALESCE(EXCLUDED.away_drawn, team_season_stats.away_drawn),
            away_lost = COALESCE(EXCLUDED.away_lost, team_season_stats.away_lost),
            away_gf = COALESCE(EXCLUDED.away_gf, team_season_stats.away_gf),
            away_ga = COALESCE(EXCLUDED.away_ga, team_season_stats.away_ga),
            form_string = COALESCE(EXCLUDED.form_string, team_season_stats.form_string),
            source_provider = EXCLUDED.source_provider,
            updated_at = NOW()`,
          [
            dbTeamId,
            st.leagueId,
            st.seasonId,
            st.position,
            st.points,
            st.played,
            st.won,
            st.drawn,
            st.lost,
            st.goalsFor,
            st.goalsAgainst,
            st.xg,
            st.xga,
            st.homePlayed,
            st.homeWon,
            st.homeDrawn,
            st.homeLost,
            st.homeGf,
            st.homeGa,
            st.awayPlayed,
            st.awayWon,
            st.awayDrawn,
            st.awayLost,
            st.awayGf,
            st.awayGa,
            st.formString,
            st.sourceProvider,
          ]
        );
      }

      // 4. Upsert partidos y resultados
      for (const m of result.matches) {
        const homeCanonical = buildCanonicalTeamId(m.leagueId, m.homeTeamName);
        const awayCanonical = buildCanonicalTeamId(m.leagueId, m.awayTeamName);
        if (homeCanonical === awayCanonical) continue;

        const homeId = await resolveAndUpsertTeam({
          canonicalId: homeCanonical,
          leagueId: m.leagueId,
          name: m.homeTeamName,
          shortName: m.homeTeamName.slice(0, 3).toUpperCase(),
        });
        const awayId = await resolveAndUpsertTeam({
          canonicalId: awayCanonical,
          leagueId: m.leagueId,
          name: m.awayTeamName,
          shortName: m.awayTeamName.slice(0, 3).toUpperCase(),
        });
        if (homeId === awayId) continue;

        const hs = statsLookup.get(homeId);
        const as = statsLookup.get(awayId);
        const lambdas =
          hs && as
            ? computeRealPoissonLambdas({
                homePlayed: hs.played,
                homeGf: hs.gf,
                homeGa: hs.ga,
                awayPlayed: as.played,
                awayGf: as.gf,
                awayGa: as.ga,
              })
            : { lambdaHome: null, lambdaAway: null };

        const missingNotes: string[] = [];
        if (lambdas.lambdaHome === null) {
          missingNotes.push('Histórico real insuficiente (<3 partidos) para estimar Poisson.');
        }
        missingNotes.push('Sin xG/xGA ni alineaciones confirmadas en el proveedor actual.');
        const completeness = lambdas.lambdaHome !== null ? 68 : 42;

        const matchDbId = `api_${m.leagueId}_${m.externalId}`.slice(0, 120);
        const upsertedMatch = await client.query<{ id: string }>(
          `INSERT INTO matches (
            id, league_id, season_id, matchday, kickoff_utc,
            home_team_id, away_team_id, status, source_type, external_id,
            expected_lambda_home, expected_lambda_away, data_completeness, missing_data_notes
          )
          VALUES (
            $1, $2, $3, $4, $5::timestamptz,
            $6, $7, $8, 'api', $9,
            $10, $11, $12, $13::jsonb
          )
          ON CONFLICT ON CONSTRAINT uq_match_fixture DO UPDATE SET
            status = EXCLUDED.status,
            matchday = EXCLUDED.matchday,
            external_id = COALESCE(EXCLUDED.external_id, matches.external_id),
            expected_lambda_home = COALESCE(EXCLUDED.expected_lambda_home, matches.expected_lambda_home),
            expected_lambda_away = COALESCE(EXCLUDED.expected_lambda_away, matches.expected_lambda_away),
            data_completeness = GREATEST(matches.data_completeness, EXCLUDED.data_completeness),
            updated_at = NOW()
          RETURNING id`,
          [
            matchDbId,
            m.leagueId,
            m.seasonId,
            m.matchday,
            m.kickoffUtc,
            homeId,
            awayId,
            m.status,
            m.externalId,
            lambdas.lambdaHome,
            lambdas.lambdaAway,
            completeness,
            JSON.stringify(missingNotes),
          ]
        );

        const realMatchId = upsertedMatch.rows[0].id;
        matchesUpserted += 1;

        if (m.status === 'finished' && m.homeGoals !== null && m.awayGoals !== null) {
          await client.query(
            `INSERT INTO match_results (match_id, home_goals, away_goals, ht_home_goals, ht_away_goals)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (match_id) DO UPDATE SET
               home_goals = EXCLUDED.home_goals,
               away_goals = EXCLUDED.away_goals,
               ht_home_goals = COALESCE(EXCLUDED.ht_home_goals, match_results.ht_home_goals),
               ht_away_goals = COALESCE(EXCLUDED.ht_away_goals, match_results.ht_away_goals),
               settled_at = NOW()`,
            [realMatchId, m.homeGoals, m.awayGoals, m.htHomeGoals, m.htAwayGoals]
          );
        }
      }

      // 5. Vincular cuotas (The Odds API) con partidos ya persistidos
      if (result.odds.length > 0) {
        oddsInserted += await this.persistOddsList(client, result.odds);
      }

      await client.query('COMMIT');
      return { teamsUpserted, matchesUpserted, oddsInserted };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async persistOddsList(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> },
    odds: NormalizedOddsRecord[]
  ): Promise<number> {
    let inserted = 0;
    const matchCache = new Map<
      string,
      { id: string; kickoffMs: number; status: string } | null
    >();

    for (const o of odds) {
      const homeId = buildCanonicalTeamId(o.leagueId, o.homeTeamName);
      const awayId = buildCanonicalTeamId(o.leagueId, o.awayTeamName);
      const cacheKey = `${o.leagueId}|${homeId}|${awayId}|${o.kickoffUtc.slice(0, 10)}`;

      let matchInfo = matchCache.get(cacheKey);
      if (matchInfo === undefined) {
        const found = await client.query(
          `SELECT id, kickoff_utc, status FROM matches
           WHERE league_id = $1
             AND home_team_id = $2
             AND away_team_id = $3
             AND kickoff_utc BETWEEN ($4::timestamptz - INTERVAL '36 hours') AND ($4::timestamptz + INTERVAL '36 hours')
           ORDER BY ABS(EXTRACT(EPOCH FROM (kickoff_utc - $4::timestamptz))) ASC
           LIMIT 1`,
          [o.leagueId, homeId, awayId, o.kickoffUtc]
        );
        const row = found.rows[0] as
          | { id: string; kickoff_utc: Date; status: string }
          | undefined;
        matchInfo = row
          ? {
              id: row.id,
              kickoffMs: new Date(row.kickoff_utc).getTime(),
              status: row.status,
            }
          : null;
        matchCache.set(cacheKey, matchInfo);
      }

      if (!matchInfo) continue;

      const capturedMs = Date.parse(o.capturedAtUtc) || Date.now();
      const minutesToKickoff = Math.round((matchInfo.kickoffMs - capturedMs) / 60_000);

      // Evitar guardar cuotas caducadas o de partidos ya iniciados/finalizados
      if (matchInfo.status === 'finished' || minutesToKickoff < 0) {
        continue;
      }

      const isClosing = minutesToKickoff <= 90;

      // Comprobar último snapshot inmutable para evitar ruido repetido idéntico en <30 min
      const latestRes = await client.query(
        `SELECT decimal_odds, captured_at, is_closing
         FROM odds_snapshots
         WHERE match_id = $1 AND bookmaker = $2 AND market = $3 AND selection = $4
         ORDER BY captured_at DESC
         LIMIT 1`,
        [matchInfo.id, o.bookmaker, o.market, o.selection]
      );
      const latest = latestRes.rows[0] as
        | { decimal_odds: string; captured_at: Date; is_closing: boolean }
        | undefined;

      if (latest) {
        const samePrice = Math.abs(Number(latest.decimal_odds) - o.decimalOdds) < 0.0005;
        const elapsedMs = capturedMs - new Date(latest.captured_at).getTime();
        if (samePrice && latest.is_closing === isClosing && elapsedMs < 30 * 60_000) {
          continue;
        }
      }

      try {
        await client.query(
          `INSERT INTO odds_snapshots (
            match_id, bookmaker, market, selection, decimal_odds,
            captured_at, is_closing, minutes_to_kickoff
          )
          VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
          [
            matchInfo.id,
            o.bookmaker,
            o.market,
            o.selection,
            o.decimalOdds,
            o.capturedAtUtc,
            isClosing,
            minutesToKickoff,
          ]
        );
      } catch {
        await client.query(
          `INSERT INTO odds_snapshots (
            match_id, bookmaker, market, selection, decimal_odds, captured_at, is_closing
          )
          VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)`,
          [
            matchInfo.id,
            o.bookmaker,
            o.market,
            o.selection,
            o.decimalOdds,
            o.capturedAtUtc,
            isClosing,
          ]
        );
      }
      inserted += 1;
    }
    return inserted;
  }

  async syncFromProvider(params: {
    provider: ProviderId;
    leagueFilter: LeagueId | 'all';
    seasonYear?: number;
    includeOdds?: boolean;
  }): Promise<SyncExecutionSummary> {
    const adapter = this.getAdapter(params.provider);
    if (!adapter.isConfigured()) {
      const err = new Error(
        `El proveedor ${adapter.capabilities.name} no tiene clave configurada (${adapter.envVarName}).`
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    const pool = getPool();
    if (!pool) {
      const err = new Error('PostgreSQL no configurado.');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }

    const targetLeagues = params.leagueFilter === 'all' ? ALL_LEAGUES : [params.leagueFilter];
    let totalTeams = 0;
    let totalMatches = 0;
    let totalOdds = 0;
    let totalRequests = 0;
    let lastQuota: string | null = null;
    const allWarnings = new Set<string>();

    for (const lg of targetLeagues) {
      try {
        const fetched = await adapter.fetchLeagueData({
          leagueId: lg,
          seasonYear: params.seasonYear,
        });

        const persisted = await this.persistNormalizedResult(fetched);
        totalTeams += persisted.teamsUpserted;
        totalMatches += persisted.matchesUpserted;
        totalOdds += persisted.oddsInserted;
        totalRequests += fetched.requestsUsed;
        lastQuota = fetched.quotaRemaining ?? lastQuota;
        fetched.warnings.forEach((w) => allWarnings.add(w));

        let oddsExtraCount = 0;
        let leagueStatus: 'success' | 'partial' = 'success';
        const leagueWarnings = [...fetched.warnings];

        if (
          params.includeOdds &&
          params.provider !== 'the_odds_api' &&
          this.adapters.the_odds_api.isConfigured()
        ) {
          try {
            const oddsFetch = await this.adapters.the_odds_api.fetchLeagueData({ leagueId: lg });
            const oddsPersisted = await this.persistNormalizedResult(oddsFetch);
            oddsExtraCount = oddsPersisted.oddsInserted;
            totalOdds += oddsExtraCount;
            totalRequests += oddsFetch.requestsUsed;
          } catch (oddsErr) {
            leagueStatus = 'partial';
            const oddsMsg =
              oddsErr instanceof Error
                ? oddsErr.message
                : 'Error consultando cuotas en The Odds API.';
            const warnText = `Cuotas omitidas: ${oddsMsg}`;
            leagueWarnings.push(warnText);
            allWarnings.add(warnText);
          }
        }

        await pool.query(
          `INSERT INTO provider_sync_logs (
            provider_id, league_id, status, matches_upserted, teams_upserted,
            odds_inserted, requests_used, quota_remaining, warnings
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            params.provider,
            lg,
            leagueStatus,
            persisted.matchesUpserted,
            persisted.teamsUpserted,
            persisted.oddsInserted + oddsExtraCount,
            fetched.requestsUsed,
            fetched.quotaRemaining,
            JSON.stringify(leagueWarnings),
          ]
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error sincronizando liga.';
        await pool
          .query(
            `INSERT INTO provider_sync_logs (
              provider_id, league_id, status, error_message
            ) VALUES ($1, $2, 'error', $3)`,
            [params.provider, lg, msg]
          )
          .catch(() => {});
        throw err;
      }
    }

    // Liquidar automáticamente predicciones y oportunidades pendientes si entraron nuevos resultados
    if (totalMatches > 0) {
      await import('../engine/monitoringService.ts')
        .then((m) => m.autoSettleAllPendingInDb())
        .catch(() => {});
    }

    return {
      provider: params.provider,
      leaguesSynced: targetLeagues,
      teamsUpserted: totalTeams,
      matchesUpserted: totalMatches,
      oddsInserted: totalOdds,
      requestsUsed: totalRequests,
      quotaRemaining: lastQuota,
      warnings: Array.from(allWarnings),
    };
  }
}

export const dataSyncService = new DataSyncService();
