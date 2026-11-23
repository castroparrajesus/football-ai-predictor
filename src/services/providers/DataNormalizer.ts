import { LeagueId } from '../../types/football.ts';

const TEAM_ALIAS_MAP: Record<string, string> = {
  'fc internazionale milano': 'inter',
  'inter milan': 'inter',
  internazionale: 'inter',
  'ac milan': 'milan',
  'as roma': 'roma',
  'ssc napoli': 'napoli',
  'ss lazio': 'lazio',
  'juventus fc': 'juventus',
  'atalanta bc': 'atalanta',
  'acf fiorentina': 'fiorentina',
  'bologna fc 1909': 'bologna',
  'paris saint germain fc': 'paris saint germain',
  'paris saint germain': 'paris saint germain',
  psg: 'paris saint germain',
  'olympique de marseille': 'marseille',
  'olympique lyonnais': 'lyon',
  'as monaco fc': 'monaco',
  'losc lille': 'lille',
  'ogc nice': 'nice',
  'stade rennais fc 1901': 'rennes',
  'fc bayern munchen': 'bayern munich',
  'bayern munchen': 'bayern munich',
  'bayern munich': 'bayern munich',
  'borussia dortmund': 'dortmund',
  'bayer 04 leverkusen': 'bayer leverkusen',
  'rb leipzig': 'rb leipzig',
  'vfb stuttgart': 'stuttgart',
  'eintracht frankfurt': 'eintracht frankfurt',
  'arsenal fc': 'arsenal',
  'chelsea fc': 'chelsea',
  'liverpool fc': 'liverpool',
  'manchester city fc': 'manchester city',
  'manchester united fc': 'manchester united',
  'man utd': 'manchester united',
  'tottenham hotspur fc': 'tottenham',
  'tottenham hotspur': 'tottenham',
  'newcastle united fc': 'newcastle',
  'aston villa fc': 'aston villa',
  'brighton hove albion fc': 'brighton',
  'brighton and hove albion': 'brighton',
  'west ham united fc': 'west ham',
  'wolverhampton wanderers fc': 'wolves',
  'nottingham forest fc': 'nottingham forest',
  'real madrid cf': 'real madrid',
  'fc barcelona': 'barcelona',
  'club atletico de madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'athletic club': 'athletic bilbao',
  'real sociedad de futbol': 'real sociedad',
  'real betis balompie': 'real betis',
  'villarreal cf': 'villarreal',
  'sevilla fc': 'sevilla',
  'valencia cf': 'valencia',
  'girona fc': 'girona',
};

export function normalizeTeamNameKey(rawName: string): string {
  const stripped = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (TEAM_ALIAS_MAP[stripped]) {
    return TEAM_ALIAS_MAP[stripped];
  }

  // Remover sufijos comunes (FC, CF, SC, AC, BC, 1899, etc.) si no está en el diccionario
  const cleaned = stripped
    .replace(/\b(fc|cf|sc|ac|bc|afc|rcd|ud|cd|sd|ssc|acf|ogc|losc|vfb|vfl|tsg|sv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return TEAM_ALIAS_MAP[cleaned] ?? (cleaned || stripped);
}

export function buildCanonicalTeamId(leagueId: LeagueId, teamName: string): string {
  const key = normalizeTeamNameKey(teamName).replace(/\s+/g, '_');
  return `${leagueId}_${key}`.slice(0, 90);
}

export function deriveSeasonIdFromDate(isoDate: string): string {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return '2026-2027';
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export function seasonStartYearFromDate(now = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

/**
 * Calcula tasas esperadas Poisson (lambda) exclusivamente cuando existen al menos 3 partidos reales jugados
 * en `team_season_stats`. Si no hay datos suficientes, devuelve null (sin inventar valores).
 */
export function computeRealPoissonLambdas(params: {
  homePlayed: number;
  homeGf: number;
  homeGa: number;
  awayPlayed: number;
  awayGf: number;
  awayGa: number;
  leagueAvgGoalsPerTeam?: number;
}): { lambdaHome: number | null; lambdaAway: number | null } {
  if (params.homePlayed < 3 || params.awayPlayed < 3) {
    return { lambdaHome: null, lambdaAway: null };
  }
  const leagueAvg = params.leagueAvgGoalsPerTeam ?? 1.38;
  const homeAttack = params.homeGf / params.homePlayed / leagueAvg;
  const homeDefense = params.homeGa / params.homePlayed / leagueAvg;
  const awayAttack = params.awayGf / params.awayPlayed / leagueAvg;
  const awayDefense = params.awayGa / params.awayPlayed / leagueAvg;

  // Factor suave de localía empírica (~1.08 local, ~0.92 visitante) sobre promedio real
  const lambdaHome = Math.max(0.25, Math.min(4.5, homeAttack * awayDefense * leagueAvg * 1.06));
  const lambdaAway = Math.max(0.2, Math.min(4.0, awayAttack * homeDefense * leagueAvg * 0.94));

  return {
    lambdaHome: Number(lambdaHome.toFixed(3)),
    lambdaAway: Number(lambdaAway.toFixed(3)),
  };
}
