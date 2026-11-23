import { LeagueId, MatchRecord } from '../types/football';
import { computePoissonScoreMatrix, removeBookmakerMargin } from './previewMath';

export interface CsvParseResult {
  matches: MatchRecord[];
  errors: string[];
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
  'date,kickoff,league,home_team,away_team,lambda_home,lambda_away,odds_home,odds_draw,odds_away,bookmaker',
  '2026-11-24,20:00,premier_league,Arsenal,Chelsea,1.72,1.18,1.95,3.60,3.90,CSV_Import',
  '2026-11-24,21:00,laliga,Real Madrid,Real Sociedad,1.88,0.92,1.52,4.35,6.20,CSV_Import',
].join('\n');

export function parseMatchesCsv(rawText: string): CsvParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return {
      matches: [],
      errors: ['El archivo CSV debe incluir cabecera y al menos una fila de datos.'],
      rowsProcessed: 0,
    };
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const iDate = idx('date') !== -1 ? idx('date') : idx('fecha');
  const iKickoff = idx('kickoff') !== -1 ? idx('kickoff') : idx('hora');
  const iLeague = idx('league') !== -1 ? idx('league') : idx('div');
  const iHome = idx('home_team') !== -1 ? idx('home_team') : idx('hometeam');
  const iAway = idx('away_team') !== -1 ? idx('away_team') : idx('awayteam');
  const iLambdaH = idx('lambda_home');
  const iLambdaA = idx('lambda_away');
  const iOddsH = idx('odds_home') !== -1 ? idx('odds_home') : idx('b365h');
  const iOddsD = idx('odds_draw') !== -1 ? idx('odds_draw') : idx('b365d');
  const iOddsA = idx('odds_away') !== -1 ? idx('odds_away') : idx('b365a');
  const iBookmaker = idx('bookmaker');

  if (iHome === -1 || iAway === -1) {
    return {
      matches: [],
      errors: [
        'Cabeceras requeridas no encontradas: se necesita home_team/HomeTeam y away_team/AwayTeam.',
      ],
      rowsProcessed: 0,
    };
  }

  const matches: MatchRecord[] = [];
  const errors: string[] = [];

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cols = lines[rowIndex].split(',').map((c) => c.trim());
    const homeTeam = cols[iHome];
    const awayTeam = cols[iAway];
    if (!homeTeam || !awayTeam) {
      errors.push(`Fila ${rowIndex + 1}: nombre de equipo local o visitante vacío.`);
      continue;
    }

    const rawLeague = iLeague !== -1 ? (cols[iLeague] || '').toLowerCase() : 'premier_league';
    const leagueId: LeagueId = VALID_LEAGUES[rawLeague] ?? 'premier_league';

    const dateVal = iDate !== -1 && cols[iDate] ? cols[iDate] : new Date().toISOString().slice(0, 10);
    const kickoffVal = iKickoff !== -1 && cols[iKickoff] ? cols[iKickoff] : '20:00';

    const lhRaw = iLambdaH !== -1 ? parseFloat(cols[iLambdaH]) : NaN;
    const laRaw = iLambdaA !== -1 ? parseFloat(cols[iLambdaA]) : NaN;
    const hasCustomLambdas = !Number.isNaN(lhRaw) && !Number.isNaN(laRaw) && lhRaw > 0 && laRaw > 0;
    const lambdaHome = hasCustomLambdas ? lhRaw : 1.45;
    const lambdaAway = hasCustomLambdas ? laRaw : 1.15;

    const oh = iOddsH !== -1 ? parseFloat(cols[iOddsH]) : NaN;
    const od = iOddsD !== -1 ? parseFloat(cols[iOddsD]) : NaN;
    const oa = iOddsA !== -1 ? parseFloat(cols[iOddsA]) : NaN;
    const hasOdds = !Number.isNaN(oh) && !Number.isNaN(od) && !Number.isNaN(oa) && oh > 1 && od > 1 && oa > 1;

    const poissonResult = computePoissonScoreMatrix(lambdaHome, lambdaAway).threeWay;
    const deVigged = hasOdds ? removeBookmakerMargin([oh, od, oa]).fairProbs : null;
    const marketDeVigged = deVigged
      ? { home: deVigged[0], draw: deVigged[1], away: deVigged[2] }
      : null;

    const missingNotes: string[] = [];
    if (!hasCustomLambdas) {
      missingNotes.push('Sin xG/lambdas en CSV: usando tasa base neutra hasta Fase 3-5.');
    }
    if (!hasOdds) {
      missingNotes.push('Sin cuotas decimales válidas en CSV: Value Finder deshabilitado para este partido.');
    }
    missingNotes.push('Importado por CSV sin perfiles detallados de lesiones o alineaciones.');

    const completeness = (hasCustomLambdas ? 45 : 25) + (hasOdds ? 20 : 0);

    matches.push({
      id: `csv_${rowIndex}_${homeTeam.toLowerCase().replace(/\s+/g, '_')}`,
      leagueId,
      date: dateVal,
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
        'Registro importado desde CSV externo (solo modelo base Poisson disponible sin histórico BD).',
      ],
    });
  }

  return {
    matches,
    errors,
    rowsProcessed: lines.length - 1,
  };
}
