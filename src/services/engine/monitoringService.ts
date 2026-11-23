import { getPool } from '../../db/pool.ts';
import { getMatchesFromDb } from '../../db/repository.ts';
import {
  LeagueFilter,
  LeagueId,
  MonitoringConfigState,
  MonitoringDashboardData,
  OddsHistoryTimeline,
  OddsSnapshotPoint,
  PerformanceBreakdownRow,
  ProviderEnrichmentEvaluation,
  SystemAlert,
} from '../../types/football.ts';
import {
  computeBrierScoreBinary,
  computeLogLossBinary,
} from '../../utils/previewMath.ts';
import { dataSyncService } from '../providers/DataSyncService.ts';
import {
  getActiveTrainedModelFromDb,
  getBacktestHistoryFromDb,
} from './backtestService.ts';
import {
  buildCalibrationBinsAndEce,
  computeConfidenceInterval,
} from './calibration.ts';
import { runDatabaseAudit } from './dataAudit.ts';

const LEAGUE_LABELS: Record<string, string> = {
  premier_league: 'Premier League',
  laliga: 'LaLiga',
  serie_a: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
};

const ALL_LEAGUES: LeagueId[] = [
  'premier_league',
  'laliga',
  'serie_a',
  'bundesliga',
  'ligue_1',
];

export const PROVIDER_EVALUATION_CATALOG: ProviderEnrichmentEvaluation[] = [
  {
    id: 'api_football',
    name: 'API-Football (API-Sports v3)',
    status: 'configurado',
    pricingSummary:
      'Free $0/mes (100 req/día, limitado a temporadas pasadas); Pro ~$16–19/mes (7,500 req/día, temporada actual completa); Ultra ~$26/mes (75,000 req/día).',
    big5Coverage:
      'Cobertura completa de Premier League, LaLiga, Serie A, Bundesliga y Ligue 1 (IDs 39, 140, 135, 78, 61).',
    historicalAvailability:
      'En plan gratuito la temporada actual suele estar bloqueada o limitada; estadísticas por partido (/fixtures/statistics) requieren 1 petición por partido.',
    rateLimits: 'Free: 100 req/día (~10 req/min). Pro: 7,500 req/día (300 req/min).',
    termsSummary:
      'API comercial oficial. Uso interno/analítico permitido; prohibida redistribución bruta de feeds sin licencia.',
    supports: {
      xg: true,
      shots: true,
      corners: true,
      cards: true,
      lineups: true,
      injuries: true,
      homeAwaySplits: true,
      closingOdds: false,
    },
    recommendedRole:
      'Principal candidato si se actualiza al plan Pro (~$16–19/mes) para obtener estadísticas por partido (tiros, córners, tarjetas, xG parcial) y alineaciones pre-partido.',
  },
  {
    id: 'sportmonks',
    name: 'Sportmonks Football API v3',
    status: 'evaluado_no_contratado',
    pricingSummary:
      'Plan Free solo cubre ligas de prueba (Escocia/Dinamarca, sin 5 Grandes Ligas). Planes Big 5 desde ~€29–€39/mes + add-on de xG aparte.',
    big5Coverage:
      'Cobertura completa de las 5 Grandes Ligas en planes de pago europeos/mundiales.',
    historicalAvailability:
      'Archivo histórico profundo desde 2005+ en planes estándar/avanzados, incluyendo córners, tarjetas, alineaciones y bajas.',
    rateLimits: 'Límites horarios por entidad (ej. 3,000 req/hora por endpoint en planes iniciales).',
    termsSummary:
      'API oficial con SLA comercial. Sin acceso gratuito a Big 5; no contratado en esta fase.',
    supports: {
      xg: true,
      shots: true,
      corners: true,
      cards: true,
      lineups: true,
      injuries: true,
      homeAwaySplits: true,
      closingOdds: true,
    },
    recommendedRole:
      'Alternativa profesional más completa (incluye xG, alineaciones y bajas consolidadas) cuando el proyecto pase a presupuesto mensual.',
  },
  {
    id: 'football_data_co_uk',
    name: 'Football-Data.co.uk (CSV Histórico)',
    status: 'configurado',
    pricingSummary: 'Gratuito ($0) mediante descarga/importación CSV oficial.',
    big5Coverage:
      'Cobertura completa de las 5 Grandes Ligas y múltiples temporadas históricas (1993–presente).',
    historicalAvailability:
      'Incluye goles HT/FT, tiros totales (HS/AS), tiros a puerta (HST/AST), córners (HC/AC), faltas, amarillas/rojas (HY/AY/HR/AR) y cuotas de cierre (PS/B365/Max).',
    rateLimits: 'Sin límite API (archivos estáticos actualizados semanalmente).',
    termsSummary:
      'Datos públicos para investigación estadística. El importador CSV del sistema ya soporta sus cabeceras estándar.',
    supports: {
      xg: false,
      shots: true,
      corners: true,
      cards: true,
      lineups: false,
      injuries: false,
      homeAwaySplits: true,
      closingOdds: true,
    },
    recommendedRole:
      'Fuente gratuita recomendada hoy mismo para enriquecer históricos de tiros, córners, tarjetas y cuotas de cierre vía Importar CSV sin contratar suscripciones.',
  },
  {
    id: 'opta_statsbomb',
    name: 'Opta (Stats Perform) / Hudl StatsBomb',
    status: 'evaluado_no_contratado',
    pricingSummary:
      'Licencias enterprise B2B bajo presupuesto personalizado (miles de EUR/año). StatsBomb Open Data solo cubre torneos históricos puntuales.',
    big5Coverage:
      'Estándar de industria para las 5 Grandes Ligas con datos de eventos y xG avanzado.',
    historicalAvailability: 'Histórico multitemporada completo bajo contrato comercial.',
    rateLimits: 'Acordados por contrato empresarial.',
    termsSummary:
      'Sin plan autoservicio ni gratuito para ligas actuales en directo; descartado para uso sin contratación.',
    supports: {
      xg: true,
      shots: true,
      corners: true,
      cards: true,
      lineups: true,
      injuries: true,
      homeAwaySplits: true,
      closingOdds: false,
    },
    recommendedRole: 'Solo viable en despliegues comerciales con presupuesto enterprise.',
  },
  {
    id: 'understat_fbref',
    name: 'Understat / FBref (Scraping HTML)',
    status: 'descartado_tos',
    pricingSummary: 'Sitios web gratuitos sin API pública oficial.',
    big5Coverage: 'Cubren xG/xGA y estadísticas avanzadas de las 5 Grandes Ligas.',
    historicalAvailability: 'Desde 2014–2017 según competición.',
    rateLimits: 'Bloqueo anti-bot (Cloudflare / rate limiting estricto).',
    termsSummary:
      'La extracción automatizada (scraping) infringe sus términos de servicio y carece de estabilidad contractual. Descartado.',
    supports: {
      xg: true,
      shots: true,
      corners: false,
      cards: true,
      lineups: true,
      injuries: false,
      homeAwaySplits: true,
      closingOdds: false,
    },
    recommendedRole:
      'Descartado por términos de uso y fragilidad operativa; no se implementa scraping no autorizado.',
  },
];

export function computeClvPct(takenOdds: number, closingOdds: number): number | null {
  if (!Number.isFinite(takenOdds) || !Number.isFinite(closingOdds)) return null;
  if (takenOdds <= 1.0 || closingOdds <= 1.0) return null;
  return Number((((takenOdds / closingOdds) - 1) * 100).toFixed(3));
}

export function evaluateSelectionOutcome(
  market: string,
  selection: string,
  homeGoals: number,
  awayGoals: number,
  homeTeamName?: string,
  awayTeamName?: string
): 0 | 1 | null {
  const total = homeGoals + awayGoals;
  const selLower = selection.toLowerCase();
  const mktLower = market.toLowerCase();

  if (mktLower.includes('1x2') || mktLower.includes('resultado')) {
    if (
      selLower.includes('(1)') ||
      selection.trim() === '1' ||
      (homeTeamName && selLower.includes(homeTeamName.toLowerCase()))
    ) {
      return homeGoals > awayGoals ? 1 : 0;
    }
    if (selLower.includes('(x)') || selection.trim().toUpperCase() === 'X' || selLower.includes('empate')) {
      return homeGoals === awayGoals ? 1 : 0;
    }
    if (
      selLower.includes('(2)') ||
      selection.trim() === '2' ||
      (awayTeamName && selLower.includes(awayTeamName.toLowerCase()))
    ) {
      return awayGoals > homeGoals ? 1 : 0;
    }
    return null;
  }

  if (mktLower.includes('doble')) {
    if (selLower.includes('1x')) return homeGoals >= awayGoals ? 1 : 0;
    if (selLower.includes('x2')) return awayGoals >= homeGoals ? 1 : 0;
    if (selLower.includes('12')) return homeGoals !== awayGoals ? 1 : 0;
    return null;
  }

  if (mktLower.includes('ambos') || mktLower.includes('btts')) {
    const both = homeGoals > 0 && awayGoals > 0;
    if (selLower.includes('sí') || selLower.includes('si') || selLower.includes('yes')) {
      return both ? 1 : 0;
    }
    if (selLower.includes('no')) {
      return !both ? 1 : 0;
    }
    return null;
  }

  if (mktLower.includes('goles') || mktLower.includes('ou')) {
    const matchLine = selLower.match(/(0\.5|1\.5|2\.5|3\.5|4\.5)/);
    if (!matchLine) return null;
    const line = Number(matchLine[1]);
    if (selLower.includes('más') || selLower.includes('mas') || selLower.includes('over')) {
      return total > line ? 1 : 0;
    }
    if (selLower.includes('menos') || selLower.includes('under')) {
      return total < line ? 1 : 0;
    }
    return null;
  }

  return null;
}

export function computeOddsTimelineMetrics(snapshotsAsc: OddsSnapshotPoint[]): {
  openingOdds: number;
  openingCapturedAt: string;
  latestOdds: number;
  latestCapturedAt: string;
  closingOdds: number | null;
  closingCapturedAt: string | null;
  deltaOdds: number;
  deltaPct: number;
} | null {
  if (snapshotsAsc.length === 0) return null;
  const opening = snapshotsAsc[0];
  const latest = snapshotsAsc[snapshotsAsc.length - 1];

  const closingCandidates = snapshotsAsc.filter(
    (s) =>
      s.isClosing ||
      (s.minutesToKickoff !== null && s.minutesToKickoff >= 0 && s.minutesToKickoff <= 120)
  );
  const closing =
    closingCandidates.length > 0 ? closingCandidates[closingCandidates.length - 1] : null;

  const deltaOdds = Number((latest.decimalOdds - opening.decimalOdds).toFixed(4));
  const deltaPct =
    opening.decimalOdds > 0
      ? Number((((latest.decimalOdds - opening.decimalOdds) / opening.decimalOdds) * 100).toFixed(2))
      : 0;

  return {
    openingOdds: opening.decimalOdds,
    openingCapturedAt: opening.capturedAt,
    latestOdds: latest.decimalOdds,
    latestCapturedAt: latest.capturedAt,
    closingOdds: closing ? closing.decimalOdds : null,
    closingCapturedAt: closing ? closing.capturedAt : null,
    deltaOdds,
    deltaPct,
  };
}

export async function getMonitoringConfig(): Promise<MonitoringConfigState> {
  const fallback: MonitoringConfigState = {
    autoOddsCaptureEnabled: false,
    captureIntervalMinutes: 360,
    closingWindowMinutes: 90,
    minRemainingCreditsGuard: 50,
    autoSettleEnabled: true,
    lastAutoOddsRunAt: null,
    lastAutoSettleRunAt: null,
  };

  const pool = getPool();
  if (!pool) return fallback;

  try {
    const res = await pool.query<{
      auto_odds_capture_enabled: boolean;
      capture_interval_minutes: number;
      closing_window_minutes: number;
      min_remaining_credits_guard: number;
      auto_settle_enabled: boolean;
      last_auto_odds_run_at: Date | null;
      last_auto_settle_run_at: Date | null;
    }>(
      `SELECT
        auto_odds_capture_enabled, capture_interval_minutes, closing_window_minutes,
        min_remaining_credits_guard, auto_settle_enabled,
        last_auto_odds_run_at, last_auto_settle_run_at
       FROM monitoring_config
       WHERE id = 'default'
       LIMIT 1`
    );
    const r = res.rows[0];
    if (!r) return fallback;
    return {
      autoOddsCaptureEnabled: r.auto_odds_capture_enabled,
      captureIntervalMinutes: r.capture_interval_minutes,
      closingWindowMinutes: r.closing_window_minutes,
      minRemainingCreditsGuard: r.min_remaining_credits_guard,
      autoSettleEnabled: r.auto_settle_enabled,
      lastAutoOddsRunAt: r.last_auto_odds_run_at
        ? new Date(r.last_auto_odds_run_at).toISOString()
        : null,
      lastAutoSettleRunAt: r.last_auto_settle_run_at
        ? new Date(r.last_auto_settle_run_at).toISOString()
        : null,
    };
  } catch {
    return fallback;
  }
}

export async function updateMonitoringConfig(
  input: Partial<
    Pick<
      MonitoringConfigState,
      | 'autoOddsCaptureEnabled'
      | 'captureIntervalMinutes'
      | 'closingWindowMinutes'
      | 'minRemainingCreditsGuard'
      | 'autoSettleEnabled'
    >
  >
): Promise<MonitoringConfigState> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const current = await getMonitoringConfig();
  const next = {
    autoOddsCaptureEnabled:
      input.autoOddsCaptureEnabled ?? current.autoOddsCaptureEnabled,
    captureIntervalMinutes:
      input.captureIntervalMinutes ?? current.captureIntervalMinutes,
    closingWindowMinutes:
      input.closingWindowMinutes ?? current.closingWindowMinutes,
    minRemainingCreditsGuard:
      input.minRemainingCreditsGuard ?? current.minRemainingCreditsGuard,
    autoSettleEnabled: input.autoSettleEnabled ?? current.autoSettleEnabled,
  };

  await pool.query(
    `INSERT INTO monitoring_config (
      id, auto_odds_capture_enabled, capture_interval_minutes,
      closing_window_minutes, min_remaining_credits_guard, auto_settle_enabled, updated_at
    ) VALUES ('default', $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      auto_odds_capture_enabled = EXCLUDED.auto_odds_capture_enabled,
      capture_interval_minutes = EXCLUDED.capture_interval_minutes,
      closing_window_minutes = EXCLUDED.closing_window_minutes,
      min_remaining_credits_guard = EXCLUDED.min_remaining_credits_guard,
      auto_settle_enabled = EXCLUDED.auto_settle_enabled,
      updated_at = NOW()`,
    [
      next.autoOddsCaptureEnabled,
      next.captureIntervalMinutes,
      next.closingWindowMinutes,
      next.minRemainingCreditsGuard,
      next.autoSettleEnabled,
    ]
  );

  return getMonitoringConfig();
}

export async function getOddsHistoryTimelines(filters?: {
  leagueId?: string;
  limit?: number;
}): Promise<OddsHistoryTimeline[]> {
  const pool = getPool();
  if (!pool) return [];

  const params: unknown[] = [];
  let whereSql = '';
  if (filters?.leagueId && filters.leagueId !== 'all') {
    params.push(filters.leagueId);
    whereSql = 'WHERE m.league_id = $1';
  }

  let rows: {
    id: number;
    match_id: string;
    league_id: LeagueId;
    kickoff_utc: Date;
    match_status: string;
    home_name: string;
    away_name: string;
    bookmaker: string;
    market: string;
    selection: string;
    decimal_odds: string;
    captured_at: Date;
    is_closing: boolean;
    minutes_to_kickoff: number | null;
  }[] = [];

  try {
    const res = await pool.query<typeof rows[number]>(
      `SELECT
        os.id, os.match_id, m.league_id, m.kickoff_utc, m.status AS match_status,
        ht.name AS home_name, at.name AS away_name,
        os.bookmaker, os.market, os.selection, os.decimal_odds,
        os.captured_at, os.is_closing, os.minutes_to_kickoff
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       ${whereSql}
       ORDER BY m.kickoff_utc DESC, os.captured_at ASC`,
      params
    );
    rows = res.rows;
  } catch {
    const res = await pool.query<Omit<typeof rows[number], 'minutes_to_kickoff'>>(
      `SELECT
        os.id, os.match_id, m.league_id, m.kickoff_utc, m.status AS match_status,
        ht.name AS home_name, at.name AS away_name,
        os.bookmaker, os.market, os.selection, os.decimal_odds,
        os.captured_at, os.is_closing
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       ${whereSql}
       ORDER BY m.kickoff_utc DESC, os.captured_at ASC`,
      params
    );
    rows = res.rows.map((r) => ({ ...r, minutes_to_kickoff: null }));
  }

  // Contar oportunidades y predicciones vinculadas por partido
  const linkedCounts = new Map<string, number>();
  try {
    const [oppRes, predRes] = await Promise.all([
      pool.query<{ match_id: string; c: string }>(
        'SELECT match_id, COUNT(*) AS c FROM value_opportunities_log GROUP BY match_id'
      ),
      pool.query<{ match_id: string; c: string }>(
        'SELECT match_id, COUNT(*) AS c FROM predictions GROUP BY match_id'
      ),
    ]);
    for (const r of oppRes.rows) {
      linkedCounts.set(r.match_id, (linkedCounts.get(r.match_id) ?? 0) + Number(r.c));
    }
    for (const r of predRes.rows) {
      linkedCounts.set(r.match_id, (linkedCounts.get(r.match_id) ?? 0) + Number(r.c));
    }
  } catch {
    // Tablas opcionales si aún no existen
  }

  const grouped = new Map<
    string,
    {
      matchId: string;
      matchLabel: string;
      leagueId: LeagueId;
      kickoffUtc: string;
      matchStatus: string;
      bookmaker: string;
      market: string;
      selection: string;
      snapshots: OddsSnapshotPoint[];
    }
  >();

  for (const r of rows) {
    const key = `${r.match_id}|${r.bookmaker}|${r.market}|${r.selection}`;
    const kickoffMs = new Date(r.kickoff_utc).getTime();
    const capturedMs = new Date(r.captured_at).getTime();
    const mtk =
      r.minutes_to_kickoff !== null
        ? r.minutes_to_kickoff
        : Math.round((kickoffMs - capturedMs) / 60_000);

    const existing = grouped.get(key) ?? {
      matchId: r.match_id,
      matchLabel: `${r.home_name} vs ${r.away_name}`,
      leagueId: r.league_id,
      kickoffUtc: new Date(r.kickoff_utc).toISOString(),
      matchStatus: r.match_status,
      bookmaker: r.bookmaker,
      market: r.market,
      selection: r.selection,
      snapshots: [],
    };
    existing.snapshots.push({
      id: Number(r.id),
      decimalOdds: Number(r.decimal_odds),
      capturedAt: new Date(r.captured_at).toISOString(),
      minutesToKickoff: mtk,
      isClosing: r.is_closing || (mtk >= 0 && mtk <= 90),
    });
    grouped.set(key, existing);
  }

  const timelines: OddsHistoryTimeline[] = [];
  for (const item of grouped.values()) {
    item.snapshots.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    const metrics = computeOddsTimelineMetrics(item.snapshots);
    if (!metrics) continue;
    timelines.push({
      matchId: item.matchId,
      matchLabel: item.matchLabel,
      leagueId: item.leagueId,
      kickoffUtc: item.kickoffUtc,
      matchStatus: item.matchStatus,
      bookmaker: item.bookmaker,
      market: item.market,
      selection: item.selection,
      openingOdds: metrics.openingOdds,
      openingCapturedAt: metrics.openingCapturedAt,
      latestOdds: metrics.latestOdds,
      latestCapturedAt: metrics.latestCapturedAt,
      closingOdds: metrics.closingOdds,
      closingCapturedAt: metrics.closingCapturedAt,
      deltaOdds: metrics.deltaOdds,
      deltaPct: metrics.deltaPct,
      snapshotCount: item.snapshots.length,
      linkedOpportunitiesCount: linkedCounts.get(item.matchId) ?? 0,
      snapshots: item.snapshots,
    });
  }

  const limit = filters?.limit ?? 180;
  return timelines.slice(0, limit);
}

async function findRealClosingOdds(
  matchId: string,
  market: string,
  selection: string,
  bookmaker?: string | null
): Promise<number | null> {
  const pool = getPool();
  if (!pool) return null;

  let normalizedMarket = '1X2';
  let normalizedSelection = selection;
  const mLow = market.toLowerCase();
  const sLow = selection.toLowerCase();

  if (mLow.includes('1x2') || mLow.includes('resultado')) {
    normalizedMarket = '1X2';
    if (sLow.includes('(1)') || selection === '1') normalizedSelection = '1';
    else if (sLow.includes('(x)') || selection.toUpperCase() === 'X' || sLow.includes('empate'))
      normalizedSelection = 'X';
    else if (sLow.includes('(2)') || selection === '2') normalizedSelection = '2';
  } else if (mLow.includes('goles') || mLow.includes('ou')) {
    normalizedMarket = 'OU25';
    if (sLow.includes('más de 2.5') || sLow.includes('over 2.5')) normalizedSelection = 'Over 2.5';
    else if (sLow.includes('menos de 2.5') || sLow.includes('under 2.5'))
      normalizedSelection = 'Under 2.5';
    else return null;
  } else {
    return null;
  }

  try {
    const res = await pool.query<{ decimal_odds: string }>(
      `SELECT os.decimal_odds
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.match_id = $1
         AND os.market = $2
         AND os.selection = $3
         AND ($4::text IS NULL OR os.bookmaker = $4)
         AND os.captured_at <= m.kickoff_utc
         AND (
           os.is_closing = TRUE
           OR EXTRACT(EPOCH FROM (m.kickoff_utc - os.captured_at)) BETWEEN 0 AND 7200
         )
       ORDER BY os.captured_at DESC
       LIMIT 1`,
      [matchId, normalizedMarket, normalizedSelection, bookmaker ?? null]
    );
    const val = res.rows[0]?.decimal_odds;
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

export async function autoSettleAllPendingInDb(): Promise<{
  settledPredictions: number;
  settledValueOpportunities: number;
  skippedUnsupported: number;
  ranAtUtc: string;
}> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  let settledPredictions = 0;
  let settledValueOpportunities = 0;
  let skippedUnsupported = 0;

  // 1. Liquidar predicciones registradas pendientes con marcador confirmado
  const pendingPreds = await pool.query<{
    id: string;
    match_id: string;
    selected_market: string;
    selected_selection: string;
    predicted_prob: string;
    odds_at_prediction: string;
    bookmaker: string | null;
    home_goals: number;
    away_goals: number;
    home_name: string;
    away_name: string;
  }>(
    `SELECT
      p.id, p.match_id, p.selected_market, p.selected_selection,
      p.predicted_prob, p.odds_at_prediction, p.bookmaker,
      mr.home_goals, mr.away_goals,
      ht.name AS home_name, at.name AS away_name
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     JOIN match_results mr ON mr.match_id = m.id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN prediction_outcomes po ON po.prediction_id = p.id
     WHERE m.status = 'finished' AND po.id IS NULL`
  );

  for (const row of pendingPreds.rows) {
    const outcome = evaluateSelectionOutcome(
      row.selected_market,
      row.selected_selection,
      row.home_goals,
      row.away_goals,
      row.home_name,
      row.away_name
    );
    if (outcome === null) {
      skippedUnsupported += 1;
      continue;
    }

    const prob = Number(row.predicted_prob);
    const odds = Number(row.odds_at_prediction);
    const hasMarketOdds = odds > 1.005;
    const brier = computeBrierScoreBinary(prob, outcome);
    const logLoss = computeLogLossBinary(prob, outcome);
    const roi = hasMarketOdds ? (outcome === 1 ? odds - 1 : -1) : 0;
    const actualResult = `${row.home_goals}-${row.away_goals}`;

    const closingOdds = hasMarketOdds
      ? await findRealClosingOdds(
          row.match_id,
          row.selected_market,
          row.selected_selection,
          row.bookmaker
        )
      : null;
    const clvPct =
      hasMarketOdds && closingOdds !== null ? computeClvPct(odds, closingOdds) : null;

    try {
      await pool.query(
        `INSERT INTO prediction_outcomes (
          prediction_id, market, selection, predicted_prob, odds_used,
          actual_outcome, actual_result, brier_score, log_loss, simulated_roi,
          closing_odds, clv_pct
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (prediction_id, market, selection) DO NOTHING`,
        [
          row.id,
          row.selected_market,
          row.selected_selection,
          prob,
          odds,
          outcome,
          actualResult,
          brier,
          logLoss,
          roi,
          closingOdds,
          clvPct,
        ]
      );
      if (closingOdds !== null || clvPct !== null) {
        await pool
          .query(
            `UPDATE predictions SET closing_odds = $2, clv_pct = $3 WHERE id = $1`,
            [row.id, closingOdds, clvPct]
          )
          .catch(() => {});
      }
    } catch {
      await pool.query(
        `INSERT INTO prediction_outcomes (
          prediction_id, market, selection, predicted_prob, odds_used,
          actual_outcome, actual_result, brier_score, log_loss, simulated_roi
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (prediction_id, market, selection) DO NOTHING`,
        [
          row.id,
          row.selected_market,
          row.selected_selection,
          prob,
          odds,
          outcome,
          actualResult,
          brier,
          logLoss,
          roi,
        ]
      );
    }

    settledPredictions += 1;
  }

  // 2. Liquidar oportunidades de valor registradas pendientes
  const pendingOpps = await pool.query<{
    id: string;
    match_id: string;
    market: string;
    selection: string;
    bookmaker: string;
    decimal_odds: string;
    home_goals: number;
    away_goals: number;
    home_name: string;
    away_name: string;
  }>(
    `SELECT
      v.id, v.match_id, v.market, v.selection, v.bookmaker, v.decimal_odds,
      mr.home_goals, mr.away_goals,
      ht.name AS home_name, at.name AS away_name
     FROM value_opportunities_log v
     JOIN matches m ON m.id = v.match_id
     JOIN match_results mr ON mr.match_id = m.id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE v.status = 'pendiente' AND m.status = 'finished'`
  );

  for (const row of pendingOpps.rows) {
    const outcome = evaluateSelectionOutcome(
      row.market,
      row.selection,
      row.home_goals,
      row.away_goals,
      row.home_name,
      row.away_name
    );
    if (outcome === null) {
      skippedUnsupported += 1;
      continue;
    }

    const odds = Number(row.decimal_odds);
    const roiUnit = outcome === 1 ? Number((odds - 1).toFixed(4)) : -1;
    const status = outcome === 1 ? 'ganada' : 'perdida';
    const actualResult = `${row.home_goals}-${row.away_goals}`;
    const closingOdds = await findRealClosingOdds(
      row.match_id,
      row.market,
      row.selection,
      row.bookmaker
    );
    const clvPct = closingOdds !== null ? computeClvPct(odds, closingOdds) : null;

    try {
      await pool.query(
        `UPDATE value_opportunities_log
         SET status = $2, actual_result = $3, realized_roi_unit = $4,
             closing_odds = $5, clv_pct = $6, settled_at = NOW()
         WHERE id = $1`,
        [row.id, status, actualResult, roiUnit, closingOdds, clvPct]
      );
    } catch {
      await pool.query(
        `UPDATE value_opportunities_log
         SET status = $2, actual_result = $3, realized_roi_unit = $4, settled_at = NOW()
         WHERE id = $1`,
        [row.id, status, actualResult, roiUnit]
      );
    }

    settledValueOpportunities += 1;
  }

  await pool
    .query(
      `UPDATE monitoring_config SET last_auto_settle_run_at = NOW(), updated_at = NOW() WHERE id = 'default'`
    )
    .catch(() => {});

  return {
    settledPredictions,
    settledValueOpportunities,
    skippedUnsupported,
    ranAtUtc: new Date().toISOString(),
  };
}

export async function captureUpcomingPredictionsBatchInDb(params?: {
  leagueId?: LeagueFilter;
}): Promise<{
  registeredCount: number;
  skippedExisting: number;
  skippedDiscarded: number;
  withMarketOddsCount: number;
  withoutMarketOddsCount: number;
  modelVersionId: string;
}> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const [matches, activeModel] = await Promise.all([
    getMatchesFromDb({
      leagueId: params?.leagueId && params.leagueId !== 'all' ? params.leagueId : undefined,
      status: 'scheduled',
    }),
    getActiveTrainedModelFromDb(),
  ]);

  const modelVersionId = activeModel?.id ?? 'ensemble-v1-phase3';
  const nowMs = Date.now();

  let registeredCount = 0;
  let skippedExisting = 0;
  let skippedDiscarded = 0;
  let withMarketOddsCount = 0;
  let withoutMarketOddsCount = 0;

  for (const m of matches) {
    const kickoffMs = m.kickoffUtc ? Date.parse(m.kickoffUtc) : 0;
    if (!kickoffMs || kickoffMs <= nowMs) continue;

    if (m.confidenceTier === 'DESCARTADO') {
      skippedDiscarded += 1;
      continue;
    }

    const exists = await pool.query<{ id: string }>(
      `SELECT id FROM predictions
       WHERE match_id = $1 AND model_version_id = $2 AND selected_market = 'Resultado 1X2'
       LIMIT 1`,
      [m.id, modelVersionId]
    );
    if ((exists.rowCount ?? 0) > 0) {
      skippedExisting += 1;
      continue;
    }

    const probs = m.models.ensemble;
    let selection = `${m.homeTeamName} (1)`;
    let predictedProb = probs.home;
    let realOdds = m.odds1X2?.home ?? null;

    if (probs.away >= probs.home && probs.away >= probs.draw) {
      selection = `${m.awayTeamName} (2)`;
      predictedProb = probs.away;
      realOdds = m.odds1X2?.away ?? null;
    } else if (probs.draw >= probs.home && probs.draw >= probs.away) {
      selection = 'Empate (X)';
      predictedProb = probs.draw;
      realOdds = m.odds1X2?.draw ?? null;
    }

    const clampedProb = Math.max(0.01, Math.min(0.99, predictedProb));
    const fairOdds = Number((1 / clampedProb).toFixed(4));
    const hasOdds = Boolean(realOdds && realOdds > 1.0);
    // Si no existe cuota de mercado real, almacenamos 1.0 como marcador neutro sin simular precio
    const oddsAtPrediction = hasOdds ? Number(realOdds!.toFixed(4)) : 1.0;
    const bookmaker = hasOdds ? m.odds1X2!.bookmaker : null;

    if (hasOdds) withMarketOddsCount += 1;
    else withoutMarketOddsCount += 1;

    const expectedScore = `${Math.round(m.expectedLambdaHome)}-${Math.round(m.expectedLambdaAway)}`;
    const id = `pred_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      await pool.query(
        `INSERT INTO predictions (
          id, match_id, model_version_id, data_completeness_score, confidence_tier,
          expected_score, model_outputs, markets, score_matrix,
          selected_market, selected_selection, predicted_prob, odds_at_prediction,
          bookmaker, fair_odds, source_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, '[]'::jsonb, 'Resultado 1X2', $9, $10, $11, $12, $13, 'db')`,
        [
          id,
          m.id,
          modelVersionId,
          m.dataCompleteness,
          m.confidenceTier,
          expectedScore,
          JSON.stringify(m.models),
          JSON.stringify({ result1X2: probs }),
          selection,
          Number(clampedProb.toFixed(5)),
          oddsAtPrediction,
          bookmaker,
          fairOdds,
        ]
      );
    } catch {
      await pool.query(
        `INSERT INTO predictions (
          id, match_id, model_version_id, data_completeness_score, confidence_tier,
          expected_score, model_outputs, markets, score_matrix,
          selected_market, selected_selection, predicted_prob, odds_at_prediction, source_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, '[]'::jsonb, 'Resultado 1X2', $9, $10, $11, 'db')`,
        [
          id,
          m.id,
          modelVersionId,
          m.dataCompleteness,
          m.confidenceTier,
          expectedScore,
          JSON.stringify(m.models),
          JSON.stringify({ result1X2: probs }),
          selection,
          Number(clampedProb.toFixed(5)),
          oddsAtPrediction,
        ]
      );
    }

    registeredCount += 1;
  }

  return {
    registeredCount,
    skippedExisting,
    skippedDiscarded,
    withMarketOddsCount,
    withoutMarketOddsCount,
    modelVersionId,
  };
}

function parseRemainingCredits(quotaText: string | null | undefined): number | null {
  if (!quotaText) return null;
  const m = quotaText.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function capturePreMatchOddsSnapshot(params: {
  leagueId: LeagueFilter;
  respectCreditGuard?: boolean;
}): Promise<{
  executed: boolean;
  skippedReason?: string;
  oddsInserted: number;
  requestsUsed: number;
  quotaRemaining: string | null;
}> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const adapter = dataSyncService.getAdapter('the_odds_api');
  if (!adapter.isConfigured()) {
    return {
      executed: false,
      skippedReason: 'ODDS_API_KEY no configurada en el servidor.',
      oddsInserted: 0,
      requestsUsed: 0,
      quotaRemaining: null,
    };
  }

  const cfg = await getMonitoringConfig();
  if (params.respectCreditGuard !== false) {
    const lastLog = await pool.query<{ quota_remaining: string | null }>(
      `SELECT quota_remaining FROM provider_sync_logs
       WHERE provider_id = 'the_odds_api' AND quota_remaining IS NOT NULL
       ORDER BY synced_at DESC LIMIT 1`
    );
    const credits = parseRemainingCredits(lastLog.rows[0]?.quota_remaining);
    if (credits !== null && credits <= cfg.minRemainingCreditsGuard) {
      return {
        executed: false,
        skippedReason: `Protección de cuota activa: quedan ${credits} créditos <= límite configurado (${cfg.minRemainingCreditsGuard}).`,
        oddsInserted: 0,
        requestsUsed: 0,
        quotaRemaining: lastLog.rows[0]?.quota_remaining ?? null,
      };
    }
  }

  const summary = await dataSyncService.syncFromProvider({
    provider: 'the_odds_api',
    leagueFilter: params.leagueId,
  });

  await pool
    .query(
      `UPDATE monitoring_config SET last_auto_odds_run_at = NOW(), updated_at = NOW() WHERE id = 'default'`
    )
    .catch(() => {});

  return {
    executed: true,
    oddsInserted: summary.oddsInserted,
    requestsUsed: summary.requestsUsed,
    quotaRemaining: summary.quotaRemaining,
  };
}

interface JoinedPredictionRow {
  id: string;
  league_id: LeagueId;
  season_id: string;
  model_version_id: string;
  selected_market: string;
  selected_selection: string;
  predicted_prob: string;
  odds_at_prediction: string;
  bookmaker: string | null;
  actual_outcome: number | null;
  brier_score: string | null;
  log_loss: string | null;
  simulated_roi: string | null;
  closing_odds: string | null;
  clv_pct: string | null;
}

function buildBreakdownRows(
  rows: JoinedPredictionRow[],
  groupExtractor: (r: JoinedPredictionRow) => { key: string; label: string }
): PerformanceBreakdownRow[] {
  const map = new Map<string, { label: string; rows: JoinedPredictionRow[] }>();
  for (const r of rows) {
    const g = groupExtractor(r);
    const entry = map.get(g.key) ?? { label: g.label, rows: [] };
    entry.rows.push(r);
    map.set(g.key, entry);
  }

  return Array.from(map.entries())
    .map(([groupKey, entry]) => {
      const settled = entry.rows.filter((r) => r.actual_outcome !== null);
      const pendingCount = entry.rows.length - settled.length;
      const wins = settled.filter((r) => r.actual_outcome === 1).length;
      const hitRatePct =
        settled.length > 0 ? Number(((wins / settled.length) * 100).toFixed(1)) : null;
      const hitRateCi95: [number, number] | null =
        settled.length > 0
          ? (() => {
              const ci = computeConfidenceInterval(wins / settled.length, settled.length, 1.96);
              return [Number((ci.lower * 100).toFixed(1)), Number((ci.upper * 100).toFixed(1))];
            })()
          : null;

      const brierScore =
        settled.length > 0
          ? Number(
              (
                settled.reduce((s, r) => s + Number(r.brier_score ?? 0), 0) / settled.length
              ).toFixed(4)
            )
          : null;
      const logLoss =
        settled.length > 0
          ? Number(
              (
                settled.reduce((s, r) => s + Number(r.log_loss ?? 0), 0) / settled.length
              ).toFixed(4)
            )
          : null;
      const ece =
        settled.length > 0
          ? buildCalibrationBinsAndEce(
              settled.map((r) => ({
                predictedProb: Number(r.predicted_prob),
                outcome: (r.actual_outcome === 1 ? 1 : 0) as 0 | 1,
              }))
            ).ece
          : null;

      // ROI y Yield exclusivamente sobre apuestas con cuota de mercado real (>1.005) y liquidadas
      const settledWithOdds = settled.filter(
        (r) => Number(r.odds_at_prediction) > 1.005 && r.bookmaker !== null
      );
      const totalYield = settledWithOdds.reduce(
        (s, r) => s + Number(r.simulated_roi ?? 0),
        0
      );
      const realizedYieldUnits =
        settledWithOdds.length > 0 ? Number(totalYield.toFixed(2)) : null;
      const realizedRoiPct =
        settledWithOdds.length > 0
          ? Number(((totalYield / settledWithOdds.length) * 100).toFixed(2))
          : null;

      const clvRows = settled.filter((r) => r.clv_pct !== null);
      const clvAvgPct =
        clvRows.length > 0
          ? Number(
              (
                clvRows.reduce((s, r) => s + Number(r.clv_pct ?? 0), 0) / clvRows.length
              ).toFixed(2)
            )
          : null;

      return {
        groupKey,
        groupLabel: entry.label,
        totalPredictions: entry.rows.length,
        settledCount: settled.length,
        pendingCount,
        wins,
        hitRatePct,
        hitRateCi95,
        brierScore,
        logLoss,
        ece,
        realizedRoiPct,
        realizedYieldUnits,
        clvAvgPct,
        clvSampleCount: clvRows.length,
      };
    })
    .sort((a, b) => b.totalPredictions - a.totalPredictions);
}

export async function getMonitoringDashboardData(filters?: {
  leagueId?: string;
}): Promise<MonitoringDashboardData> {
  const pool = getPool();
  const config = await getMonitoringConfig();
  const [audit, btHistory, activeModel] = await Promise.all([
    runDatabaseAudit().catch(() => null),
    getBacktestHistoryFromDb().catch(() => []),
    getActiveTrainedModelFromDb().catch(() => null),
  ]);

  const latestBt = btHistory[0] ?? null;

  // Contar cobertura detallada real de mercados secundarios y bajas
  let shotsRows = 0;
  let cornersRows = 0;
  let cardsRows = 0;
  let xgRows = audit?.coverage.xgRows ?? 0;
  let lineupRows = audit?.coverage.lineupRows ?? 0;
  let injuryRows = audit?.coverage.injuryRows ?? 0;
  let staleUpcomingOddsMatches = 0;
  let upcomingNoOddsMatches = 0;
  let predRows: JoinedPredictionRow[] = [];
  let settledValueOppsCount = 0;

  if (pool) {
    try {
      const statsCov = await pool.query<{
        shots_rows: string;
        corners_rows: string;
        cards_rows: string;
        xg_rows: string;
      }>(
        `SELECT
          COUNT(*) FILTER (WHERE shots IS NOT NULL) AS shots_rows,
          COUNT(*) FILTER (WHERE corners IS NOT NULL) AS corners_rows,
          COUNT(*) FILTER (WHERE yellow_cards IS NOT NULL) AS cards_rows,
          COUNT(*) FILTER (WHERE xg IS NOT NULL) AS xg_rows
         FROM team_match_stats`
      );
      const sc = statsCov.rows[0];
      shotsRows = Number(sc?.shots_rows ?? 0);
      cornersRows = Number(sc?.corners_rows ?? 0);
      cardsRows = Number(sc?.cards_rows ?? 0);
      xgRows = Number(sc?.xg_rows ?? xgRows);

      const [lineupCnt, injuryCnt] = await Promise.all([
        pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM lineups'),
        pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM injuries_suspensions'),
      ]);
      lineupRows = Number(lineupCnt.rows[0]?.c ?? 0);
      injuryRows = Number(injuryCnt.rows[0]?.c ?? 0);

      // Comprobar próximos partidos (> ahora) con cuotas ausentes o >24h de antigüedad
      const upcomingHealth = await pool.query<{
        no_odds: string;
        stale_odds: string;
      }>(
        `WITH latest_odds AS (
          SELECT match_id, MAX(captured_at) AS last_cap
          FROM odds_snapshots
          GROUP BY match_id
        )
        SELECT
          COUNT(*) FILTER (WHERE lo.last_cap IS NULL) AS no_odds,
          COUNT(*) FILTER (WHERE lo.last_cap IS NOT NULL AND lo.last_cap < NOW() - INTERVAL '24 hours') AS stale_odds
        FROM matches m
        LEFT JOIN latest_odds lo ON lo.match_id = m.id
        WHERE m.status = 'scheduled' AND m.kickoff_utc > NOW()`
      );
      upcomingNoOddsMatches = Number(upcomingHealth.rows[0]?.no_odds ?? 0);
      staleUpcomingOddsMatches = Number(upcomingHealth.rows[0]?.stale_odds ?? 0);

      const predParams: unknown[] = [];
      let predWhere = '';
      if (filters?.leagueId && filters.leagueId !== 'all') {
        predParams.push(filters.leagueId);
        predWhere = 'WHERE m.league_id = $1';
      }

      try {
        const pr = await pool.query<JoinedPredictionRow>(
          `SELECT
            p.id, m.league_id, m.season_id, p.model_version_id,
            p.selected_market, p.selected_selection, p.predicted_prob,
            p.odds_at_prediction, p.bookmaker,
            po.actual_outcome, po.brier_score, po.log_loss, po.simulated_roi,
            COALESCE(po.closing_odds, p.closing_odds) AS closing_odds,
            COALESCE(po.clv_pct, p.clv_pct) AS clv_pct
           FROM predictions p
           JOIN matches m ON m.id = p.match_id
           LEFT JOIN prediction_outcomes po ON po.prediction_id = p.id
           ${predWhere}
           ORDER BY p.created_at DESC`,
          predParams
        );
        predRows = pr.rows;
      } catch {
        const pr = await pool.query<
          Omit<JoinedPredictionRow, 'bookmaker' | 'closing_odds' | 'clv_pct'>
        >(
          `SELECT
            p.id, m.league_id, m.season_id, p.model_version_id,
            p.selected_market, p.selected_selection, p.predicted_prob,
            p.odds_at_prediction,
            po.actual_outcome, po.brier_score, po.log_loss, po.simulated_roi
           FROM predictions p
           JOIN matches m ON m.id = p.match_id
           LEFT JOIN prediction_outcomes po ON po.prediction_id = p.id
           ${predWhere}
           ORDER BY p.created_at DESC`,
          predParams
        );
        predRows = pr.rows.map((r) => ({
          ...r,
          bookmaker: Number(r.odds_at_prediction) > 1.005 ? 'Market' : null,
          closing_odds: null,
          clv_pct: null,
        }));
      }

      const vRes = await pool.query<{ c: string }>(
        `SELECT COUNT(*) AS c FROM value_opportunities_log WHERE status IN ('ganada', 'perdida')`
      );
      settledValueOppsCount = Number(vRes.rows[0]?.c ?? 0);
    } catch {
      // Tablas aún no migradas o vacías
    }
  }

  // Mercados bloqueados por datos insuficientes reales
  const blockedMarkets = [
    {
      market: 'Córners (Over/Under y Hándicap)',
      reason:
        cornersRows < 100
          ? 'Bloqueado: sin cobertura real suficiente de córners por partido en PostgreSQL.'
          : 'Disponible parcialmente.',
      currentRows: cornersRows,
      requiredMinimum: '≥ 100 registros equipo-partido con córners reales',
    },
    {
      market: 'Tarjetas Amarillas / Rojas',
      reason:
        cardsRows < 100
          ? 'Bloqueado: sin historial real de disciplina/árbitros suficiente en PostgreSQL.'
          : 'Disponible parcialmente.',
      currentRows: cardsRows,
      requiredMinimum: '≥ 100 registros equipo-partido con tarjetas reales',
    },
    {
      market: 'Modelos basados en xG / xGA y Alineaciones',
      reason:
        xgRows < 100 || lineupRows < 40
          ? 'Bloqueado como señal obligatoria: xG/xGA y alineaciones confirmadas aún no cubren las 5 ligas (requiere API-Football Pro o CSV enriquecido).'
          : 'Disponible.',
      currentRows: xgRows + lineupRows,
      requiredMinimum: '≥ 100 filas xG/xGA y ≥ 40 alineaciones',
    },
  ];

  // Validación por liga y modelo
  const leagueValidationRows = ALL_LEAGUES.map((lg) => {
    const btLg = latestBt?.byLeague.find((item) => item.leagueId === lg);
    if (!btLg) {
      return {
        leagueId: lg,
        evaluatedMatches: 0,
        logLoss: null,
        status: 'sin_evaluar' as const,
      };
    }
    let status: 'validado' | 'muestra_pequena' | 'alerta_degradacion' | 'sin_evaluar' =
      'validado';
    if (btLg.logLoss > 1.05) status = 'alerta_degradacion';
    else if (btLg.matchesEvaluated < 100) status = 'muestra_pequena';
    return {
      leagueId: lg,
      evaluatedMatches: btLg.matchesEvaluated,
      logLoss: btLg.logLoss,
      status,
    };
  });

  const validationReasons: string[] = [];
  if (!activeModel || !latestBt) {
    validationReasons.push('No hay ningún modelo entrenado y validado mediante Walk-Forward.');
  } else {
    const smallLeagues = leagueValidationRows
      .filter((l) => l.status === 'muestra_pequena' || l.status === 'sin_evaluar')
      .map((l) => `${LEAGUE_LABELS[l.leagueId]} (${l.evaluatedMatches} eval.)`);
    if (smallLeagues.length > 0) {
      validationReasons.push(
        `Muestra fuera de muestra <100 partidos en: ${smallLeagues.join(', ')}.`
      );
    }
    const degradedLeagues = leagueValidationRows
      .filter((l) => l.status === 'alerta_degradacion')
      .map((l) => `${LEAGUE_LABELS[l.leagueId]} (LogLoss ${l.logLoss?.toFixed(3)})`);
    if (degradedLeagues.length > 0) {
      validationReasons.push(
        `LogLoss > 1.05 en evaluación walk-forward: ${degradedLeagues.join(', ')}.`
      );
    }
  }

  const totalSettledGlobal = predRows.filter((r) => r.actual_outcome !== null).length;
  if (totalSettledGlobal < 30) {
    validationReasons.push(
      `Seguimiento en vivo insuficiente (${totalSettledGlobal}/30 pronósticos pre-partido liquidados para validar rendimiento real post-despliegue).`
    );
  }

  const isValidated = Boolean(
    activeModel &&
      latestBt &&
      leagueValidationRows.every((l) => l.status === 'validado') &&
      totalSettledGlobal >= 30
  );

  // Alertas automáticas del sistema
  const alerts: SystemAlert[] = [];

  if (!activeModel || !latestBt) {
    alerts.push({
      id: 'no_trained_model',
      severity: 'critical',
      category: 'validacion_modelo',
      title: 'Modelo sin validación Walk-Forward activa',
      detail:
        'Aún no se ha ejecutado un backtest walk-forward persistido para calibrar Dixon-Coles, ML y Platt/Isotónica.',
      actionHint: 'Ejecuta Entrenar y Evaluar Walk-Forward en la pestaña Rendimiento.',
    });
  } else {
    // Detección de degradación entre folds recientes vs folds iniciales
    if (latestBt.folds.length >= 4) {
      const half = Math.floor(latestBt.folds.length / 2);
      const earlyLl =
        latestBt.folds.slice(0, half).reduce((s, f) => s + f.logLoss, 0) / half;
      const recentLl =
        latestBt.folds.slice(half).reduce((s, f) => s + f.logLoss, 0) /
        (latestBt.folds.length - half);
      if (recentLl - earlyLl > 0.06 || recentLl > 1.08) {
        alerts.push({
          id: 'fold_degradation',
          severity: 'warning',
          category: 'degradacion',
          title: 'Deriva / degradación detectada en bloques walk-forward recientes',
          detail: `Log Loss pasó de ${earlyLl.toFixed(4)} en los primeros folds a ${recentLl.toFixed(4)} en los últimos folds.`,
          actionHint: 'Re-entrena el modelo tras sincronizar resultados recientes y revisa ligas con menor muestra.',
        });
      }
    }

    const smallSampleLeagues = leagueValidationRows.filter((l) => l.evaluatedMatches < 100);
    if (smallSampleLeagues.length > 0) {
      alerts.push({
        id: 'small_league_samples',
        severity: 'warning',
        category: 'validacion_modelo',
        title: 'Validación parcial por tamaño de muestra (<100 partidos evaluados)',
        detail: `Las ligas ${smallSampleLeagues
          .map((l) => `${LEAGUE_LABELS[l.leagueId]} (${l.evaluatedMatches})`)
          .join(', ')} tienen menos de 100 partidos evaluados fuera de muestra.`,
        actionHint: 'Sincroniza temporadas previas (2023/24 o CSV históricos) o interpreta con cautela sus intervalos de confianza.',
      });
    }
  }

  // Degradación en vivo si hay suficientes apuestas liquidadas
  if (totalSettledGlobal >= 20 && latestBt) {
    const settled = predRows.filter((r) => r.actual_outcome !== null);
    const liveLogLoss =
      settled.reduce((s, r) => s + Number(r.log_loss ?? 0), 0) / settled.length;
    const btEnsembleLl =
      latestBt.modelMetrics.find((m) => m.modelKey === 'ensemble_calibrated')?.logLoss ?? 1.0;
    if (liveLogLoss - btEnsembleLl > 0.12) {
      alerts.push({
        id: 'live_degradation',
        severity: 'critical',
        category: 'degradacion',
        title: 'Degradación del rendimiento en vivo frente al backtesting',
        detail: `Log Loss en vivo (${liveLogLoss.toFixed(4)}) supera al baseline walk-forward (${btEnsembleLl.toFixed(4)}) en más de 0.12.`,
        actionHint: 'Pausa la selección automática de picks y ejecuta una recalibración.',
      });
    }
  }

  if (staleUpcomingOddsMatches > 0 || upcomingNoOddsMatches > 0) {
    alerts.push({
      id: 'odds_freshness',
      severity: staleUpcomingOddsMatches > 0 ? 'warning' : 'info',
      category: 'cuotas_caducadas',
      title: 'Control de frescura de cuotas pre-partido',
      detail: `${upcomingNoOddsMatches} partidos próximos aún sin cuota vinculada y ${staleUpcomingOddsMatches} con última captura >24h.`,
      actionHint:
        'Usa "Capturar snapshot ahora" en el Histórico de Cuotas antes del inicio de la jornada (vigilando créditos de The Odds API).',
    });
  }

  if (audit && audit.oddsAudit.expiredOddsRows > 0) {
    alerts.push({
      id: 'historical_post_kickoff_odds',
      severity: 'info',
      category: 'cuotas_caducadas',
      title: 'Snapshots en partidos ya finalizados excluidos de Value Finder',
      detail: `Existen ${audit.oddsAudit.expiredOddsRows} filas en partidos ya finalizados; el filtro bloquea automáticamente cualquier oportunidad sobre cuotas caducadas.`,
    });
  }

  if (cornersRows < 100 || cardsRows < 100 || xgRows < 100) {
    alerts.push({
      id: 'blocked_secondary_markets',
      severity: 'warning',
      category: 'mercado_bloqueado',
      title: 'Mercados de córners, tarjetas y xG bloqueados por falta de datos reales',
      detail: `Cobertura actual en BD: Tiros=${shotsRows}, Córners=${cornersRows}, Tarjetas=${cardsRows}, xG=${xgRows}, Alineaciones=${lineupRows}, Bajas=${injuryRows}.`,
      actionHint: 'Importa CSV de Football-Data.co.uk o habilita API-Football Pro para desbloquear estos mercados.',
    });
  }

  // Métricas reales estrictamente de predicciones liquidadas
  const overallSummary = buildBreakdownRows(predRows, () => ({
    key: 'all',
    label: 'Total',
  }))[0] ?? {
    groupKey: 'all',
    groupLabel: 'Total',
    totalPredictions: 0,
    settledCount: 0,
    pendingCount: 0,
    wins: 0,
    hitRatePct: null,
    hitRateCi95: null,
    brierScore: null,
    logLoss: null,
    ece: null,
    realizedRoiPct: null,
    realizedYieldUnits: null,
    clvAvgPct: null,
    clvSampleCount: 0,
  };

  const profitabilityDisclaimer =
    overallSummary.settledCount === 0
      ? `Sin pronósticos liquidados todavía (${overallSummary.pendingCount} pendientes; oportunidades Value Finder liquidadas: ${settledValueOppsCount}). No se calcula ni se afirma rentabilidad (ROI/Yield) hasta disponer de resultados reales confirmados.`
      : overallSummary.realizedRoiPct === null
      ? `Existen ${overallSummary.settledCount} pronósticos liquidados en evaluación probabilística (Brier/LogLoss/ECE), pero sin cuotas de mercado reales vinculadas al momento de registro; ROI y Yield permanecen en N/D.`
      : `Métricas calculadas exclusivamente sobre ${overallSummary.settledCount} pronósticos pre-partido realmente registrados y liquidados tras marcador oficial (muestra pequeña si N < 100).`;

  return {
    generatedAtUtc: new Date().toISOString(),
    config,
    alerts,
    blockedMarkets,
    modelValidationStatus: {
      isValidated,
      statusLabel: isValidated
        ? 'Validado en las 5 ligas y en vivo'
        : activeModel
        ? 'Validación parcial — requiere más muestra o ligas'
        : 'Sin validar (sin modelo entrenado)',
      reasons: validationReasons,
      byLeague: leagueValidationRows,
    },
    liveRealMetrics: {
      totalPredictionsLogged: overallSummary.totalPredictions,
      pendingCount: overallSummary.pendingCount,
      settledCount: overallSummary.settledCount,
      wins: overallSummary.wins,
      losses: Math.max(0, overallSummary.settledCount - overallSummary.wins),
      hitRatePct: overallSummary.hitRatePct,
      hitRateCi95: overallSummary.hitRateCi95,
      brierScore: overallSummary.brierScore,
      logLoss: overallSummary.logLoss,
      ece: overallSummary.ece,
      realizedRoiPct: overallSummary.realizedRoiPct,
      realizedYieldUnits: overallSummary.realizedYieldUnits,
      clvAvgPct: overallSummary.clvAvgPct,
      clvSampleCount: overallSummary.clvSampleCount,
      profitabilityDisclaimer,
      byLeague: buildBreakdownRows(predRows, (r) => ({
        key: r.league_id,
        label: LEAGUE_LABELS[r.league_id] ?? r.league_id,
      })),
      byMarket: buildBreakdownRows(predRows, (r) => ({
        key: r.selected_market,
        label: r.selected_market,
      })),
      bySeason: buildBreakdownRows(predRows, (r) => ({
        key: r.season_id,
        label: r.season_id,
      })),
      byModel: buildBreakdownRows(predRows, (r) => ({
        key: r.model_version_id,
        label: r.model_version_id,
      })),
    },
    providerEvaluations: PROVIDER_EVALUATION_CATALOG,
  };
}

let schedulerStarted = false;

export function startMonitoringScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const runTick = async () => {
    try {
      const cfg = await getMonitoringConfig();
      if (cfg.autoSettleEnabled) {
        await autoSettleAllPendingInDb().catch(() => {});
      }
      if (cfg.autoOddsCaptureEnabled) {
        const lastMs = cfg.lastAutoOddsRunAt ? Date.parse(cfg.lastAutoOddsRunAt) : 0;
        const intervalMs = cfg.captureIntervalMinutes * 60_000;
        if (!lastMs || Date.now() - lastMs >= intervalMs) {
          await capturePreMatchOddsSnapshot({
            leagueId: 'all',
            respectCreditGuard: true,
          }).catch(() => {});
        }
      }
    } catch {
      // Silencioso si la BD aún no está migrada
    }
  };

  // Comprobación periódica cada 15 minutos
  setInterval(runTick, 15 * 60_000).unref();
}
