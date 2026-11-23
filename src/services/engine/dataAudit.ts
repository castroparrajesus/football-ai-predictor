import { getPool } from '../../db/pool.ts';
import { DataAuditReport } from '../../types/football.ts';

export async function runDatabaseAudit(): Promise<DataAuditReport> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const [
    totalsRes,
    byLeagueRes,
    bySeasonRes,
    byStatusRes,
    dupMatchesRes,
    dupTeamsRes,
    oddsAuditRes,
    statsCoverageRes,
  ] = await Promise.all([
    pool.query<{
      total_matches: string;
      total_teams: string;
      finished_matches: string;
      finished_with_results: string;
      scheduled_matches: string;
      min_date: Date | null;
      max_date: Date | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM matches) AS total_matches,
        (SELECT COUNT(*) FROM teams) AS total_teams,
        (SELECT COUNT(*) FROM matches WHERE status = 'finished') AS finished_matches,
        (SELECT COUNT(*) FROM matches m JOIN match_results mr ON mr.match_id = m.id WHERE m.status = 'finished') AS finished_with_results,
        (SELECT COUNT(*) FROM matches WHERE status IN ('scheduled', 'live')) AS scheduled_matches,
        (SELECT MIN(kickoff_utc) FROM matches) AS min_date,
        (SELECT MAX(kickoff_utc) FROM matches) AS max_date
    `),
    pool.query<{
      league_id: string;
      total: string;
      finished: string;
      scheduled: string;
      with_odds: string;
    }>(`
      SELECT
        m.league_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE m.status = 'finished') AS finished,
        COUNT(*) FILTER (WHERE m.status IN ('scheduled', 'live')) AS scheduled,
        COUNT(DISTINCT os.match_id) AS with_odds
      FROM matches m
      LEFT JOIN odds_snapshots os ON os.match_id = m.id
      GROUP BY m.league_id
      ORDER BY m.league_id ASC
    `),
    pool.query<{
      season_id: string;
      total: string;
      finished: string;
      scheduled: string;
    }>(`
      SELECT
        season_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'finished') AS finished,
        COUNT(*) FILTER (WHERE status IN ('scheduled', 'live')) AS scheduled
      FROM matches
      GROUP BY season_id
      ORDER BY season_id DESC
    `),
    pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM matches GROUP BY status ORDER BY count DESC`
    ),
    pool.query<{ dup_groups: string }>(`
      SELECT COUNT(*) AS dup_groups FROM (
        SELECT league_id, home_team_id, away_team_id, DATE(kickoff_utc AT TIME ZONE 'UTC')
        FROM matches
        GROUP BY league_id, home_team_id, away_team_id, DATE(kickoff_utc AT TIME ZONE 'UTC')
        HAVING COUNT(*) > 1
      ) sub
    `),
    pool.query<{ dup_teams: string }>(`
      SELECT COUNT(*) AS dup_teams FROM (
        SELECT league_id, LOWER(REGEXP_REPLACE(name, '\\s+(FC|CF|AFC|SC)$', '', 'i')) AS norm_name
        FROM teams
        GROUP BY league_id, LOWER(REGEXP_REPLACE(name, '\\s+(FC|CF|AFC|SC)$', '', 'i'))
        HAVING COUNT(*) > 1
      ) sub
    `),
    pool.query<{
      total_odds: string;
      matches_with_odds: string;
      upcoming_matches_with_odds: string;
      finished_matches_with_odds: string;
      expired_odds_rows: string;
      markets: string | null;
      bookmakers: string | null;
    }>(`
      SELECT
        COUNT(os.id) AS total_odds,
        COUNT(DISTINCT os.match_id) AS matches_with_odds,
        COUNT(DISTINCT os.match_id) FILTER (WHERE m.kickoff_utc > NOW() AND m.status IN ('scheduled', 'live')) AS upcoming_matches_with_odds,
        COUNT(DISTINCT os.match_id) FILTER (WHERE m.status = 'finished') AS finished_matches_with_odds,
        COUNT(os.id) FILTER (WHERE os.captured_at > m.kickoff_utc) AS expired_odds_rows,
        STRING_AGG(DISTINCT os.market, ', ') AS markets,
        STRING_AGG(DISTINCT os.bookmaker, ', ') AS bookmakers
      FROM odds_snapshots os
      JOIN matches m ON m.id = os.match_id
    `),
    pool.query<{
      season_stats_rows: string;
      match_stats_rows: string;
      xg_rows: string;
      lineup_rows: string;
      injury_rows: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM team_season_stats) AS season_stats_rows,
        (SELECT COUNT(*) FROM team_match_stats) AS match_stats_rows,
        (SELECT COUNT(*) FROM team_match_stats WHERE xg IS NOT NULL) AS xg_rows,
        (SELECT COUNT(*) FROM lineups) AS lineup_rows,
        (SELECT COUNT(*) FROM injuries_suspensions) AS injury_rows
    `),
  ]);

  const t = totalsRes.rows[0];
  const o = oddsAuditRes.rows[0];
  const sc = statsCoverageRes.rows[0];

  const totalMatches = Number(t?.total_matches ?? 0);
  const finishedMatches = Number(t?.finished_matches ?? 0);
  const finishedWithResults = Number(t?.finished_with_results ?? 0);
  const duplicateFixtures = Number(dupMatchesRes.rows[0]?.dup_groups ?? 0);
  const potentialDuplicateTeams = Number(dupTeamsRes.rows[0]?.dup_teams ?? 0);
  const xgRows = Number(sc?.xg_rows ?? 0);
  const matchStatsRows = Number(sc?.match_stats_rows ?? 0);
  const lineupRows = Number(sc?.lineup_rows ?? 0);
  const injuryRows = Number(sc?.injury_rows ?? 0);
  const finishedWithOdds = Number(o?.finished_matches_with_odds ?? 0);

  const missingDataGaps: string[] = [];
  if (xgRows === 0) {
    missingDataGaps.push('xG y xGA por partido (0 registros en proveedores gratuitos actuales).');
  }
  if (matchStatsRows === 0) {
    missingDataGaps.push('Estadísticas granulares por partido (tiros, córners, tarjetas: 0 registros).');
  }
  if (lineupRows === 0) {
    missingDataGaps.push('Alineaciones confirmadas pre-partido (0 registros).');
  }
  if (injuryRows === 0) {
    missingDataGaps.push('Lesiones y sanciones de jugadores (0 registros).');
  }
  if (finishedWithOdds === 0) {
    missingDataGaps.push(
      'Cuotas históricas cerradas para partidos finalizados (The Odds API gratuita solo entrega próximos encuentros; ROI histórico requiere acumular snapshots pre-partido o CSV históricos).'
    );
  }
  if (finishedMatches > finishedWithResults) {
    missingDataGaps.push(
      `${finishedMatches - finishedWithResults} partidos con estado 'finished' sin fila en match_results.`
    );
  }
  if (potentialDuplicateTeams > 0) {
    missingDataGaps.push(
      `${potentialDuplicateTeams} grupos de nombres de equipos similares entre temporadas 2024/25 (API-Football) y 2026/27 (Football-Data).`
    );
  }

  return {
    generatedAtUtc: new Date().toISOString(),
    totals: {
      matches: totalMatches,
      teams: Number(t?.total_teams ?? 0),
      finishedMatches,
      finishedWithResults,
      scheduledMatches: Number(t?.scheduled_matches ?? 0),
      duplicateFixtureGroups: duplicateFixtures,
      potentialDuplicateTeamGroups: potentialDuplicateTeams,
      dateRangeMinUtc: t?.min_date ? new Date(t.min_date).toISOString() : null,
      dateRangeMaxUtc: t?.max_date ? new Date(t.max_date).toISOString() : null,
    },
    oddsAudit: {
      totalOddsRows: Number(o?.total_odds ?? 0),
      matchesWithOdds: Number(o?.matches_with_odds ?? 0),
      upcomingMatchesWithOdds: Number(o?.upcoming_matches_with_odds ?? 0),
      finishedMatchesWithOdds: finishedWithOdds,
      expiredOddsRows: Number(o?.expired_odds_rows ?? 0),
      markets: o?.markets ? o.markets.split(', ').filter(Boolean) : [],
      bookmakers: o?.bookmakers ? o.bookmakers.split(', ').filter(Boolean) : [],
    },
    coverage: {
      teamSeasonStatsRows: Number(sc?.season_stats_rows ?? 0),
      teamMatchStatsRows: matchStatsRows,
      xgRows,
      lineupRows,
      injuryRows,
    },
    byLeague: byLeagueRes.rows.map((r) => ({
      leagueId: r.league_id,
      total: Number(r.total),
      finished: Number(r.finished),
      scheduled: Number(r.scheduled),
      withOdds: Number(r.with_odds),
    })),
    bySeason: bySeasonRes.rows.map((r) => ({
      seasonId: r.season_id,
      total: Number(r.total),
      finished: Number(r.finished),
      scheduled: Number(r.scheduled),
    })),
    byStatus: byStatusRes.rows.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
    missingDataGaps,
  };
}
