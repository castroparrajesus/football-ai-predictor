import {
  EnsembleWeights,
  LeagueId,
  MatchMarketsAnalysis,
  ScoreMatrixCell,
  ThreeWayProbabilities,
} from '../../types/football.ts';
import { poissonPmf } from '../../utils/previewMath.ts';
import { normalizeThreeWay } from './calibration.ts';

export interface HistoricalMatchSample {
  id: string;
  leagueId: LeagueId;
  seasonId: string;
  kickoffMs: number;
  kickoffIso: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number;
  awayGoals: number;
  outcome: 'H' | 'D' | 'A';
  odds1X2: { home: number; draw: number; away: number; bookmaker: string } | null;
  oddsOu25: { over25?: number; under25?: number } | null;
}

export interface TeamChronoRecord {
  kickoffMs: number;
  seasonId: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  opponentElo: number;
}

export interface ChronoState {
  eloByTeam: Map<string, number>;
  lastSeasonByTeam: Map<string, string>;
  historyByTeam: Map<string, TeamChronoRecord[]>;
  leagueStats: Map<
    string,
    {
      matches: number;
      homeGoals: number;
      awayGoals: number;
      draws: number;
      lastSeasonId: string;
    }
  >;
}

export function createChronoState(): ChronoState {
  return {
    eloByTeam: new Map(),
    lastSeasonByTeam: new Map(),
    historyByTeam: new Map(),
    leagueStats: new Map(),
  };
}

export function updateChronoStateWithMatch(
  state: ChronoState,
  m: HistoricalMatchSample
): void {
  const prevHomeSeason = state.lastSeasonByTeam.get(m.homeTeamId);
  const prevAwaySeason = state.lastSeasonByTeam.get(m.awayTeamId);

  // Regresión suave a la media (25% hacia 1500) al cambiar de temporada
  let eloHome = state.eloByTeam.get(m.homeTeamId) ?? 1500;
  if (prevHomeSeason && prevHomeSeason !== m.seasonId) {
    eloHome = eloHome * 0.75 + 1500 * 0.25;
  }
  let eloAway = state.eloByTeam.get(m.awayTeamId) ?? 1500;
  if (prevAwaySeason && prevAwaySeason !== m.seasonId) {
    eloAway = eloAway * 0.75 + 1500 * 0.25;
  }

  state.lastSeasonByTeam.set(m.homeTeamId, m.seasonId);
  state.lastSeasonByTeam.set(m.awayTeamId, m.seasonId);

  const homeHistory = state.historyByTeam.get(m.homeTeamId) ?? [];
  const awayHistory = state.historyByTeam.get(m.awayTeamId) ?? [];

  const homePts = m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
  const awayPts = m.awayGoals > m.homeGoals ? 3 : m.awayGoals === m.homeGoals ? 1 : 0;

  homeHistory.push({
    kickoffMs: m.kickoffMs,
    seasonId: m.seasonId,
    isHome: true,
    goalsFor: m.homeGoals,
    goalsAgainst: m.awayGoals,
    points: homePts,
    opponentElo: eloAway,
  });

  awayHistory.push({
    kickoffMs: m.kickoffMs,
    seasonId: m.seasonId,
    isHome: false,
    goalsFor: m.awayGoals,
    goalsAgainst: m.homeGoals,
    points: awayPts,
    opponentElo: eloHome,
  });

  state.historyByTeam.set(m.homeTeamId, homeHistory);
  state.historyByTeam.set(m.awayTeamId, awayHistory);

  // Actualización Elo dinámico (con factor por diferencia de goles y localía HFA=65)
  const HFA = 65;
  const expectedHome = 1 / (1 + Math.pow(10, (eloAway - (eloHome + HFA)) / 400));
  const actualHome = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0;
  const gd = Math.abs(m.homeGoals - m.awayGoals);
  const movMultiplier = gd <= 1 ? 1 : 1 + Math.log(gd + 1) * 0.45;
  const K = 22 * movMultiplier;

  state.eloByTeam.set(m.homeTeamId, eloHome + K * (actualHome - expectedHome));
  state.eloByTeam.set(m.awayTeamId, eloAway + K * (expectedHome - actualHome));

  const lg = state.leagueStats.get(m.leagueId) ?? {
    matches: 0,
    homeGoals: 0,
    awayGoals: 0,
    draws: 0,
    lastSeasonId: m.seasonId,
  };
  lg.matches += 1;
  lg.homeGoals += m.homeGoals;
  lg.awayGoals += m.awayGoals;
  if (m.homeGoals === m.awayGoals) lg.draws += 1;
  lg.lastSeasonId = m.seasonId;
  state.leagueStats.set(m.leagueId, lg);
}

export interface PreMatchFeatureVector {
  features: number[]; // [bias, eloDiffScaled, homeAttVsAwayDef, awayAttVsHomeDef, formDiff, venueSplitDiff, restDiffScaled, gdDiff]
  homePlayed: number;
  awayPlayed: number;
  homeElo: number;
  awayElo: number;
  lambdaHome: number;
  lambdaAway: number;
  homeLast5Ppg: number;
  awayLast5Ppg: number;
  homeRestDays: number | null;
  awayRestDays: number | null;
  homeVenueWinRate: number;
  awayVenueWinRate: number;
  leagueDrawRate: number;
}

const MS_PER_DAY = 86_400_000;

export function extractPreMatchFeatures(
  state: ChronoState,
  params: {
    leagueId: LeagueId;
    homeTeamId: string;
    awayTeamId: string;
    kickoffMs: number;
  }
): PreMatchFeatureVector {
  const homeElo = state.eloByTeam.get(params.homeTeamId) ?? 1500;
  const awayElo = state.eloByTeam.get(params.awayTeamId) ?? 1500;
  const homeHist = state.historyByTeam.get(params.homeTeamId) ?? [];
  const awayHist = state.historyByTeam.get(params.awayTeamId) ?? [];

  const lg = state.leagueStats.get(params.leagueId);
  const leagueAvgHome = lg && lg.matches >= 10 ? lg.homeGoals / lg.matches : 1.48;
  const leagueAvgAway = lg && lg.matches >= 10 ? lg.awayGoals / lg.matches : 1.18;
  const leagueAvgGoal = (leagueAvgHome + leagueAvgAway) / 2;
  const leagueDrawRate = lg && lg.matches >= 10 ? lg.draws / lg.matches : 0.26;

  // Ponderación exponencial temporal (semivida ~120 días) con regularización Bayesiana (prior = 5 partidos neutros)
  const decayRate = 0.0055;
  const computeWeightedRates = (hist: TeamChronoRecord[]) => {
    let wSum = 0;
    let gfSum = 0;
    let gaSum = 0;
    for (const r of hist) {
      const daysAgo = Math.max(0, (params.kickoffMs - r.kickoffMs) / MS_PER_DAY);
      const w = Math.exp(-decayRate * daysAgo);
      wSum += w;
      gfSum += w * r.goalsFor;
      gaSum += w * r.goalsAgainst;
    }
    const priorWeight = 5;
    const attackRate = (gfSum + priorWeight * leagueAvgGoal) / (wSum + priorWeight);
    const defenseRate = (gaSum + priorWeight * leagueAvgGoal) / (wSum + priorWeight);
    return {
      attackIndex: attackRate / Math.max(0.4, leagueAvgGoal),
      defenseIndex: defenseRate / Math.max(0.4, leagueAvgGoal),
    };
  };

  const homeRates = computeWeightedRates(homeHist);
  const awayRates = computeWeightedRates(awayHist);

  // Lambdas combinando tasa de liga local/visitante con índices ataque/defensa pre-partido
  const rawLambdaHome = homeRates.attackIndex * awayRates.defenseIndex * leagueAvgHome;
  const rawLambdaAway = awayRates.attackIndex * homeRates.defenseIndex * leagueAvgAway;
  const lambdaHome = Math.max(0.25, Math.min(4.2, rawLambdaHome));
  const lambdaAway = Math.max(0.2, Math.min(3.8, rawLambdaAway));

  const last5 = (hist: TeamChronoRecord[]) => {
    const slice = hist.slice(-5);
    if (slice.length === 0) return 1.35;
    return slice.reduce((s, r) => s + r.points, 0) / slice.length;
  };
  const homeLast5Ppg = last5(homeHist);
  const awayLast5Ppg = last5(awayHist);

  const venueWinRate = (hist: TeamChronoRecord[], wantHome: boolean) => {
    const split = hist.filter((r) => r.isHome === wantHome).slice(-12);
    if (split.length === 0) return wantHome ? 0.44 : 0.28;
    const wins = split.filter((r) => r.points === 3).length;
    return (wins + 1.5) / (split.length + 4); // suavizado Laplace
  };
  const homeVenueWinRate = venueWinRate(homeHist, true);
  const awayVenueWinRate = venueWinRate(awayHist, false);

  const restDays = (hist: TeamChronoRecord[]) => {
    if (hist.length === 0) return null;
    const prev = hist[hist.length - 1];
    const diff = (params.kickoffMs - prev.kickoffMs) / MS_PER_DAY;
    if (diff < 0 || diff > 45) return null;
    return Math.round(diff);
  };
  const homeRestDays = restDays(homeHist);
  const awayRestDays = restDays(awayHist);
  const restDiff =
    homeRestDays !== null && awayRestDays !== null
      ? Math.max(-7, Math.min(7, homeRestDays - awayRestDays)) / 7
      : 0;

  const gdPerGame = (hist: TeamChronoRecord[]) => {
    const slice = hist.slice(-15);
    if (slice.length === 0) return 0;
    return slice.reduce((s, r) => s + (r.goalsFor - r.goalsAgainst), 0) / slice.length;
  };

  return {
    features: [
      1,
      (homeElo - awayElo) / 200,
      lambdaHome - leagueAvgHome,
      lambdaAway - leagueAvgAway,
      (homeLast5Ppg - awayLast5Ppg) / 3,
      homeVenueWinRate - awayVenueWinRate,
      restDiff,
      (gdPerGame(homeHist) - gdPerGame(awayHist)) / 2,
    ],
    homePlayed: homeHist.length,
    awayPlayed: awayHist.length,
    homeElo,
    awayElo,
    lambdaHome: Number(lambdaHome.toFixed(3)),
    lambdaAway: Number(lambdaAway.toFixed(3)),
    homeLast5Ppg: Number(homeLast5Ppg.toFixed(2)),
    awayLast5Ppg: Number(awayLast5Ppg.toFixed(2)),
    homeRestDays,
    awayRestDays,
    homeVenueWinRate: Number(homeVenueWinRate.toFixed(3)),
    awayVenueWinRate: Number(awayVenueWinRate.toFixed(3)),
    leagueDrawRate,
  };
}

/**
 * Factor de correlación bivariada Dixon-Coles (1997) para marcadores bajos (0-0, 1-0, 0-1, 1-1).
 */
export function dixonColesTau(
  hg: number,
  ag: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number {
  if (hg === 0 && ag === 0) return Math.max(0.05, 1 - lambdaHome * lambdaAway * rho);
  if (hg === 1 && ag === 0) return Math.max(0.05, 1 + lambdaAway * rho);
  if (hg === 0 && ag === 1) return Math.max(0.05, 1 + lambdaHome * rho);
  if (hg === 1 && ag === 1) return Math.max(0.05, 1 - rho);
  return 1;
}

export function computeDixonColesMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho = -0.09,
  maxGoals = 6
): {
  matrix: ScoreMatrixCell[];
  threeWay: ThreeWayProbabilities;
  markets: MatchMarketsAnalysis;
} {
  const matrix: ScoreMatrixCell[] = [];
  let totalMass = 0;

  for (let hg = 0; hg <= maxGoals; hg += 1) {
    const ph = poissonPmf(hg, lambdaHome);
    for (let ag = 0; ag <= maxGoals; ag += 1) {
      const pa = poissonPmf(ag, lambdaAway);
      const tau = dixonColesTau(hg, ag, lambdaHome, lambdaAway, rho);
      const prob = ph * pa * tau;
      totalMass += prob;
      matrix.push({ homeGoals: hg, awayGoals: ag, probability: prob });
    }
  }

  const norm = totalMass > 0 ? 1 / totalMass : 1;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let o05 = 0;
  let o15 = 0;
  let o25 = 0;
  let o35 = 0;
  let o45 = 0;
  let btts = 0;
  let ho05 = 0;
  let ho15 = 0;
  let ho25 = 0;
  let ao05 = 0;
  let ao15 = 0;
  let ao25 = 0;

  const normalized = matrix.map((cell) => {
    const p = cell.probability * norm;
    if (cell.homeGoals > cell.awayGoals) pHome += p;
    else if (cell.homeGoals === cell.awayGoals) pDraw += p;
    else pAway += p;

    const tot = cell.homeGoals + cell.awayGoals;
    if (tot > 0) o05 += p;
    if (tot > 1) o15 += p;
    if (tot > 2) o25 += p;
    if (tot > 3) o35 += p;
    if (tot > 4) o45 += p;
    if (cell.homeGoals > 0 && cell.awayGoals > 0) btts += p;

    if (cell.homeGoals > 0) ho05 += p;
    if (cell.homeGoals > 1) ho15 += p;
    if (cell.homeGoals > 2) ho25 += p;

    if (cell.awayGoals > 0) ao05 += p;
    if (cell.awayGoals > 1) ao15 += p;
    if (cell.awayGoals > 2) ao25 += p;

    return { ...cell, probability: p };
  });

  return {
    matrix: normalized,
    threeWay: normalizeThreeWay({ home: pHome, draw: pDraw, away: pAway }),
    markets: {
      result: {
        homeWin: pHome,
        draw: pDraw,
        awayWin: pAway,
        dc1X: pHome + pDraw,
        dcX2: pDraw + pAway,
        dc12: pHome + pAway,
      },
      goals: {
        over05: o05,
        over15: o15,
        over25: o25,
        over35: o35,
        over45: o45,
        under15: 1 - o15,
        under25: 1 - o25,
        under35: 1 - o35,
        under45: 1 - o45,
        bttsYes: btts,
        bttsNo: 1 - btts,
      },
      teamGoals: {
        homeOver05: ho05,
        homeOver15: ho15,
        homeOver25: ho25,
        awayOver05: ao05,
        awayOver15: ao15,
        awayOver25: ao25,
      },
      corners: {
        available: false,
        expectedTotal: null,
        expectedHome: null,
        expectedAway: null,
        over95Prob: null,
        under95Prob: null,
      },
      cards: {
        available: false,
        expectedTotal: null,
        expectedHome: null,
        expectedAway: null,
        disciplinaryRisk: null,
      },
    },
  };
}

/**
 * Optimiza el parámetro rho de Dixon-Coles por búsqueda en malla sobre pares (lambdaH, lambdaA, hg, ag)
 * dentro de la ventana cronológica de entrenamiento.
 */
export function fitDixonColesRho(
  samples: { lambdaHome: number; lambdaAway: number; hg: number; ag: number }[]
): number {
  if (samples.length < 40) return -0.08;
  let bestRho = -0.08;
  let bestLl = -Infinity;

  for (let rho = -0.22; rho <= 0.1; rho += 0.02) {
    let ll = 0;
    for (const s of samples) {
      if (s.hg <= 1 && s.ag <= 1) {
        const tau = dixonColesTau(s.hg, s.ag, s.lambdaHome, s.lambdaAway, rho);
        ll += Math.log(Math.max(1e-6, tau));
      }
    }
    if (ll > bestLl) {
      bestLl = ll;
      bestRho = rho;
    }
  }

  return Number(bestRho.toFixed(3));
}

/**
 * Convierte diferencial Elo (incluyendo ventaja de localía) a probabilidades 1X2 (Davidson + base de empate de liga).
 */
export function predictEloThreeWay(
  homeElo: number,
  awayElo: number,
  leagueDrawRate = 0.26
): ThreeWayProbabilities {
  const HFA = 65;
  const diff = homeElo + HFA - awayElo;
  const winExp = 1 / (1 + Math.pow(10, -diff / 400));

  // El empate decae suavemente cuando la brecha Elo es amplia
  const closeness = Math.exp(-Math.pow(diff / 340, 2));
  const draw = Math.max(0.14, Math.min(0.34, leagueDrawRate * (0.72 + 0.42 * closeness)));
  const remaining = 1 - draw;
  return normalizeThreeWay({
    home: remaining * winExp,
    draw,
    away: remaining * (1 - winExp),
  });
}

/**
 * Modelo basado en estadísticas ofensivas/defensivas + localía + forma reciente + descanso.
 */
export function predictOffDefStatsThreeWay(
  fv: PreMatchFeatureVector
): ThreeWayProbabilities {
  const formScore = (fv.homeLast5Ppg - fv.awayLast5Ppg) * 0.08;
  const splitScore = (fv.homeVenueWinRate - fv.awayVenueWinRate) * 0.55;
  const lambdaEdge = (fv.lambdaHome - fv.lambdaAway) * 0.18;
  const restBoost = fv.features[6] * 0.04;

  const strength = lambdaEdge + splitScore + formScore + restBoost;
  const baseHome = 0.44 + strength * 0.35;
  const baseAway = 0.29 - strength * 0.32;
  const closeness = Math.exp(-Math.pow(strength * 1.4, 2));
  const baseDraw = Math.max(0.18, Math.min(0.32, fv.leagueDrawRate * (0.85 + 0.25 * closeness)));

  return normalizeThreeWay({
    home: Math.max(0.06, baseHome),
    draw: baseDraw,
    away: Math.max(0.06, baseAway),
  });
}

export interface SoftmaxMlModel {
  featureCount: number;
  weights: number[][]; // 3 clases [H, D, A] x featureCount
  trainedSamples: number;
}

export function createDefaultSoftmaxMlModel(): SoftmaxMlModel {
  // Pesos iniciales neutros antes de entrenar (prioriza sesgo empírico 1X2 + Elo + lambdas)
  return {
    featureCount: 8,
    weights: [
      [0.35, 0.45, 0.35, -0.3, 0.2, 0.25, 0.05, 0.2],
      [-0.1, 0.0, -0.1, -0.1, 0.0, 0.0, 0.0, 0.0],
      [0.0, -0.45, -0.35, 0.3, -0.2, -0.25, -0.05, -0.2],
    ],
    trainedSamples: 0,
  };
}

function softmaxLogits(logits: number[]): [number, number, number] {
  const maxL = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(Math.max(-30, Math.min(30, l - maxL))));
  const sum = exps[0] + exps[1] + exps[2];
  return [exps[0] / sum, exps[1] / sum, exps[2] / sum];
}

export function fitSoftmaxMlModel(
  samples: { features: number[]; outcome: 'H' | 'D' | 'A' }[]
): SoftmaxMlModel {
  if (samples.length < 35) {
    return createDefaultSoftmaxMlModel();
  }

  const featureCount = samples[0].features.length;
  const weights: number[][] = [
    new Array(featureCount).fill(0),
    new Array(featureCount).fill(0),
    new Array(featureCount).fill(0),
  ];

  const lr = 0.12;
  const l2 = 0.03;
  const n = samples.length;

  for (let epoch = 0; epoch < 260; epoch += 1) {
    const grads: number[][] = [
      new Array(featureCount).fill(0),
      new Array(featureCount).fill(0),
      new Array(featureCount).fill(0),
    ];

    for (let i = 0; i < n; i += 1) {
      const x = samples[i].features;
      const logits = [0, 1, 2].map((c) =>
        x.reduce((sum, xj, j) => sum + weights[c][j] * xj, 0)
      );
      const probs = softmaxLogits(logits);
      const yIdx = samples[i].outcome === 'H' ? 0 : samples[i].outcome === 'D' ? 1 : 2;

      for (let c = 0; c < 3; c += 1) {
        const err = probs[c] - (c === yIdx ? 1 : 0);
        for (let j = 0; j < featureCount; j += 1) {
          grads[c][j] += err * x[j];
        }
      }
    }

    for (let c = 0; c < 3; c += 1) {
      for (let j = 0; j < featureCount; j += 1) {
        const reg = j === 0 ? 0 : l2 * weights[c][j];
        weights[c][j] -= lr * (grads[c][j] / n + reg);
      }
    }
  }

  return {
    featureCount,
    weights: weights.map((row) => row.map((v) => Number(v.toFixed(5)))),
    trainedSamples: n,
  };
}

export function predictSoftmaxMl(
  features: number[],
  model: SoftmaxMlModel
): ThreeWayProbabilities {
  const logits = [0, 1, 2].map((c) =>
    features.reduce((sum, xj, j) => sum + (model.weights[c]?.[j] ?? 0) * xj, 0)
  );
  const [home, draw, away] = softmaxLogits(logits);
  return normalizeThreeWay({ home, draw, away });
}

export function computeWeightedEnsemble(
  models: {
    poisson: ThreeWayProbabilities;
    dixonColes: ThreeWayProbabilities;
    elo: ThreeWayProbabilities;
    machineLearning: ThreeWayProbabilities;
    statsOffDef: ThreeWayProbabilities;
  },
  weights: EnsembleWeights
): ThreeWayProbabilities {
  // Combinamos poisson + dixonColes bajo el bloque Poisson (60% DC, 40% Poisson independiente)
  const poissonBlend: ThreeWayProbabilities = {
    home: models.dixonColes.home * 0.65 + models.poisson.home * 0.35,
    draw: models.dixonColes.draw * 0.65 + models.poisson.draw * 0.35,
    away: models.dixonColes.away * 0.65 + models.poisson.away * 0.35,
  };

  const wP = weights.poisson;
  const wE = weights.elo;
  const wMl = weights.machineLearning;
  const wStats = weights.recentForm + weights.homeAway;
  const tot = wP + wE + wMl + wStats;

  if (tot <= 0) return poissonBlend;

  return normalizeThreeWay({
    home:
      (poissonBlend.home * wP +
        models.elo.home * wE +
        models.machineLearning.home * wMl +
        models.statsOffDef.home * wStats) /
      tot,
    draw:
      (poissonBlend.draw * wP +
        models.elo.draw * wE +
        models.machineLearning.draw * wMl +
        models.statsOffDef.draw * wStats) /
      tot,
    away:
      (poissonBlend.away * wP +
        models.elo.away * wE +
        models.machineLearning.away * wMl +
        models.statsOffDef.away * wStats) /
      tot,
  });
}

export function computeModelSpreadPp(probsList: ThreeWayProbabilities[]): number {
  if (probsList.length < 2) return 0;
  let maxSpread = 0;
  for (const key of ['home', 'draw', 'away'] as const) {
    const vals = probsList.map((p) => p[key]);
    const diff = (Math.max(...vals) - Math.min(...vals)) * 100;
    if (diff > maxSpread) maxSpread = diff;
  }
  return Number(maxSpread.toFixed(1));
}
