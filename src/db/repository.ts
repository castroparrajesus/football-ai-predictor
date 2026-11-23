import { Pool } from 'pg';
import {
  CalibrationBin,
  ConfidenceTier,
  EnsembleWeights,
  LeagueId,
  MatchRecord,
  PredictionHistoryItem,
  QualityFilterThresholds,
  TeamStatisticalProfile,
} from '../types/football.ts';
import {
  combineEnsembleProbabilities,
  computeBrierScoreBinary,
  computeLogLossBinary,
  computePoissonScoreMatrix,
  removeBookmakerMargin,
} from '../utils/previewMath.ts';
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

  return teamsRes.rows.map((team, idx) => {
    const rows = byTeam.get(team.id) ?? [];
    const finished = rows.filter((r) => r.home_goals !== null && r.away_goals !== null);

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

    const played = finished.length;
    const points = won * 3 + drawn;
    const last5Rows = finished.slice(0, 5);
    const l5 = last5Rows.reduce(
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

    const missingFields: string[] = [];
    if (xgCount === 0) missingFields.push('xG / xGA');
    if (shotsCount === 0) missingFields.push('Tiros totales / a puerta');
    if (cornersCount === 0) missingFields.push('Córners promedio');
    if (ycCount === 0) missingFields.push('Tarjetas promedio');
    if (played < 10) missingFields.push('Histórico mínimo (10+ partidos)');

    return {
      id: team.id,
      leagueId: team.league_id,
      name: team.name,
      shortName: team.short_name,
      position: idx + 1,
      points,
      played,
      won,
      drawn,
      lost,
      goalsFor: gf,
      goalsAgainst: ga,
      avgGoalsFor: played > 0 ? Number((gf / played).toFixed(2)) : 0,
      avgGoalsAgainst: played > 0 ? Number((ga / played).toFixed(2)) : 0,
      xg: xgCount > 0 ? Number(xgSum.toFixed(2)) : null,
      xga: xgaCount > 0 ? Number(xgaSum.toFixed(2)) : null,
      totalShots: shotsCount > 0 ? shotsSum : null,
      shotsOnTarget: sotCount > 0 ? sotSum : null,
      offensiveEfficiency:
        sotCount > 0 && sotSum > 0 ? Number(((gf / sotSum) * 100).toFixed(1)) : null,
      defensiveEfficiency: null,
      cleanSheets,
      bttsRate: played > 0 ? Number((bttsCount / played).toFixed(2)) : 0,
      over15Rate: played > 0 ? Number((o15 / played).toFixed(2)) : 0,
      over25Rate: played > 0 ? Number((o25 / played).toFixed(2)) : 0,
      over35Rate: played > 0 ? Number((o35 / played).toFixed(2)) : 0,
      over45Rate: played > 0 ? Number((o45 / played).toFixed(2)) : 0,
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
      restDays: null,
      scheduleCongestion: null,
      absences: null,
      probableLineup: null,
      recentCoachChange: false,
      recentTrend: l5.points >= 10 ? 'ascendente' : l5.points <= 4 && l5.matches >= 3 ? 'descendente' : 'estable',
      eloRating: Number(team.elo_rating),
      missingFields,
    };
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
    ORDER BY m.kickoff_utc DESC
    LIMIT 200`,
    params
  );

  const matchIds = res.rows.map((r) => r.id);
  const oddsMap = new Map<
    string,
    { home?: number; draw?: number; away?: number; over25?: number; under25?: number; bookmaker: string }
  >();

  if (matchIds.length > 0) {
    const oddsRes = await pool.query<{
      match_id: string;
      bookmaker: string;
      market: string;
      selection: string;
      decimal_odds: string;
    }>(
      `SELECT match_id, bookmaker, market, selection, decimal_odds
       FROM odds_snapshots
       WHERE match_id = ANY($1::text[])
       ORDER BY captured_at DESC`,
      [matchIds]
    );

    for (const o of oddsRes.rows) {
      const entry = oddsMap.get(o.match_id) ?? { bookmaker: o.bookmaker };
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

  return res.rows.map((row) => {
    const iso = new Date(row.kickoff_utc).toISOString();
    const datePart = iso.slice(0, 10);
    const timePart = iso.slice(11, 16);
    const lambdaHome = row.expected_lambda_home ? Number(row.expected_lambda_home) : 1.45;
    const lambdaAway = row.expected_lambda_away ? Number(row.expected_lambda_away) : 1.15;
    const poisson = computePoissonScoreMatrix(lambdaHome, lambdaAway).threeWay;

    const odds = oddsMap.get(row.id);
    const has1X2 = Boolean(odds?.home && odds?.draw && odds?.away);
    const deVigged = has1X2
      ? removeBookmakerMargin([odds!.home!, odds!.draw!, odds!.away!]).fairProbs
      : null;

    const missingNotes = Array.isArray(row.missing_data_notes)
      ? (row.missing_data_notes as string[])
      : [];

    const completeness = row.data_completeness;
    const confidenceTier: ConfidenceTier =
      completeness >= 85 ? 'A' : completeness >= 70 ? 'B' : completeness >= 45 ? 'C' : 'DESCARTADO';

    const ensemble = combineEnsembleProbabilities(
      {
        poisson,
        elo: poisson,
        machineLearning: poisson,
        recentForm: poisson,
        homeAway: poisson,
      },
      { poisson: 0.25, elo: 0.22, machineLearning: 0.25, recentForm: 0.14, homeAway: 0.14 }
    );

    return {
      id: row.id,
      leagueId: row.league_id,
      date: datePart,
      kickoffTime: timePart,
      matchday: row.matchday,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeTeamName: row.home_team_name,
      awayTeamName: row.away_team_name,
      isSynthetic: false,
      dataCompleteness: completeness,
      missingDataNotes: missingNotes,
      h2hSummary: null,
      expectedLambdaHome: lambdaHome,
      expectedLambdaAway: lambdaAway,
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
        poisson,
        elo: poisson,
        machineLearning: poisson,
        recentForm: poisson,
        homeAway: poisson,
        marketDeVigged: deVigged
          ? { home: deVigged[0], draw: deVigged[1], away: deVigged[2] }
          : null,
        ensemble,
        modelSpread: 0,
      },
      confidenceTier,
      confidenceReasons:
        completeness >= 70
          ? ['Partido persistido en PostgreSQL. Modelos Elo/ML completos se activan en Fases 5–7.']
          : ['Datos parciales en PostgreSQL (importación CSV sin xG/alineaciones completas).'],
      // Campos informativos de resultado si ya finalizó
      ...(row.home_goals !== null && row.away_goals !== null
        ? { actualScore: `${row.home_goals}-${row.away_goals}`, matchStatus: row.status }
        : { matchStatus: row.status }),
    } as MatchRecord;
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
}) {
  const pool = requirePool();
  const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const modelVersionId = input.modelVersionId ?? 'ensemble-v1-phase3';

  const res = await pool.query<{ id: string; created_at: Date }>(
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
