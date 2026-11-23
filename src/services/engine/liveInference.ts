import {
  ConfidenceTier,
  EnsembleWeights,
  LeagueId,
  PredictionFactor,
  ThreeWayProbabilities,
} from '../../types/football.ts';
import { computePoissonScoreMatrix } from '../../utils/previewMath.ts';
import {
  applyThreeWayCalibrator,
  computeConfidenceInterval,
  FittedCalibrator,
} from './calibration.ts';
import {
  ChronoState,
  computeDixonColesMatrix,
  computeModelSpreadPp,
  computeWeightedEnsemble,
  createChronoState,
  createDefaultSoftmaxMlModel,
  extractPreMatchFeatures,
  HistoricalMatchSample,
  predictEloThreeWay,
  predictOffDefStatsThreeWay,
  predictSoftmaxMl,
  SoftmaxMlModel,
  updateChronoStateWithMatch,
} from './models.ts';

export interface LiveInferenceResult {
  lambdaHome: number;
  lambdaAway: number;
  dixonColesRho: number;
  poisson: ThreeWayProbabilities;
  dixonColes: ThreeWayProbabilities;
  elo: ThreeWayProbabilities;
  machineLearning: ThreeWayProbabilities;
  statsOffDef: ThreeWayProbabilities;
  ensemble: ThreeWayProbabilities;
  modelSpread: number;
  homeElo: number;
  awayElo: number;
  homePlayed: number;
  awayPlayed: number;
  confidenceInterval90: {
    home: [number, number];
    draw: [number, number];
    away: [number, number];
  };
  keyFactors: PredictionFactor[];
  smallSampleWarning: string | null;
  suggestedCompletenessBoost: number;
  suggestedTier: ConfidenceTier;
}

/**
 * Construye el estado cronológico pre-partido hasta el instante anterior al primer partido consultado
 * (o secuencialmente para cada partido) garantizando ausencia de data leakage.
 */
export function buildChronoStateUpTo(
  finishedMatchesAsc: HistoricalMatchSample[],
  cutoffMs: number
): ChronoState {
  const state = createChronoState();
  for (const m of finishedMatchesAsc) {
    if (m.kickoffMs >= cutoffMs) break;
    updateChronoStateWithMatch(state, m);
  }
  return state;
}

export function runMatchInference(params: {
  state: ChronoState;
  leagueId: LeagueId;
  homeTeamId: string;
  awayTeamId: string;
  kickoffMs: number;
  hasOdds: boolean;
  weights: EnsembleWeights;
  rho?: number;
  mlModel?: SoftmaxMlModel;
  calibrator?: FittedCalibrator | null;
}): LiveInferenceResult {
  const rho = params.rho ?? -0.09;
  const mlModel = params.mlModel ?? createDefaultSoftmaxMlModel();

  const fv = extractPreMatchFeatures(params.state, {
    leagueId: params.leagueId,
    homeTeamId: params.homeTeamId,
    awayTeamId: params.awayTeamId,
    kickoffMs: params.kickoffMs,
  });

  const poisson = computePoissonScoreMatrix(fv.lambdaHome, fv.lambdaAway).threeWay;
  const dixonColes = computeDixonColesMatrix(fv.lambdaHome, fv.lambdaAway, rho).threeWay;
  const elo = predictEloThreeWay(fv.homeElo, fv.awayElo, fv.leagueDrawRate);
  const statsOffDef = predictOffDefStatsThreeWay(fv);
  const machineLearning = predictSoftmaxMl(fv.features, mlModel);

  const rawEnsemble = computeWeightedEnsemble(
    {
      poisson,
      dixonColes,
      elo,
      machineLearning,
      statsOffDef,
    },
    params.weights
  );

  const ensemble = applyThreeWayCalibrator(rawEnsemble, params.calibrator);
  const spread = computeModelSpreadPp([
    poisson,
    dixonColes,
    elo,
    machineLearning,
    statsOffDef,
  ]);

  const effectiveN = Math.min(fv.homePlayed, fv.awayPlayed) + 4;
  const ciHome = computeConfidenceInterval(ensemble.home, effectiveN);
  const ciDraw = computeConfidenceInterval(ensemble.draw, effectiveN);
  const ciAway = computeConfidenceInterval(ensemble.away, effectiveN);

  const eloDiff = Math.round(fv.homeElo - fv.awayElo);
  const formDiff = Number((fv.homeLast5Ppg - fv.awayLast5Ppg).toFixed(2));
  const lambdaDiff = Number((fv.lambdaHome - fv.lambdaAway).toFixed(2));

  const keyFactors: PredictionFactor[] = [
    {
      label: 'Diferencial Elo dinámico',
      value: `${eloDiff >= 0 ? '+' : ''}${eloDiff} pts (${Math.round(fv.homeElo)} vs ${Math.round(fv.awayElo)})`,
      impact: eloDiff >= 35 ? 'home' : eloDiff <= -35 ? 'away' : 'neutral',
    },
    {
      label: 'Expectativa ofensiva (λ)',
      value: `${fv.lambdaHome.toFixed(2)} vs ${fv.lambdaAway.toFixed(2)} goles`,
      impact: lambdaDiff >= 0.25 ? 'home' : lambdaDiff <= -0.25 ? 'away' : 'neutral',
    },
    {
      label: 'Forma últimos 5 partidos',
      value: `${fv.homeLast5Ppg.toFixed(2)} vs ${fv.awayLast5Ppg.toFixed(2)} pts/p`,
      impact: formDiff >= 0.4 ? 'home' : formDiff <= -0.4 ? 'away' : 'neutral',
    },
    {
      label: 'Rendimiento Casa vs Fuera',
      value: `${Math.round(fv.homeVenueWinRate * 100)}% local vs ${Math.round(fv.awayVenueWinRate * 100)}% visitante`,
      impact:
        fv.homeVenueWinRate - fv.awayVenueWinRate >= 0.12
          ? 'home'
          : fv.awayVenueWinRate - fv.homeVenueWinRate >= 0.12
          ? 'away'
          : 'neutral',
    },
    {
      label: 'Días de descanso previos',
      value:
        fv.homeRestDays !== null && fv.awayRestDays !== null
          ? `${fv.homeRestDays}d vs ${fv.awayRestDays}d`
          : 'Sin intervalo previo en ventana',
      impact:
        fv.homeRestDays !== null && fv.awayRestDays !== null
          ? fv.homeRestDays - fv.awayRestDays >= 2
            ? 'home'
            : fv.awayRestDays - fv.homeRestDays >= 2
            ? 'away'
            : 'neutral'
          : 'neutral',
    },
  ];

  const minPlayed = Math.min(fv.homePlayed, fv.awayPlayed);
  let smallSampleWarning: string | null = null;
  if (minPlayed < 5) {
    smallSampleWarning = `Muestra histórica pequeña (mínimo ${minPlayed} partidos previos en BD); intervalos de confianza ampliados.`;
  }

  // Completitud realista basada en datos disponibles (sin xG/alineaciones nunca supera ~82%)
  let completeness = 35;
  if (minPlayed >= 8) completeness += 22;
  else if (minPlayed >= 4) completeness += 14;
  if (params.hasOdds) completeness += 18;
  if (mlModel.trainedSamples >= 100) completeness += 7;
  completeness = Math.min(82, completeness);

  let suggestedTier: ConfidenceTier = 'C';
  if (minPlayed < 3) {
    suggestedTier = 'DESCARTADO';
  } else if (completeness >= 75 && spread <= 10) {
    suggestedTier = 'A';
  } else if (completeness >= 65 && spread <= 14) {
    suggestedTier = 'B';
  } else if (completeness < 45) {
    suggestedTier = 'DESCARTADO';
  }

  return {
    lambdaHome: fv.lambdaHome,
    lambdaAway: fv.lambdaAway,
    dixonColesRho: rho,
    poisson,
    dixonColes,
    elo,
    machineLearning,
    statsOffDef,
    ensemble,
    modelSpread: spread,
    homeElo: Math.round(fv.homeElo),
    awayElo: Math.round(fv.awayElo),
    homePlayed: fv.homePlayed,
    awayPlayed: fv.awayPlayed,
    confidenceInterval90: {
      home: [ciHome.lower, ciHome.upper],
      draw: [ciDraw.lower, ciDraw.upper],
      away: [ciAway.lower, ciAway.upper],
    },
    keyFactors,
    smallSampleWarning,
    suggestedCompletenessBoost: completeness,
    suggestedTier,
  };
}
