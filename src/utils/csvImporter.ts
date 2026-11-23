import { LeagueId, MatchRecord } from '../types/football';
import { computePoissonScoreMatrix, removeBookmakerMargin } from './previewMath';

export interface ParsedCsvRowForDb {
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

export interface CsvRowError {
  rowNumber: number;
  reason: string;
}

export interface CsvParseResult {
  matches: MatchRecord[];
  dbRows: ParsedCsvRowForDb[];
  errors: CsvRowError[];
  duplicateRowsCount: number;
  rowsProcessed: number;
}

const VALID_LEAGUES: Record<string, LeagueId> = {
  premier_league: 'premier_league',
  'premier league': 'premier_league',
  e0: 'premier_league',
  laliga: 'laliga',
  'la liga': 'laliga',
  sp1: 'laliga',
  serie_a: 'serie_a',
  'serie a': 'serie_a',
  i1: 'serie_a',
  bundesliga: 'bundesliga',
  d1: 'bundesliga',
  ligue_1: 'ligue_1',
  'ligue 1': 'ligue_1',
  f1: 'ligue_1',
};

export const CSV_TEMPLATE_CONTENT = [
  'date,kickoff,league,season,home_team,away_team,lambda_home,lambda_away,odds_home,odds_draw,odds_away,bookmaker,home_goals,away_goals,home_shots,away_shots,home_corners,away_corners,home_xg,away_xg',
  '2026-11-24,20:00,premier_league,2026-2027,Arsenal FC,Chelsea FC,1.72,1.18,1.95,3.60,3.90,CSV_Import,,,,,,,,',
  '2026-11-24,21:00,laliga,2026-2027,Real Madrid,Real Sociedad,1.88,0.92,1.52,4.35,6.20,CSV_Import,,,,,,,,',
].join('\n');

function normalizeDateString(raw: string): string | null {
  const val = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const dt = new Date(`${val}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? null : val;
  }
  // Soporte formato DD/MM/YYYY (habitual en football-data.co.uk)
  const slashMatch = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const iso = `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
    const dt = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? null : iso;
  }
  return null;
}

function parseOptionalInt(raw: string | undefined): number | null {
  if (!raw || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseOptionalFloat(raw: string | undefined): number | null {
  if (!raw || raw.trim() === '') return null;
  const n = parseFloat(raw);
  return !Number.isNaN(n) && n >= 0 ? n : null;
}

export function parseMatchesCsv(rawText: string): CsvParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return {
      matches: [],
      dbRows: [],
      errors: [
        {
          rowNumber: 1,
          reason: 'El archivo CSV debe incluir cabecera y al menos una fila de datos.',
        },
      ],
      duplicateRowsCount: 0,
      rowsProcessed: 0,
    };
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (...candidates: string[]) => {
    for (const c of candidates) {
      const pos = headers.indexOf(c);
      if (pos !== -1) return pos;
    }
    return -1;
  };

  const iDate = idx('date', 'fecha');
  const iKickoff = idx('kickoff', 'hora', 'time');
  const iLeague = idx('league', 'div', 'liga');
  const iSeason = idx('season', 'temporada');
  const iHome = idx('home_team', 'hometeam', 'local');
  const iAway = idx('away_team', 'awayteam', 'visitante');
  const iLambdaH = idx('lambda_home');
  const iLambdaA = idx('lambda_away');
  const iOddsH = idx('odds_home', 'b365h');
  const iOddsD = idx('odds_draw', 'b365d');
  const iOddsA = idx('odds_away', 'b365a');
  const iBookmaker = idx('bookmaker');

  const iHg = idx('home_goals', 'fthg');
  const iAg = idx('away_goals', 'ftag');
  const iHs = idx('home_shots', 'hs');
  const iAs = idx('away_shots', 'as');
  const iHst = idx('home_shots_on_target', 'hst');
  const iAst = idx('away_shots_on_target', 'ast');
  const iHc = idx('home_corners', 'hc');
  const iAc = idx('away_corners', 'ac');
  const iHy = idx('home_yellow', 'hy');
  const iAy = idx('away_yellow', 'ay');
  const iHxg = idx('home_xg');
  const iAxg = idx('away_xg');

  if (iHome === -1 || iAway === -1 || iDate === -1) {
    return {
      matches: [],
      dbRows: [],
      errors: [
        {
          rowNumber: 1,
          reason:
            'Cabeceras obligatorias no encontradas: se requiere date/Date, home_team/HomeTeam y away_team/AwayTeam.',
        },
      ],
      duplicateRowsCount: 0,
      rowsProcessed: 0,
    };
  }

  const matches: MatchRecord[] = [];
  const dbRows: ParsedCsvRowForDb[] = [];
  const errors: CsvRowError[] = [];
  const seenKeys = new Set<string>();
  let duplicateRowsCount = 0;

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const cols = lines[rowIndex].split(',').map((c) => c.trim());
    const homeTeam = cols[iHome];
    const awayTeam = cols[iAway];

    if (!homeTeam || !awayTeam) {
      errors.push({ rowNumber, reason: 'Nombre de equipo local o visitante vacío.' });
      continue;
    }

    if (homeTeam.toLowerCase() === awayTeam.toLowerCase()) {
      errors.push({ rowNumber, reason: 'El equipo local y visitante no pueden ser el mismo.' });
      continue;
    }

    const parsedDate = normalizeDateString(cols[iDate] ?? '');
    if (!parsedDate) {
      errors.push({
        rowNumber,
        reason: `Fecha inválida "${cols[iDate] ?? ''}" (usa YYYY-MM-DD o DD/MM/YYYY).`,
      });
      continue;
    }

    const rawLeague = iLeague !== -1 ? (cols[iLeague] || '').toLowerCase() : '';
    const leagueId = VALID_LEAGUES[rawLeague];
    if (!leagueId) {
      errors.push({
        rowNumber,
        reason: `Liga no reconocida "${cols[iLeague] ?? ''}". Usa premier_league, laliga, serie_a, bundesliga o ligue_1 (o códigos E0/SP1/I1/D1/F1).`,
      });
      continue;
    }

    const dedupKey = `${leagueId}|${parsedDate}|${homeTeam.toLowerCase()}|${awayTeam.toLowerCase()}`;
    if (seenKeys.has(dedupKey)) {
      duplicateRowsCount += 1;
      errors.push({
        rowNumber,
        reason: `Fila duplicada dentro del archivo: ${homeTeam} vs ${awayTeam} (${parsedDate}).`,
      });
      continue;
    }
    seenKeys.add(dedupKey);

    const rawKickoff = iKickoff !== -1 && cols[iKickoff] ? cols[iKickoff] : '20:00';
    const kickoffVal = /^\d{2}:\d{2}$/.test(rawKickoff) ? rawKickoff : '20:00';
    const seasonId = iSeason !== -1 && cols[iSeason] ? cols[iSeason] : '2026-2027';

    const lhRaw = iLambdaH !== -1 ? parseFloat(cols[iLambdaH]) : NaN;
    const laRaw = iLambdaA !== -1 ? parseFloat(cols[iLambdaA]) : NaN;
    const hasCustomLambdas = !Number.isNaN(lhRaw) && !Number.isNaN(laRaw) && lhRaw > 0 && laRaw > 0;
    const lambdaHome = hasCustomLambdas ? lhRaw : 1.45;
    const lambdaAway = hasCustomLambdas ? laRaw : 1.15;

    const oh = iOddsH !== -1 ? parseFloat(cols[iOddsH]) : NaN;
    const od = iOddsD !== -1 ? parseFloat(cols[iOddsD]) : NaN;
    const oa = iOddsA !== -1 ? parseFloat(cols[iOddsA]) : NaN;
    const hasOdds =
      !Number.isNaN(oh) && !Number.isNaN(od) && !Number.isNaN(oa) && oh > 1 && od > 1 && oa > 1;

    const poissonResult = computePoissonScoreMatrix(lambdaHome, lambdaAway).threeWay;
    const deVigged = hasOdds ? removeBookmakerMargin([oh, od, oa]).fairProbs : null;
    const marketDeVigged = deVigged
      ? { home: deVigged[0], draw: deVigged[1], away: deVigged[2] }
      : null;

    const missingNotes: string[] = [];
    if (!hasCustomLambdas) {
      missingNotes.push('Sin xG/lambdas en CSV: usando tasa base neutra.');
    }
    if (!hasOdds) {
      missingNotes.push('Sin cuotas decimales válidas en CSV.');
    }

    const completeness = (hasCustomLambdas ? 45 : 25) + (hasOdds ? 20 : 0);

    dbRows.push({
      leagueId,
      seasonId,
      date: parsedDate,
      kickoffTime: kickoffVal,
      homeTeamName: homeTeam,
      awayTeamName: awayTeam,
      lambdaHome: hasCustomLambdas ? lambdaHome : null,
      lambdaAway: hasCustomLambdas ? lambdaAway : null,
      oddsHome: hasOdds ? oh : null,
      oddsDraw: hasOdds ? od : null,
      oddsAway: hasOdds ? oa : null,
      bookmaker: iBookmaker !== -1 && cols[iBookmaker] ? cols[iBookmaker] : 'CSV_Import',
      homeGoals: iHg !== -1 ? parseOptionalInt(cols[iHg]) : null,
      awayGoals: iAg !== -1 ? parseOptionalInt(cols[iAg]) : null,
      homeShots: iHs !== -1 ? parseOptionalInt(cols[iHs]) : null,
      awayShots: iAs !== -1 ? parseOptionalInt(cols[iAs]) : null,
      homeShotsOnTarget: iHst !== -1 ? parseOptionalInt(cols[iHst]) : null,
      awayShotsOnTarget: iAst !== -1 ? parseOptionalInt(cols[iAst]) : null,
      homeCorners: iHc !== -1 ? parseOptionalInt(cols[iHc]) : null,
      awayCorners: iAc !== -1 ? parseOptionalInt(cols[iAc]) : null,
      homeYellowCards: iHy !== -1 ? parseOptionalInt(cols[iHy]) : null,
      awayYellowCards: iAy !== -1 ? parseOptionalInt(cols[iAy]) : null,
      homeXg: iHxg !== -1 ? parseOptionalFloat(cols[iHxg]) : null,
      awayXg: iAxg !== -1 ? parseOptionalFloat(cols[iAxg]) : null,
    });

    matches.push({
      id: `csv_${rowIndex}_${homeTeam.toLowerCase().replace(/\s+/g, '_')}`,
      leagueId,
      date: parsedDate,
      kickoffTime: kickoffVal,
      matchday: 0,
      homeTeamId: `csv_team_h_${rowIndex}`,
      awayTeamId: `csv_team_a_${rowIndex}`,
      homeTeamName: homeTeam,
      awayTeamName: awayTeam,
      isSynthetic: false,
      dataCompleteness: completeness,
      missingDataNotes: missingNotes,
      h2hSummary: null,
      expectedLambdaHome: lambdaHome,
      expectedLambdaAway: lambdaAway,
      odds1X2: hasOdds
        ? {
            home: oh,
            draw: od,
            away: oa,
            bookmaker: iBookmaker !== -1 && cols[iBookmaker] ? cols[iBookmaker] : 'CSV',
          }
        : null,
      extraOdds: null,
      models: {
        poisson: poissonResult,
        elo: poissonResult,
        machineLearning: poissonResult,
        recentForm: poissonResult,
        homeAway: poissonResult,
        marketDeVigged,
        ensemble: poissonResult,
        modelSpread: 0,
      },
      confidenceTier: completeness >= 60 ? 'C' : 'DESCARTADO',
      confidenceReasons: [
        'Registro importado desde CSV externo (solo modelo base Poisson disponible).',
      ],
    });
  }

  return {
    matches,
    dbRows,
    errors,
    duplicateRowsCount,
    rowsProcessed: lines.length - 1,
  };
}
