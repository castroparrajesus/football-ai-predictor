import {
  EnsembleWeights,
  MatchMarketsAnalysis,
  ScoreMatrixCell,
  TeamStatisticalProfile,
  ThreeWayProbabilities,
} from '../types/football';

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }
  return result;
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calcula matriz de marcadores (0..maxGoals x 0..maxGoals) mediante distribución de Poisson independiente
 * (Preview matemático para Fase 2 antes de incorporar Dixon-Coles en backend Fase 5).
 */
export function computePoissonScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals = 6
): {
  matrix: ScoreMatrixCell[];
  markets: MatchMarketsAnalysis;
  threeWay: ThreeWayProbabilities;
} {
  const matrix: ScoreMatrixCell[] = [];

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;

  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let over45 = 0;
  let bttsYes = 0;

  let homeOver05 = 0;
  let homeOver15 = 0;
  let homeOver25 = 0;
  let awayOver05 = 0;
  let awayOver15 = 0;
  let awayOver25 = 0;

  let totalMass = 0;

  for (let hg = 0; hg <= maxGoals; hg += 1) {
    const ph = poissonPmf(hg, lambdaHome);
    for (let ag = 0; ag <= maxGoals; ag += 1) {
      const pa = poissonPmf(ag, lambdaAway);
      const prob = ph * pa;
      totalMass += prob;
      matrix.push({ homeGoals: hg, awayGoals: ag, probability: prob });

      if (hg > ag) pHome += prob;
      else if (hg === ag) pDraw += prob;
      else pAway += prob;

      const total = hg + ag;
      if (total > 0) over05 += prob;
      if (total > 1) over15 += prob;
      if (total > 2) over25 += prob;
      if (total > 3) over35 += prob;
      if (total > 4) over45 += prob;
      if (hg > 0 && ag > 0) bttsYes += prob;

      if (hg > 0) homeOver05 += prob;
      if (hg > 1) homeOver15 += prob;
      if (hg > 2) homeOver25 += prob;

      if (ag > 0) awayOver05 += prob;
      if (ag > 1) awayOver15 += prob;
      if (ag > 2) awayOver25 += prob;
    }
  }

  // Normalizar masa truncada en maxGoals
  const norm = totalMass > 0 ? 1 / totalMass : 1;
  const normalizedMatrix = matrix.map((cell) => ({
    ...cell,
    probability: cell.probability * norm,
  }));

  const hw = pHome * norm;
  const dr = pDraw * norm;
  const aw = pAway * norm;

  const o05 = over05 * norm;
  const o15 = over15 * norm;
  const o25 = over25 * norm;
  const o35 = over35 * norm;
  const o45 = over45 * norm;
  const btts = bttsYes * norm;

  return {
    matrix: normalizedMatrix,
    threeWay: {
      home: hw,
      draw: dr,
      away: aw,
    },
    markets: {
      result: {
        homeWin: hw,
        draw: dr,
        awayWin: aw,
        dc1X: hw + dr,
        dcX2: dr + aw,
        dc12: hw + aw,
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
        homeOver05: homeOver05 * norm,
        homeOver15: homeOver15 * norm,
        homeOver25: homeOver25 * norm,
        awayOver05: awayOver05 * norm,
        awayOver15: awayOver15 * norm,
        awayOver25: awayOver25 * norm,
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
 * Estima mercados de córners y tarjetas solo cuando ambos equipos poseen promedios válidos.
 */
export function estimateAuxMarkets(
  homeTeam: TeamStatisticalProfile | undefined,
  awayTeam: TeamStatisticalProfile | undefined
): Pick<MatchMarketsAnalysis, 'corners' | 'cards'> {
  const hasCorners =
    homeTeam?.cornersForAvg != null &&
    homeTeam?.cornersAgainstAvg != null &&
    awayTeam?.cornersForAvg != null &&
    awayTeam?.cornersAgainstAvg != null;

  const corners = hasCorners && homeTeam && awayTeam
    ? (() => {
        const expHome = ((homeTeam.cornersForAvg! + awayTeam.cornersAgainstAvg!) / 2) * 1.04;
        const expAway = ((awayTeam.cornersForAvg! + homeTeam.cornersAgainstAvg!) / 2) * 0.96;
        const expTotal = expHome + expAway;
        // Aproximación Poisson para línea 9.5 córners
        let under95 = 0;
        for (let c = 0; c <= 9; c += 1) {
          under95 += poissonPmf(c, expTotal);
        }
        return {
          available: true,
          expectedTotal: Number(expTotal.toFixed(2)),
          expectedHome: Number(expHome.toFixed(2)),
          expectedAway: Number(expAway.toFixed(2)),
          over95Prob: Math.max(0.02, Math.min(0.98, 1 - under95)),
          under95Prob: Math.max(0.02, Math.min(0.98, under95)),
        };
      })()
    : {
        available: false,
        expectedTotal: null,
        expectedHome: null,
        expectedAway: null,
        over95Prob: null,
        under95Prob: null,
        note: 'Faltan registros de córners a favor/en contra en al menos un equipo.',
      };

  const hasCards =
    homeTeam?.yellowCardsAvg != null && awayTeam?.yellowCardsAvg != null;

  const cards = hasCards && homeTeam && awayTeam
    ? (() => {
        const expHome = homeTeam.yellowCardsAvg!;
        const expAway = awayTeam.yellowCardsAvg! * 1.06;
        const expTotal = expHome + expAway;
        const risk: 'bajo' | 'moderado' | 'alto' =
          expTotal >= 5.0 ? 'alto' : expTotal >= 3.8 ? 'moderado' : 'bajo';
        return {
          available: true,
          expectedTotal: Number(expTotal.toFixed(2)),
          expectedHome: Number(expHome.toFixed(2)),
          expectedAway: Number(expAway.toFixed(2)),
          disciplinaryRisk: risk,
        };
      })()
    : {
        available: false,
        expectedTotal: null,
        expectedHome: null,
        expectedAway: null,
        disciplinaryRisk: null,
        note: 'Faltan registros disciplinarios suficientes para estimar tarjetas.',
      };

  return { corners, cards };
}

/**
 * Elimina el margen (overround) de cuotas decimales mediante normalización multiplicativa.
 */
export function removeBookmakerMargin(oddsList: number[]): {
  rawImplied: number[];
  fairProbs: number[];
  overround: number;
} {
  const rawImplied = oddsList.map((o) => (o > 1 ? 1 / o : 0));
  const sum = rawImplied.reduce((acc, v) => acc + v, 0);
  const fairProbs = sum > 0 ? rawImplied.map((p) => p / sum) : rawImplied;
  return {
    rawImplied,
    fairProbs,
    overround: Math.max(0, sum - 1),
  };
}

/**
 * Fórmulas Sección 8:
 * - Probabilidad implícita = 1 / cuota decimal
 * - Cuota justa = 1 / probabilidad del modelo
 * - EV por unidad = (probabilidad * cuota) - 1
 */
export function calculateValueMetrics(
  modelProb: number,
  decimalOdds: number,
  deViggedImpliedProb?: number | null
) {
  const safeProb = Math.max(0.001, Math.min(0.999, modelProb));
  const impliedProb = decimalOdds > 1 ? 1 / decimalOdds : 0;
  const fairOdds = 1 / safeProb;
  const expectedValue = safeProb * decimalOdds - 1;
  const referenceMarketProb = deViggedImpliedProb ?? impliedProb;
  const edge = safeProb - referenceMarketProb;

  return {
    impliedProb,
    fairOdds,
    expectedValue,
    edge,
  };
}

export function combineEnsembleProbabilities(
  models: {
    poisson: ThreeWayProbabilities;
    elo: ThreeWayProbabilities;
    machineLearning: ThreeWayProbabilities;
    recentForm: ThreeWayProbabilities;
    homeAway: ThreeWayProbabilities;
  },
  weights: EnsembleWeights
): ThreeWayProbabilities {
  const totalWeight =
    weights.poisson +
    weights.elo +
    weights.machineLearning +
    weights.recentForm +
    weights.homeAway;

  if (totalWeight <= 0) {
    return models.poisson;
  }

  const home =
    (models.poisson.home * weights.poisson +
      models.elo.home * weights.elo +
      models.machineLearning.home * weights.machineLearning +
      models.recentForm.home * weights.recentForm +
      models.homeAway.home * weights.homeAway) /
    totalWeight;

  const draw =
    (models.poisson.draw * weights.poisson +
      models.elo.draw * weights.elo +
      models.machineLearning.draw * weights.machineLearning +
      models.recentForm.draw * weights.recentForm +
      models.homeAway.draw * weights.homeAway) /
    totalWeight;

  const away =
    (models.poisson.away * weights.poisson +
      models.elo.away * weights.elo +
      models.machineLearning.away * weights.machineLearning +
      models.recentForm.away * weights.recentForm +
      models.homeAway.away * weights.homeAway) /
    totalWeight;

  const sum = home + draw + away;
  return sum > 0
    ? { home: home / sum, draw: draw / sum, away: away / sum }
    : { home: 0.34, draw: 0.33, away: 0.33 };
}

export function computeBrierScoreBinary(predictedProb: number, outcome: 0 | 1): number {
  return Math.pow(predictedProb - outcome, 2);
}

export function computeLogLossBinary(predictedProb: number, outcome: 0 | 1): number {
  const eps = 1e-15;
  const p = Math.max(eps, Math.min(1 - eps, predictedProb));
  return -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p));
}

export function formatPct(prob: number, decimals = 1): string {
  return `${(prob * 100).toFixed(decimals)}%`;
}
