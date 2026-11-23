import { Pool } from 'pg';
import {
  CalibrationBin,
  ConfidenceTier,
  DetectedValueOpportunityRecord,
  EnsembleWeights,
  LeagueFilter,
  LeagueId,
  MatchRecord,
  PredictionHistoryItem,
  QualityFilterThresholds,
  TeamStatisticalProfile,
} from '../types/football.ts';
import {
  computeBrierScoreBinary,
  computeLogLossBinary,
  removeBookmakerMargin,
} from '../utils/previewMath.ts';
import {
  getActiveTrainedModelFromDb,
  loadChronologicalMatches,
} from '../services/engine/backtestService.ts';
import { runMatchInference } from '../services/engine/liveInference.ts';
import {
  createChronoState,
  updateChronoStateWithMatch,
} from '../services/engine/models.ts';
import { checkDatabaseConnection, getPool } from './pool.ts';

function requirePool(): Pool {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }
  return pool;
}

function slugifyTeamId(leagueId: string, teamName: string): string {
  const clean = teamName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${leagueId}_${clean}`;
}

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

export async function getDbStatusSummary(): Promise<DbStatusSummary> {
  const health = await checkDatabaseConnection();
  const emptyCounts = { leagues: 0, seasons: 0, teams: 0, matches: 0, predictions: 0 };

  if (!health.connected || !health.schemaReady) {
    return {
      ...health,
      counts: emptyCounts,
      lastImportAt: null,
      lastImportFilename: null,
      lastPredictionAt: null,
    };
  }

  const pool = requirePool();
  try {
    const [countsRes, importRes, predRes] = await Promise.all([
      pool.query<{
        leagues: string;
        seasons: string;
        teams: string;
        matches: string;
        predictions: string;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM leagues) AS leagues,
          (SELECT COUNT(*) FROM seasons) AS seasons,
          (SELECT COUNT(*) FROM teams) AS teams,
          (SELECT COUNT(*) FROM matches) AS matches,
          (SELECT COUNT(*) FROM predictions) AS predictions
      `),
      pool.query<{ created_at: Date; filename: string | null }>(
        'SELECT created_at, filename FROM import_batches ORDER BY created_at DESC LIMIT 1'
      ),
      pool.query<{ created_at: Date }>(
        'SELECT created_at FROM predictions ORDER BY created_at DESC LIMIT 1'
      ),
    ]);

    const c = countsRes.rows[0];
    return {
      ...health,
      counts: {
        leagues: Number(c?.leagues ?? 0),
        seasons: Number(c?.seasons ?? 0),
        teams: Number(c?.teams ?? 0),
        matches: Number(c?.matches ?? 0),
        predictions: Number(c?.predictions ?? 0),
      },
      lastImportAt: importRes.rows[0]?.created_at
        ? new Date(importRes.rows[0].created_at).toISOString()
        : null,
      lastImportFilename: importRes.rows[0]?.filename ?? null,
      lastPredictionAt: predRes.rows[0]?.created_at
        ? new Date(predRes.rows[0].created_at).toISOString()
        : null,
    };
  } catch (err) {
    console.error('[getDbStatusSummary error]:', err);
    return {
      ...health,
      error: 'Error consultando métricas de estado en PostgreSQL.',
      counts: emptyCounts,
      lastImportAt: null,
      lastImportFilename: null,
      lastPredictionAt: null,
    };
  }
}

export async function getLeaguesFromDb() {
  const pool = requirePool();
  const res = await pool.query<{
    id: LeagueId;
    code: string;
    name: string;
    country: string;
    tier: number;
    teams_count: number;
  }>('SELECT id, code, name, country, tier, teams_count FROM leagues ORDER BY name ASC');
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    country: r.country,
    tier: r.tier,
    teamsCount: r.teams_count,
  }));
}

export async function getSeasonsFromDb() {
  const pool = requirePool();
  const res = await pool.query<{
    id: string;
    label: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
  }>('SELECT id, label, start_date::text, end_date::text, is_current FROM seasons ORDER BY start_date DESC');
  return res.rows.map((r) => ({
    id: r.id,
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    isCurrent: r.is_current,
  }));
}

export async function getTeamsFromDb(leagueId?: string): Promise<TeamStatisticalProfile[]> {
  const pool = requirePool();
  const params: unknown[] = [];
  let whereClause = '';
  if (leagueId && leagueId !== 'all') {
    params.push(leagueId);
    whereClause = 'WHERE t.league_id = $1';
  }

  const teamsRes = await pool.query<{
    id: string;
    league_id: LeagueId;
    name: string;
    short_name: string;
    elo_rating: string;
  }>(
    `SELECT t.id, t.league_id, t.name, t.short_name, t.elo_rating
     FROM teams t
     ${whereClause}
     ORDER BY t.league_id, t.name`,
    params
  );

  // Calcular estadísticas reales agregadas desde match_results y team_match_stats
  const statsRes = await pool.query<{
    team_id: string;
    is_home: boolean;
    home_goals: number | null;
    away_goals: number | null;
    home_team_id: string;
    away_team_id: string;
    xg: string | null;
    xga: string | null;
    shots: number | null;
    shots_on_target: number | null;
    corners: number | null;
    yellow_cards: number | null;
    red_cards: number | null;
    kickoff_utc: Date;
  }>(`
    SELECT
      CASE WHEN m.home_team_id = t.id THEN m.home_team_id ELSE m.away_team_id END AS team_id,
      (m.home_team_id = t.id) AS is_home,
      mr.home_goals,
      mr.away_goals,
      m.home_team_id,
      m.away_team_id,
      tms.xg,
      tms.xga,
      tms.shots,
      tms.shots_on_target,
      tms.corners,
      tms.yellow_cards,
      tms.red_cards,
      m.kickoff_utc
    FROM teams t
    JOIN matches m ON m.home_team_id = t.id OR m.away_team_id = t.id
    LEFT JOIN match_results mr ON mr.match_id = m.id
    LEFT JOIN team_match_stats tms ON tms.match_id = m.id AND tms.team_id = t.id
    ${whereClause}
    ORDER BY m.kickoff_utc DESC
  `, params);

  const byTeam = new Map<string, typeof statsRes.rows>();
  for (const row of statsRes.rows) {
    const arr = byTeam.get(row.team_id) ?? [];
    arr.push(row);
    byTeam.set(row.team_id, arr);
  }

  interface SeasonStatRow {
    team_id: string;
    position: number | null;
    points: number | null;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goals_for: number;
    goals_against: number;
    xg: string | null;
    xga: string | null;
    home_played: number | null;
    home_won: number | null;
    home_drawn: number | null;
    home_lost: number | null;
    home_gf: number | null;
    home_ga: number | null;
    away_played: number | null;
    away_won: number | null;
    away_drawn: number | null;
    away_lost: number | null;
    away_gf: number | null;
    away_ga: number | null;
    form_string: string | null;
  }

  const seasonStatsByTeam = new Map<string, SeasonStatRow>();
  try {
    const seasonWhere = leagueId && leagueId !== 'all' ? 'WHERE tss.league_id = $1' : '';
    const seasonRes = await pool.query<SeasonStatRow>(
      `SELECT DISTINCT ON (tss.team_id)
        tss.team_id, tss.position, tss.points, tss.played, tss.won, tss.drawn, tss.lost,
        tss.goals_for, tss.goals_against, tss.xg, tss.xga,
        tss.home_played, tss.home_won, tss.home_drawn, tss.home_lost, tss.home_gf, tss.home_ga,
        tss.away_played, tss.away_won, tss.away_drawn, tss.away_lost, tss.away_gf, tss.away_ga,
        tss.form_string
       FROM team_season_stats tss
       ${seasonWhere}
       ORDER BY tss.team_id, tss.season_id DESC, tss.updated_at DESC`,
      params
    );
    for (const row of seasonRes.rows) {
      seasonStatsByTeam.set(row.team_id, row);
    }
  } catch {
    // La tabla team_season_stats puede no existir antes de ejecutar la migración 0003
  }

  // Calcular Elo dinámico cronológico real desde resultados históricos
  const chronoEloByTeam = new Map<string, number>();
  const lastMatchMsByTeam = new Map<string, number>();
  try {
    const chronoMatches = await loadChronologicalMatches({
      leagueFilter: (leagueId as LeagueFilter) || 'all',
    });
    const chronoState = createChronoState();
    for (const cm of chronoMatches) {
      updateChronoStateWithMatch(chronoState, cm);
      lastMatchMsByTeam.set(cm.homeTeamId, cm.kickoffMs);
      lastMatchMsByTeam.set(cm.awayTeamId, cm.kickoffMs);
    }
    for (const [tid, elo] of chronoState.eloByTeam.entries()) {
      chronoEloByTeam.set(tid, Math.round(elo));
    }
  } catch {
    // Fallback al rating almacenado en teams si aún no hay histórico suficiente
  }

  const nowMs = Date.now();
  const profiles: TeamStatisticalProfile[] = teamsRes.rows.map((team, idx) => {
    const rows = byTeam.get(team.id) ?? [];
    const finished = rows.filter((r) => r.home_goals !== null && r.away_goals !== null);
    const seasonStat = seasonStatsByTeam.get(team.id);

    let won = 0;
    let drawn = 0;
    let lost = 0;
    let gf = 0;
    let ga = 0;
    let cleanSheets = 0;
    let bttsCount = 0;
    let o15 = 0;
    let o25 = 0;
    let o35 = 0;
    let o45 = 0;

    let homeP = 0, homeW = 0, homeD = 0, homeL = 0, homeGF = 0, homeGA = 0;
    let awayP = 0, awayW = 0, awayD = 0, awayL = 0, awayGF = 0, awayGA = 0;

    let xgSum = 0, xgCount = 0, xgaSum = 0, xgaCount = 0;
    let shotsSum = 0, shotsCount = 0, sotSum = 0, sotCount = 0;
    let cornersSum = 0, cornersCount = 0, ycSum = 0, ycCount = 0, rcSum = 0, rcCount = 0;

    for (const r of finished) {
      const teamG = r.is_home ? r.home_goals! : r.away_goals!;
      const oppG = r.is_home ? r.away_goals! : r.home_goals!;
      const tot = teamG + oppG;
      gf += teamG;
      ga += oppG;
      if (oppG === 0) cleanSheets += 1;
      if (teamG > 0 && oppG > 0) bttsCount += 1;
      if (tot > 1) o15 += 1;
      if (tot > 2) o25 += 1;
      if (tot > 3) o35 += 1;
      if (tot > 4) o45 += 1;

      if (teamG > oppG) won += 1;
      else if (teamG === oppG) drawn += 1;
      else lost += 1;

      if (r.is_home) {
        homeP += 1;
        homeGF += teamG;
        homeGA += oppG;
        if (teamG > oppG) homeW += 1;
        else if (teamG === oppG) homeD += 1;
        else homeL += 1;
      } else {
        awayP += 1;
        awayGF += teamG;
        awayGA += oppG;
        if (teamG > oppG) awayW += 1;
        else if (teamG === oppG) awayD += 1;
        else awayL += 1;
      }
    }

    for (const r of rows) {
      if (r.xg !== null) { xgSum += Number(r.xg); xgCount += 1; }
      if (r.xga !== null) { xgaSum += Number(r.xga); xgaCount += 1; }
      if (r.shots !== null) { shotsSum += r.shots; shotsCount += 1; }
      if (r.shots_on_target !== null) { sotSum += r.shots_on_target; sotCount += 1; }
      if (r.corners !== null) { cornersSum += r.corners; cornersCount += 1; }
      if (r.yellow_cards !== null) { ycSum += r.yellow_cards; ycCount += 1; }
      if (r.red_cards !== null) { rcSum += r.red_cards; rcCount += 1; }
    }

    const useSeasonStandings = Boolean(
      seasonStat && seasonStat.played > 0 && seasonStat.played >= finished.length
    );

    const played = useSeasonStandings ? seasonStat!.played : finished.length;
    const finalWon = useSeasonStandings ? seasonStat!.won : won;
    const finalDrawn = useSeasonStandings ? seasonStat!.drawn : drawn;
    const finalLost = useSeasonStandings ? seasonStat!.lost : lost;
    const finalGf = useSeasonStandings ? seasonStat!.goals_for : gf;
    const finalGa = useSeasonStandings ? seasonStat!.goals_against : ga;
    const points =
      useSeasonStandings && seasonStat!.points !== null
        ? seasonStat!.points
        : finalWon * 3 + finalDrawn;

    if (useSeasonStandings && seasonStat!.home_played !== null) {
      homeP = seasonStat!.home_played;
      homeW = seasonStat!.home_won ?? 0;
      homeD = seasonStat!.home_drawn ?? 0;
      homeL = seasonStat!.home_lost ?? 0;
      homeGF = seasonStat!.home_gf ?? 0;
      homeGA = seasonStat!.home_ga ?? 0;
    }
    if (useSeasonStandings && seasonStat!.away_played !== null) {
      awayP = seasonStat!.away_played;
      awayW = seasonStat!.away_won ?? 0;
      awayD = seasonStat!.away_drawn ?? 0;
      awayL = seasonStat!.away_lost ?? 0;
      awayGF = seasonStat!.away_gf ?? 0;
      awayGA = seasonStat!.away_ga ?? 0;
    }

    const finishedCount = finished.length;
    const last5Rows = finished.slice(0, 5);
    let l5 = last5Rows.reduce(
      (acc, r) => {
        const tg = r.is_home ? r.home_goals! : r.away_goals!;
        const og = r.is_home ? r.away_goals! : r.home_goals!;
        acc.matches += 1;
        acc.goalsFor += tg;
        acc.goalsAgainst += og;
        if (tg > og) { acc.wins += 1; acc.points += 3; }
        else if (tg === og) { acc.draws += 1; acc.points += 1; }
        else { acc.losses += 1; }
        return acc;
      },
      { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }
    );

    if (l5.matches === 0 && seasonStat?.form_string) {
      const tokens = seasonStat.form_string
        .replace(/,/g, '')
        .trim()
        .toUpperCase()
        .slice(-5)
        .split('');
      for (const ch of tokens) {
        if (ch === 'W') { l5.matches += 1; l5.wins += 1; l5.points += 3; }
        else if (ch === 'D') { l5.matches += 1; l5.draws += 1; l5.points += 1; }
        else if (ch === 'L') { l5.matches += 1; l5.losses += 1; }
      }
    }

    const resolvedXg =
      xgCount > 0
        ? Number(xgSum.toFixed(2))
        : seasonStat?.xg !== null && seasonStat?.xg !== undefined
        ? Number(seasonStat.xg)
        : null;
    const resolvedXga =
      xgaCount > 0
        ? Number(xgaSum.toFixed(2))
        : seasonStat?.xga !== null && seasonStat?.xga !== undefined
        ? Number(seasonStat.xga)
        : null;

    const missingFields: string[] = [];
    if (resolvedXg === null) missingFields.push('xG / xGA');
    if (shotsCount === 0) missingFields.push('Tiros totales / a puerta');
    if (cornersCount === 0) missingFields.push('Córners promedio');
    if (ycCount === 0) missingFields.push('Tarjetas promedio');
    if (played < 10) missingFields.push('Histórico mínimo (10+ partidos)');

    return {
      id: team.id,
      leagueId: team.league_id,
      name: team.name,
      shortName: team.short_name,
      position: seasonStat?.position ?? idx + 1,
      points,
      played,
      won: finalWon,
      drawn: finalDrawn,
      lost: finalLost,
      goalsFor: finalGf,
      goalsAgainst: finalGa,
      avgGoalsFor: played > 0 ? Number((finalGf / played).toFixed(2)) : 0,
      avgGoalsAgainst: played > 0 ? Number((finalGa / played).toFixed(2)) : 0,
      xg: resolvedXg,
      xga: resolvedXga,
      totalShots: shotsCount > 0 ? shotsSum : null,
      shotsOnTarget: sotCount > 0 ? sotSum : null,
      offensiveEfficiency:
        sotCount > 0 && sotSum > 0 ? Number(((finalGf / sotSum) * 100).toFixed(1)) : null,
      defensiveEfficiency: null,
      cleanSheets,
      bttsRate: finishedCount > 0 ? Number((bttsCount / finishedCount).toFixed(2)) : 0,
      over15Rate: finishedCount > 0 ? Number((o15 / finishedCount).toFixed(2)) : 0,
      over25Rate: finishedCount > 0 ? Number((o25 / finishedCount).toFixed(2)) : 0,
      over35Rate: finishedCount > 0 ? Number((o35 / finishedCount).toFixed(2)) : 0,
      over45Rate: finishedCount > 0 ? Number((o45 / finishedCount).toFixed(2)) : 0,
      cornersForAvg: cornersCount > 0 ? Number((cornersSum / cornersCount).toFixed(2)) : null,
      cornersAgainstAvg: null,
      yellowCardsAvg: ycCount > 0 ? Number((ycSum / ycCount).toFixed(2)) : null,
      redCardsTotal: rcCount > 0 ? rcSum : null,
      homePerformance: {
        played: homeP,
        wins: homeW,
        draws: homeD,
        losses: homeL,
        goalsFor: homeGF,
        goalsAgainst: homeGA,
        xgFor: null,
        xgAgainst: null,
      },
      awayPerformance: {
        played: awayP,
        wins: awayW,
        draws: awayD,
        losses: awayL,
        goalsFor: awayGF,
        goalsAgainst: awayGA,
        xgFor: null,
        xgAgainst: null,
      },
      last5: l5,
      last10: null,
      last15: null,
      vsSimilarLevelPPG: null,
      restDays: (() => {
        const lastMs = lastMatchMsByTeam.get(team.id);
        if (!lastMs) return null;
        const diffDays = Math.round((nowMs - lastMs) / 86_400_000);
        return diffDays >= 0 && diffDays <= 45 ? diffDays : null;
      })(),
      scheduleCongestion: null,
      absences: null,
      probableLineup: null,
      recentCoachChange: false,
      recentTrend: l5.points >= 10 ? 'ascendente' : l5.points <= 4 && l5.matches >= 3 ? 'descendente' : 'estable',
      eloRating: chronoEloByTeam.get(team.id) ?? Number(team.elo_rating),
      missingFields,
    };
  });

  return profiles.sort((a, b) => {
    if (a.leagueId !== b.leagueId) return a.leagueId.localeCompare(b.leagueId);
    if (a.points !== b.points) return b.points - a.points;
    if (a.position !== b.position) return a.position - b.position;
    return b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst);
  });
}

export async function getMatchesFromDb(filters?: {
  leagueId?: string;
  date?: string;
  status?: string;
}): Promise<MatchRecord[]> {
  const pool = requirePool();
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (filters?.leagueId && filters.leagueId !== 'all') {
    params.push(filters.leagueId);
    clauses.push(`m.league_id = $${params.length}`);
  }
  if (filters?.date && filters.date !== 'all') {
    params.push(filters.date);
    clauses.push(`TO_CHAR(m.kickoff_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $${params.length}`);
  }
  if (filters?.status && filters.status !== 'all') {
    params.push(filters.status);
    clauses.push(`m.status = $${params.length}`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const res = await pool.query<{
    id: string;
    league_id: LeagueId;
    kickoff_utc: Date;
    matchday: number;
    home_team_id: string;
    away_team_id: string;
    home_team_name: string;
    away_team_name: string;
    status: string;
    source_type: string;
    expected_lambda_home: string | null;
    expected_lambda_away: string | null;
    data_completeness: number;
    missing_data_notes: unknown;
    home_goals: number | null;
    away_goals: number | null;
  }>(
    `SELECT
      m.id,
      m.league_id,
      m.kickoff_utc,
      m.matchday,
      m.home_team_id,
      m.away_team_id,
      ht.name AS home_team_name,
      at.name AS away_team_name,
      m.status,
      m.source_type,
      m.expected_lambda_home,
      m.expected_lambda_away,
      m.data_completeness,
      m.missing_data_notes,
      mr.home_goals,
      mr.away_goals
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    LEFT JOIN match_results mr ON mr.match_id = m.id
    ${whereSql}
    ORDER BY
      CASE WHEN m.status IN ('live', 'scheduled') THEN 0 ELSE 1 END ASC,
      CASE WHEN m.status IN ('live', 'scheduled') THEN m.kickoff_utc END ASC,
      m.kickoff_utc DESC
    LIMIT 450`,
    params
  );

  const matchIds = res.rows.map((r) => r.id);
  const oddsMap = new Map<
    string,
    {
      home?: number;
      draw?: number;
      away?: number;
      over25?: number;
      under25?: number;
      bookmaker: string;
      capturedAt?: string;
    }
  >();

  if (matchIds.length > 0) {
    const oddsRes = await pool.query<{
      match_id: string;
      bookmaker: string;
      market: string;
      selection: string;
      decimal_odds: string;
      captured_at: Date;
    }>(
      `SELECT match_id, bookmaker, market, selection, decimal_odds, captured_at
       FROM odds_snapshots
       WHERE match_id = ANY($1::text[])
       ORDER BY captured_at DESC`,
      [matchIds]
    );

    for (const o of oddsRes.rows) {
      const entry = oddsMap.get(o.match_id) ?? {
        bookmaker: o.bookmaker,
        capturedAt: new Date(o.captured_at).toISOString(),
      };
      const val = Number(o.decimal_odds);
      if (o.market === '1X2') {
        if (o.selection === '1' && entry.home === undefined) entry.home = val;
        if (o.selection === 'X' && entry.draw === undefined) entry.draw = val;
        if (o.selection === '2' && entry.away === undefined) entry.away = val;
      } else if (o.market === 'OU25') {
        if (o.selection === 'Over 2.5' && entry.over25 === undefined) entry.over25 = val;
        if (o.selection === 'Under 2.5' && entry.under25 === undefined) entry.under25 = val;
      }
      oddsMap.set(o.match_id, entry);
    }
  }

  // Cargar modelo activo entrenado + historial cronológico para inferencia estrictamente pre-partido (zero leakage)
  const [activeModel, chronoMatches] = await Promise.all([
    getActiveTrainedModelFromDb(),
    loadChronologicalMatches().catch(() => []),
  ]);

  const defaultWeights: EnsembleWeights = activeModel?.weights ?? {
    poisson: 0.28,
    elo: 0.24,
    machineLearning: 0.24,
    recentForm: 0.12,
    homeAway: 0.12,
  };

  // Ordenar filas cronológicamente en un paso auxiliar para avanzar ChronoState sin data leakage
  const rowsChrono = [...res.rows].sort(
    (a, b) => new Date(a.kickoff_utc).getTime() - new Date(b.kickoff_utc).getTime()
  );
  const inferenceById = new Map<
    string,
    {
      inf: ReturnType<typeof runMatchInference>;
      h2h: { matches: number; homeWins: number; draws: number; awayWins: number; avgGoals: number } | null;
    }
  >();

  const chronoState = createChronoState();
  let ptr = 0;
  for (const row of rowsChrono) {
    const rowMs = new Date(row.kickoff_utc).getTime();
    while (ptr < chronoMatches.length && chronoMatches[ptr].kickoffMs < rowMs) {
      updateChronoStateWithMatch(chronoState, chronoMatches[ptr]);
      ptr += 1;
    }

    const odds = oddsMap.get(row.id);
    const hasOdds = Boolean(odds?.home && odds?.draw && odds?.away);
    const inf = runMatchInference({
      state: chronoState,
      leagueId: row.league_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      kickoffMs: rowMs,
      hasOdds,
      weights: defaultWeights,
      rho: activeModel?.rho,
      mlModel: activeModel?.mlModel,
      calibrator: activeModel?.calibrator,
    });

    // H2H estrictamente previo al kickoff
    const h2hMatches = chronoMatches
      .slice(0, ptr)
      .filter(
        (cm) =>
          (cm.homeTeamId === row.home_team_id && cm.awayTeamId === row.away_team_id) ||
          (cm.homeTeamId === row.away_team_id && cm.awayTeamId === row.home_team_id)
      )
      .slice(-8);

    let h2h: { matches: number; homeWins: number; draws: number; awayWins: number; avgGoals: number } | null = null;
    if (h2hMatches.length > 0) {
      let hw = 0;
      let dr = 0;
      let aw = 0;
      let goals = 0;
      for (const hm of h2hMatches) {
        goals += hm.homeGoals + hm.awayGoals;
        if (hm.homeGoals === hm.awayGoals) dr += 1;
        else if (
          (hm.homeTeamId === row.home_team_id && hm.homeGoals > hm.awayGoals) ||
          (hm.awayTeamId === row.home_team_id && hm.awayGoals > hm.homeGoals)
        ) {
          hw += 1;
        } else {
          aw += 1;
        }
      }
      h2h = {
        matches: h2hMatches.length,
        homeWins: hw,
        draws: dr,
        awayWins: aw,
        avgGoals: Number((goals / h2hMatches.length).toFixed(2)),
      };
    }

    inferenceById.set(row.id, { inf, h2h });
  }

  return res.rows.map((row) => {
    const iso = new Date(row.kickoff_utc).toISOString();
    const datePart = iso.slice(0, 10);
    const timePart = iso.slice(11, 16);

    const computed = inferenceById.get(row.id)!;
    const inf = computed.inf;
    const odds = oddsMap.get(row.id);
    const has1X2 = Boolean(odds?.home && odds?.draw && odds?.away);
    const deVigged = has1X2
      ? removeBookmakerMargin([odds!.home!, odds!.draw!, odds!.away!]).fairProbs
      : null;

    const missingNotes = Array.isArray(row.missing_data_notes)
      ? (row.missing_data_notes as string[])
      : [];

    const completeness = Math.min(
      85,
      Math.max(row.data_completeness, inf.suggestedCompletenessBoost)
    );
    const confidenceTier: ConfidenceTier =
      row.data_completeness < 40 ? 'DESCARTADO' : inf.suggestedTier;

    const confidenceReasons: string[] = [];
    if (inf.smallSampleWarning) {
      confidenceReasons.push(inf.smallSampleWarning);
    } else {
      confidenceReasons.push(
        `Histórico pre-partido verificado (${inf.homePlayed} vs ${inf.awayPlayed} partidos) con Elo ${inf.homeElo} vs ${inf.awayElo}.`
      );
    }
    if (activeModel) {
      confidenceReasons.push(
        `Motor ${activeModel.name} (ρ=${inf.dixonColesRho}, ML n=${activeModel.mlModel.trainedSamples}, cal=${activeModel.calibrationMethod}).`
      );
    } else {
      confidenceReasons.push(
        'Ejecutando Poisson + Dixon-Coles + Elo + Estadísticas pre-partido (ejecuta Backtest Walk-Forward para calibrar ML/Platt).'
      );
    }
    if (!has1X2) {
      confidenceReasons.push('Sin cuotas 1X2 vigentes vinculadas para este encuentro.');
    }

    return {
      id: row.id,
      leagueId: row.league_id,
      date: datePart,
      kickoffTime: timePart,
      kickoffUtc: iso,
      matchday: row.matchday,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeTeamName: row.home_team_name,
      awayTeamName: row.away_team_name,
      isSynthetic: false,
      dataCompleteness: completeness,
      missingDataNotes: missingNotes,
      h2hSummary: computed.h2h,
      expectedLambdaHome: inf.lambdaHome,
      expectedLambdaAway: inf.lambdaAway,
      dixonColesRho: inf.dixonColesRho,
      homeElo: inf.homeElo,
      awayElo: inf.awayElo,
      confidenceInterval90: inf.confidenceInterval90,
      keyFactors: inf.keyFactors,
      smallSampleWarning: inf.smallSampleWarning,
      oddsCapturedAt: odds?.capturedAt ?? null,
      odds1X2: has1X2
        ? {
            home: odds!.home!,
            draw: odds!.draw!,
            away: odds!.away!,
            bookmaker: odds!.bookmaker,
          }
        : null,
      extraOdds:
        odds?.over25 || odds?.under25
          ? { over25: odds.over25, under25: odds.under25 }
          : null,
      models: {
        poisson: inf.poisson,
        dixonColes: inf.dixonColes,
        elo: inf.elo,
        machineLearning: inf.machineLearning,
        recentForm: inf.statsOffDef,
        homeAway: inf.statsOffDef,
        marketDeVigged: deVigged
          ? { home: deVigged[0], draw: deVigged[1], away: deVigged[2] }
          : null,
        ensemble: inf.ensemble,
        modelSpread: inf.modelSpread,
      },
      confidenceTier,
      confidenceReasons,
      ...(row.home_goals !== null && row.away_goals !== null
        ? { actualScore: `${row.home_goals}-${row.away_goals}`, matchStatus: row.status }
        : { matchStatus: row.status }),
    };
  });
}

export interface CsvImportRowInput {
  leagueId: LeagueId;
  seasonId?: string;
  date: string;
  kickoffTime: string;
  matchday?: number;
  homeTeamName: string;
  awayTeamName: string;
  lambdaHome?: number | null;
  lambdaAway?: number | null;
  oddsHome?: number | null;
  oddsDraw?: number | null;
  oddsAway?: number | null;
  bookmaker?: string;
  homeGoals?: number | null;
  awayGoals?: number | null;
  homeShots?: number | null;
  awayShots?: number | null;
  homeShotsOnTarget?: number | null;
  awayShotsOnTarget?: number | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeYellowCards?: number | null;
  awayYellowCards?: number | null;
  homeXg?: number | null;
  awayXg?: number | null;
}

export async function persistCsvBatchToDb(params: {
  filename: string;
  rows: CsvImportRowInput[];
}) {
  const pool = requirePool();
  const client = await pool.connect();

  let inserted = 0;
  let skippedDuplicate = 0;
  const batchId = `imp_${Date.now()}`;

  try {
    await client.query('BEGIN');

    for (const row of params.rows) {
      const seasonId = row.seasonId ?? '2026-2027';
      const homeTeamId = slugifyTeamId(row.leagueId, row.homeTeamName);
      const awayTeamId = slugifyTeamId(row.leagueId, row.awayTeamName);

      if (homeTeamId === awayTeamId) {
        continue;
      }

      const shortHome = row.homeTeamName.slice(0, 3).toUpperCase();
      const shortAway = row.awayTeamName.slice(0, 3).toUpperCase();

      await client.query(
        `INSERT INTO teams (id, league_id, name, short_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (league_id, name) DO NOTHING`,
        [homeTeamId, row.leagueId, row.homeTeamName, shortHome]
      );

      await client.query(
        `INSERT INTO teams (id, league_id, name, short_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (league_id, name) DO NOTHING`,
        [awayTeamId, row.leagueId, row.awayTeamName, shortAway]
      );

      const kickoffIso = `${row.date}T${row.kickoffTime.length === 5 ? row.kickoffTime : '20:00'}:00Z`;
      const matchId = `m_${row.leagueId}_${row.date}_${homeTeamId}_${awayTeamId}`.slice(0, 120);

      const hasLambdas = Boolean(row.lambdaHome && row.lambdaAway);
      const hasOdds = Boolean(row.oddsHome && row.oddsDraw && row.oddsAway);
      const hasStats = Boolean(row.homeShots !== undefined || row.homeXg !== undefined);
      const completeness = Math.min(
        100,
        25 + (hasLambdas ? 25 : 0) + (hasOdds ? 20 : 0) + (hasStats ? 20 : 0)
      );

      const missingNotes: string[] = [];
      if (!hasLambdas) missingNotes.push('Sin xG/lambdas explícitos en CSV (tasa base neutra).');
      if (!hasOdds) missingNotes.push('Sin cuotas 1X2 en CSV.');
      missingNotes.push('Alineaciones e historial completo pendientes de Fase 4.');

      const hasResult =
        row.homeGoals !== undefined &&
        row.homeGoals !== null &&
        row.awayGoals !== undefined &&
        row.awayGoals !== null;

      const matchInsert = await client.query<{ id: string }>(
        `INSERT INTO matches (
          id, league_id, season_id, matchday, kickoff_utc,
          home_team_id, away_team_id, status, source_type,
          expected_lambda_home, expected_lambda_away, data_completeness, missing_data_notes
        )
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, 'csv', $9, $10, $11, $12::jsonb)
        ON CONFLICT ON CONSTRAINT uq_match_fixture DO NOTHING
        RETURNING id`,
        [
          matchId,
          row.leagueId,
          seasonId,
          row.matchday ?? 0,
          kickoffIso,
          homeTeamId,
          awayTeamId,
          hasResult ? 'finished' : 'scheduled',
          row.lambdaHome ?? null,
          row.lambdaAway ?? null,
          completeness,
          JSON.stringify(missingNotes),
        ]
      );

      if (matchInsert.rowCount === 0) {
        skippedDuplicate += 1;
        continue;
      }

      const createdMatchId = matchInsert.rows[0].id;
      inserted += 1;

      if (hasResult) {
        await client.query(
          `INSERT INTO match_results (match_id, home_goals, away_goals)
           VALUES ($1, $2, $3)
           ON CONFLICT (match_id) DO NOTHING`,
          [createdMatchId, row.homeGoals, row.awayGoals]
        );
      }

      if (hasOdds) {
        const bm = row.bookmaker || 'CSV_Import';
        await client.query(
          `INSERT INTO odds_snapshots (match_id, bookmaker, market, selection, decimal_odds)
           VALUES
             ($1, $2, '1X2', '1', $3),
             ($1, $2, '1X2', 'X', $4),
             ($1, $2, '1X2', '2', $5)`,
          [createdMatchId, bm, row.oddsHome, row.oddsDraw, row.oddsAway]
        );
      }

      if (
        row.homeShots != null ||
        row.homeCorners != null ||
        row.homeYellowCards != null ||
        row.homeXg != null
      ) {
        await client.query(
          `INSERT INTO team_match_stats (
            match_id, team_id, is_home, xg, xga, shots, shots_on_target, corners, yellow_cards
          ) VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (match_id, team_id) DO NOTHING`,
          [
            createdMatchId,
            homeTeamId,
            row.homeXg ?? null,
            row.awayXg ?? null,
            row.homeShots ?? null,
            row.homeShotsOnTarget ?? null,
            row.homeCorners ?? null,
            row.homeYellowCards ?? null,
          ]
        );

        await client.query(
          `INSERT INTO team_match_stats (
            match_id, team_id, is_home, xg, xga, shots, shots_on_target, corners, yellow_cards
          ) VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (match_id, team_id) DO NOTHING`,
          [
            createdMatchId,
            awayTeamId,
            row.awayXg ?? null,
            row.homeXg ?? null,
            row.awayShots ?? null,
            row.awayShotsOnTarget ?? null,
            row.awayCorners ?? null,
            row.awayYellowCards ?? null,
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO import_batches (
        id, source_type, filename, rows_total, rows_inserted, rows_skipped_duplicate, rows_invalid
      ) VALUES ($1, 'csv', $2, $3, $4, $5, 0)`,
      [batchId, params.filename, params.rows.length, inserted, skippedDuplicate]
    );

    await client.query('COMMIT');
    return { batchId, inserted, skippedDuplicate };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createPredictionSnapshotInDb(input: {
  matchId: string;
  modelVersionId?: string;
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
  bookmaker?: string | null;
  fairOdds?: number | null;
}) {
  const pool = requirePool();

  const matchCheck = await pool.query<{ kickoff_utc: Date; status: string }>(
    'SELECT kickoff_utc, status FROM matches WHERE id = $1',
    [input.matchId]
  );
  if (matchCheck.rowCount === 0) {
    const err = new Error('Partido no encontrado en PostgreSQL.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  const m = matchCheck.rows[0];
  if (m.status === 'finished' || new Date(m.kickoff_utc).getTime() <= Date.now()) {
    const err = new Error(
      'Registro bloqueado: el partido ya comenzó o finalizó. Las predicciones deben guardarse antes del inicio.'
    );
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const modelVersionId = input.modelVersionId ?? 'ensemble-v1-phase3';
  const fairOdds =
    input.fairOdds ?? Number((1 / Math.max(0.01, Math.min(0.99, input.predictedProb))).toFixed(4));

  let res: { rows: { id: string; created_at: Date }[] };
  try {
    res = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO predictions (
        id, match_id, model_version_id, data_completeness_score, confidence_tier,
        expected_score, model_outputs, markets, score_matrix,
        selected_market, selected_selection, predicted_prob, odds_at_prediction,
        bookmaker, fair_odds, source_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, 'db')
      RETURNING id, created_at`,
      [
        id,
        input.matchId,
        modelVersionId,
        input.dataCompletenessScore,
        input.confidenceTier,
        input.expectedScore,
        JSON.stringify(input.modelOutputs),
        JSON.stringify(input.markets),
        JSON.stringify(input.scoreMatrix ?? []),
        input.selectedMarket,
        input.selectedSelection,
        input.predictedProb,
        input.oddsAtPrediction,
        input.bookmaker ?? null,
        fairOdds,
      ]
    );
  } catch {
    res = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO predictions (
        id, match_id, model_version_id, data_completeness_score, confidence_tier,
        expected_score, model_outputs, markets, score_matrix,
        selected_market, selected_selection, predicted_prob, odds_at_prediction, source_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13, 'db')
      RETURNING id, created_at`,
      [
        id,
        input.matchId,
        modelVersionId,
        input.dataCompletenessScore,
        input.confidenceTier,
        input.expectedScore,
        JSON.stringify(input.modelOutputs),
        JSON.stringify(input.markets),
        JSON.stringify(input.scoreMatrix ?? []),
        input.selectedMarket,
        input.selectedSelection,
        input.predictedProb,
        input.oddsAtPrediction,
      ]
    );
  }

  return {
    id: res.rows[0].id,
    createdAt: new Date(res.rows[0].created_at).toISOString(),
  };
}

export async function getPredictionHistoryFromDb(leagueId?: string): Promise<PredictionHistoryItem[]> {
  const pool = requirePool();
  const params: unknown[] = [];
  let whereSql = '';
  if (leagueId && leagueId !== 'all') {
    params.push(leagueId);
    whereSql = 'WHERE m.league_id = $1';
  }

  const res = await pool.query<{
    id: string;
    created_at: Date;
    kickoff_utc: Date;
    league_id: LeagueId;
    home_name: string;
    away_name: string;
    selected_market: string;
    selected_selection: string;
    predicted_prob: string;
    odds_at_prediction: string;
    expected_score: string;
    model_version_id: string;
    confidence_tier: ConfidenceTier;
    actual_outcome: number | null;
    actual_result: string | null;
    brier_score: string | null;
    log_loss: string | null;
    simulated_roi: string | null;
  }>(
    `SELECT
      p.id,
      p.created_at,
      m.kickoff_utc,
      m.league_id,
      ht.name AS home_name,
      at.name AS away_name,
      p.selected_market,
      p.selected_selection,
      p.predicted_prob,
      p.odds_at_prediction,
      p.expected_score,
      p.model_version_id,
      p.confidence_tier,
      po.actual_outcome,
      po.actual_result,
      po.brier_score,
      po.log_loss,
      po.simulated_roi
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    LEFT JOIN prediction_outcomes po ON po.prediction_id = p.id
    ${whereSql}
    ORDER BY p.created_at DESC
    LIMIT 200`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    recordedAtUtc: new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    kickoffUtc: new Date(r.kickoff_utc).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    leagueId: r.league_id,
    matchLabel: `${r.home_name} vs ${r.away_name}`,
    market: r.selected_market,
    selection: r.selected_selection,
    predictedProb: Number(r.predicted_prob),
    oddsAtPrediction: Number(r.odds_at_prediction),
    expectedScore: r.expected_score,
    modelVersion: r.model_version_id,
    confidenceTier: r.confidence_tier,
    status:
      r.actual_outcome === null
        ? 'pendiente'
        : r.actual_outcome === 1
        ? 'acertada'
        : 'fallada',
    actualResult: r.actual_result,
    brierScore: r.brier_score !== null ? Number(r.brier_score) : null,
    logLoss: r.log_loss !== null ? Number(r.log_loss) : null,
    simulatedRoiUnit: r.simulated_roi !== null ? Number(r.simulated_roi) : null,
    isSynthetic: false,
  }));
}

export async function updateMatchResultInDb(
  matchId: string,
  input: { homeGoals: number; awayGoals: number; htHomeGoals?: number; htAwayGoals?: number }
) {
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO match_results (match_id, home_goals, away_goals, ht_home_goals, ht_away_goals)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (match_id) DO UPDATE SET
         home_goals = EXCLUDED.home_goals,
         away_goals = EXCLUDED.away_goals,
         ht_home_goals = EXCLUDED.ht_home_goals,
         ht_away_goals = EXCLUDED.ht_away_goals,
         settled_at = NOW()`,
      [
        matchId,
        input.homeGoals,
        input.awayGoals,
        input.htHomeGoals ?? null,
        input.htAwayGoals ?? null,
      ]
    );
    await client.query(
      `UPDATE matches SET status = 'finished', updated_at = NOW() WHERE id = $1`,
      [matchId]
    );
    await client.query('COMMIT');
    // Liquidar automáticamente predicciones y oportunidades de valor vinculadas a este partido
    await import('../services/engine/monitoringService.ts')
      .then((mod) => mod.autoSettleAllPendingInDb())
      .catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function settlePredictionInDb(
  predictionId: string,
  input: { actualOutcome: 0 | 1; actualResult: string }
) {
  const pool = requirePool();
  const predRes = await pool.query<{
    selected_market: string;
    selected_selection: string;
    predicted_prob: string;
    odds_at_prediction: string;
  }>(
    'SELECT selected_market, selected_selection, predicted_prob, odds_at_prediction FROM predictions WHERE id = $1',
    [predictionId]
  );

  if (predRes.rowCount === 0) {
    const err = new Error('Predicción no encontrada.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const pred = predRes.rows[0];
  const prob = Number(pred.predicted_prob);
  const odds = Number(pred.odds_at_prediction);
  const brier = computeBrierScoreBinary(prob, input.actualOutcome);
  const logLoss = computeLogLossBinary(prob, input.actualOutcome);
  const roi = input.actualOutcome === 1 ? odds - 1 : -1;

  await pool.query(
    `INSERT INTO prediction_outcomes (
      prediction_id, market, selection, predicted_prob, odds_used,
      actual_outcome, actual_result, brier_score, log_loss, simulated_roi
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (prediction_id, market, selection) DO UPDATE SET
      actual_outcome = EXCLUDED.actual_outcome,
      actual_result = EXCLUDED.actual_result,
      brier_score = EXCLUDED.brier_score,
      log_loss = EXCLUDED.log_loss,
      simulated_roi = EXCLUDED.simulated_roi,
      evaluated_at = NOW()`,
    [
      predictionId,
      pred.selected_market,
      pred.selected_selection,
      prob,
      odds,
      input.actualOutcome,
      input.actualResult,
      brier,
      logLoss,
      roi,
    ]
  );

  return {
    brierScore: Number(brier.toFixed(4)),
    logLoss: Number(logLoss.toFixed(4)),
    simulatedRoiUnit: Number(roi.toFixed(2)),
  };
}

export async function getPerformanceMetricsFromDb(leagueId?: string): Promise<{
  calibrationBins: CalibrationBin[];
  trendSeries: { label: string; brier: number; logLoss: number; roiPct: number }[];
}> {
  const pool = requirePool();
  const params: unknown[] = [];
  let whereSql = '';
  if (leagueId && leagueId !== 'all') {
    params.push(leagueId);
    whereSql = 'WHERE m.league_id = $1';
  }

  const res = await pool.query<{
    predicted_prob: string;
    actual_outcome: number;
    brier_score: string;
    log_loss: string;
    simulated_roi: string;
    evaluated_at: Date;
  }>(
    `SELECT
      po.predicted_prob,
      po.actual_outcome,
      po.brier_score,
      po.log_loss,
      po.simulated_roi,
      po.evaluated_at
    FROM prediction_outcomes po
    JOIN predictions p ON p.id = po.prediction_id
    JOIN matches m ON m.id = p.match_id
    ${whereSql}
    ORDER BY po.evaluated_at ASC`,
    params
  );

  const buckets = [
    { label: '0-25%', min: 0, max: 0.25 },
    { label: '25-45%', min: 0.25, max: 0.45 },
    { label: '45-65%', min: 0.45, max: 0.65 },
    { label: '65-85%', min: 0.65, max: 0.85 },
    { label: '85-100%', min: 0.85, max: 1.01 },
  ];

  const calibrationBins: CalibrationBin[] = [];
  for (const b of buckets) {
    const items = res.rows.filter((r) => {
      const p = Number(r.predicted_prob);
      return p >= b.min && p < b.max;
    });
    if (items.length > 0) {
      const meanPred = items.reduce((s, i) => s + Number(i.predicted_prob), 0) / items.length;
      const obsFreq = items.reduce((s, i) => s + i.actual_outcome, 0) / items.length;
      calibrationBins.push({
        binLabel: b.label,
        meanPredicted: Number(meanPred.toFixed(3)),
        observedFrequency: Number(obsFreq.toFixed(3)),
        sampleCount: items.length,
      });
    }
  }

  // Agrupación semanal simple por fecha ISO de evaluación
  const weeklyMap = new Map<string, typeof res.rows>();
  for (const row of res.rows) {
    const weekKey = new Date(row.evaluated_at).toISOString().slice(0, 10);
    const arr = weeklyMap.get(weekKey) ?? [];
    arr.push(row);
    weeklyMap.set(weekKey, arr);
  }

  const trendSeries = Array.from(weeklyMap.entries()).map(([label, rows]) => {
    const brier = rows.reduce((s, r) => s + Number(r.brier_score), 0) / rows.length;
    const logLoss = rows.reduce((s, r) => s + Number(r.log_loss), 0) / rows.length;
    const roiPct =
      (rows.reduce((s, r) => s + Number(r.simulated_roi), 0) / rows.length) * 100;
    return {
      label: label.slice(5),
      brier: Number(brier.toFixed(4)),
      logLoss: Number(logLoss.toFixed(4)),
      roiPct: Number(roiPct.toFixed(1)),
    };
  });

  return { calibrationBins, trendSeries };
}

export async function getActiveModelConfigFromDb(): Promise<{
  id: string;
  weights: EnsembleWeights;
  thresholds: QualityFilterThresholds;
} | null> {
  const pool = requirePool();
  const res = await pool.query<{
    id: string;
    weights: EnsembleWeights;
    thresholds: QualityFilterThresholds;
  }>(
    'SELECT id, weights, thresholds FROM model_versions WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1'
  );
  return res.rows[0] ?? null;
}

export async function updateActiveModelConfigInDb(input: {
  weights: EnsembleWeights;
  thresholds: QualityFilterThresholds;
}) {
  const pool = requirePool();
  await pool.query(
    `UPDATE model_versions
     SET weights = $1::jsonb, thresholds = $2::jsonb
     WHERE is_active = TRUE`,
    [JSON.stringify(input.weights), JSON.stringify(input.thresholds)]
  );
}

export async function saveDetectedValueOpportunity(input: {
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
}) {
  const pool = requirePool();
  const matchCheck = await pool.query<{ kickoff_utc: Date; status: string }>(
    'SELECT kickoff_utc, status FROM matches WHERE id = $1',
    [input.matchId]
  );
  if (matchCheck.rowCount === 0) {
    const err = new Error('Partido no encontrado en PostgreSQL.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  const m = matchCheck.rows[0];
  if (m.status === 'finished' || new Date(m.kickoff_utc).getTime() <= Date.now()) {
    const err = new Error('Cuota caducada: el partido ya comenzó o finalizó.');
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const id = `vopp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let res: { rows: { id: string }[] };
  try {
    res = await pool.query<{ id: string }>(
      `INSERT INTO value_opportunities_log (
        id, match_id, model_version_id, market, selection, bookmaker,
        model_prob, decimal_odds, opening_odds, implied_prob_raw, implied_prob_devig,
        fair_odds, edge_pp, expected_value, confidence_tier, odds_captured_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, NOW()))
      ON CONFLICT ON CONSTRAINT uq_value_opp_match_sel DO UPDATE SET
        model_version_id = EXCLUDED.model_version_id,
        model_prob = EXCLUDED.model_prob,
        decimal_odds = EXCLUDED.decimal_odds,
        opening_odds = COALESCE(value_opportunities_log.opening_odds, EXCLUDED.opening_odds),
        implied_prob_raw = EXCLUDED.implied_prob_raw,
        implied_prob_devig = EXCLUDED.implied_prob_devig,
        fair_odds = EXCLUDED.fair_odds,
        edge_pp = EXCLUDED.edge_pp,
        expected_value = EXCLUDED.expected_value,
        confidence_tier = EXCLUDED.confidence_tier,
        odds_captured_at = EXCLUDED.odds_captured_at
      RETURNING id`,
      [
        id,
        input.matchId,
        input.modelVersionId ?? 'ensemble-v2-p5',
        input.market,
        input.selection,
        input.bookmaker,
        input.modelProb,
        input.decimalOdds,
        input.impliedProbRaw,
        input.impliedProbDevig,
        input.fairOdds,
        input.edgePp,
        input.expectedValue,
        input.confidenceTier,
        input.oddsCapturedAt ?? null,
      ]
    );
  } catch {
    res = await pool.query<{ id: string }>(
      `INSERT INTO value_opportunities_log (
        id, match_id, model_version_id, market, selection, bookmaker,
        model_prob, decimal_odds, implied_prob_raw, implied_prob_devig,
        fair_odds, edge_pp, expected_value, confidence_tier, odds_captured_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, NOW()))
      ON CONFLICT ON CONSTRAINT uq_value_opp_match_sel DO UPDATE SET
        model_version_id = EXCLUDED.model_version_id,
        model_prob = EXCLUDED.model_prob,
        decimal_odds = EXCLUDED.decimal_odds,
        implied_prob_raw = EXCLUDED.implied_prob_raw,
        implied_prob_devig = EXCLUDED.implied_prob_devig,
        fair_odds = EXCLUDED.fair_odds,
        edge_pp = EXCLUDED.edge_pp,
        expected_value = EXCLUDED.expected_value,
        confidence_tier = EXCLUDED.confidence_tier,
        odds_captured_at = EXCLUDED.odds_captured_at
      RETURNING id`,
      [
        id,
        input.matchId,
        input.modelVersionId ?? 'ensemble-v2-p5',
        input.market,
        input.selection,
        input.bookmaker,
        input.modelProb,
        input.decimalOdds,
        input.impliedProbRaw,
        input.impliedProbDevig,
        input.fairOdds,
        input.edgePp,
        input.expectedValue,
        input.confidenceTier,
        input.oddsCapturedAt ?? null,
      ]
    );
  }

  return { id: res.rows[0].id };
}

export async function getDetectedValueOpportunities(
  leagueId?: string
): Promise<DetectedValueOpportunityRecord[]> {
  const pool = requirePool();
  const params: unknown[] = [];
  let whereSql = '';
  if (leagueId && leagueId !== 'all') {
    params.push(leagueId);
    whereSql = 'WHERE m.league_id = $1';
  }

  try {
    const res = await pool.query<{
      id: string;
      match_id: string;
      home_name: string;
      away_name: string;
      league_id: LeagueId;
      kickoff_utc: Date;
      model_version_id: string;
      market: string;
      selection: string;
      bookmaker: string;
      model_prob: string;
      decimal_odds: string;
      opening_odds: string | null;
      closing_odds: string | null;
      clv_pct: string | null;
      implied_prob_raw: string;
      implied_prob_devig: string | null;
      fair_odds: string;
      edge_pp: string;
      expected_value: string;
      confidence_tier: ConfidenceTier;
      odds_captured_at: Date;
      status: 'pendiente' | 'ganada' | 'perdida' | 'anulada';
      actual_result: string | null;
      realized_roi_unit: string | null;
      created_at: Date;
      settled_at: Date | null;
    }>(
      `SELECT
        v.id, v.match_id, ht.name AS home_name, at.name AS away_name,
        m.league_id, m.kickoff_utc,
        v.model_version_id, v.market, v.selection, v.bookmaker,
        v.model_prob, v.decimal_odds, v.opening_odds, v.closing_odds, v.clv_pct,
        v.implied_prob_raw, v.implied_prob_devig,
        v.fair_odds, v.edge_pp, v.expected_value, v.confidence_tier,
        v.odds_captured_at, v.status, v.actual_result, v.realized_roi_unit,
        v.created_at, v.settled_at
       FROM value_opportunities_log v
       JOIN matches m ON m.id = v.match_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       ${whereSql}
       ORDER BY v.created_at DESC
       LIMIT 150`,
      params
    );

    return res.rows.map((r) => ({
      id: r.id,
      matchId: r.match_id,
      matchLabel: `${r.home_name} vs ${r.away_name}`,
      leagueId: r.league_id,
      kickoffUtc: new Date(r.kickoff_utc).toISOString(),
      modelVersionId: r.model_version_id,
      market: r.market,
      selection: r.selection,
      bookmaker: r.bookmaker,
      modelProb: Number(r.model_prob),
      decimalOdds: Number(r.decimal_odds),
      openingOdds: r.opening_odds !== null ? Number(r.opening_odds) : null,
      closingOdds: r.closing_odds !== null ? Number(r.closing_odds) : null,
      clvPct: r.clv_pct !== null ? Number(r.clv_pct) : null,
      impliedProbRaw: Number(r.implied_prob_raw),
      impliedProbDevig: r.implied_prob_devig !== null ? Number(r.implied_prob_devig) : null,
      fairOdds: Number(r.fair_odds),
      edgePp: Number(r.edge_pp),
      expectedValue: Number(r.expected_value),
      confidenceTier: r.confidence_tier,
      oddsCapturedAt: new Date(r.odds_captured_at).toISOString(),
      status: r.status,
      actualResult: r.actual_result,
      realizedRoiUnit: r.realized_roi_unit !== null ? Number(r.realized_roi_unit) : null,
      createdAt: new Date(r.created_at).toISOString(),
      settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
    }));
  } catch {
    return [];
  }
}

export async function settleDetectedValueOpportunities(): Promise<{ settledCount: number }> {
  const pool = requirePool();
  const pendingRes = await pool.query<{
    id: string;
    market: string;
    selection: string;
    decimal_odds: string;
    home_goals: number;
    away_goals: number;
    home_name: string;
    away_name: string;
  }>(
    `SELECT
      v.id, v.market, v.selection, v.decimal_odds,
      mr.home_goals, mr.away_goals,
      ht.name AS home_name, at.name AS away_name
     FROM value_opportunities_log v
     JOIN matches m ON m.id = v.match_id
     JOIN match_results mr ON mr.match_id = m.id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE v.status = 'pendiente' AND m.status = 'finished'`
  );

  let settledCount = 0;
  for (const row of pendingRes.rows) {
    const hg = row.home_goals;
    const ag = row.away_goals;
    const total = hg + ag;
    let won = false;

    if (row.market === 'Resultado 1X2') {
      if (row.selection.includes('(1)') || row.selection.includes(row.home_name)) {
        won = hg > ag;
      } else if (row.selection.includes('(X)') || row.selection.toLowerCase().includes('empate')) {
        won = hg === ag;
      } else if (row.selection.includes('(2)') || row.selection.includes(row.away_name)) {
        won = ag > hg;
      }
    } else if (row.market === 'Goles') {
      if (row.selection.includes('Más de 2.5')) won = total > 2;
      else if (row.selection.includes('Menos de 2.5')) won = total < 3;
    }

    const odds = Number(row.decimal_odds);
    const roiUnit = won ? Number((odds - 1).toFixed(4)) : -1;
    const status = won ? 'ganada' : 'perdida';
    const actualResult = `${hg}-${ag}`;

    await pool.query(
      `UPDATE value_opportunities_log
       SET status = $2, actual_result = $3, realized_roi_unit = $4, settled_at = NOW()
       WHERE id = $1`,
      [row.id, status, actualResult, roiUnit]
    );
    settledCount += 1;
  }

  return { settledCount };
}
