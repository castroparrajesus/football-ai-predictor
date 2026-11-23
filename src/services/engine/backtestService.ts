import { getPool } from '../../db/pool.ts';
import {
  BacktestDatasetAudit,
  BacktestFoldSummary,
  BacktestLeagueMetric,
  BacktestModelMetric,
  BacktestReproductionResult,
  BacktestRunSummary,
  CalibrationBin,
  EnsembleWeights,
  LeagueFilter,
  LeagueId,
  ThreeWayProbabilities,
} from '../../types/football.ts';
import {
  computePoissonScoreMatrix,
  removeBookmakerMargin,
} from '../../utils/previewMath.ts';
import {
  applyThreeWayCalibrator,
  buildCalibrationBinsAndEce,
  computeConfidenceInterval,
  computeMulticlassBrier,
  computeMulticlassLogLoss,
  FittedCalibrator,
  fitThreeWayCalibrator,
} from './calibration.ts';
import {
  computeDixonColesMatrix,
  computeWeightedEnsemble,
  createChronoState,
  createDefaultSoftmaxMlModel,
  extractPreMatchFeatures,
  fitDixonColesRho,
  fitSoftmaxMlModel,
  HistoricalMatchSample,
  predictEloThreeWay,
  predictOffDefStatsThreeWay,
  predictSoftmaxMl,
  SoftmaxMlModel,
  updateChronoStateWithMatch,
} from './models.ts';

export async function loadChronologicalMatches(filters?: {
  leagueFilter?: LeagueFilter;
  seasonId?: string;
  maxKickoffUtc?: string;
}): Promise<HistoricalMatchSample[]> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const params: unknown[] = [];
  const clauses = ["m.status = 'finished'"];

  if (filters?.leagueFilter && filters.leagueFilter !== 'all') {
    params.push(filters.leagueFilter);
    clauses.push(`m.league_id = $${params.length}`);
  }
  if (filters?.seasonId && filters.seasonId !== 'all') {
    params.push(filters.seasonId);
    clauses.push(`m.season_id = $${params.length}`);
  }
  if (filters?.maxKickoffUtc) {
    params.push(filters.maxKickoffUtc);
    clauses.push(`m.kickoff_utc <= $${params.length}::timestamptz`);
  }

  const res = await pool.query<{
    id: string;
    league_id: LeagueId;
    season_id: string;
    kickoff_utc: Date;
    home_team_id: string;
    away_team_id: string;
    home_team_name: string;
    away_team_name: string;
    home_goals: number;
    away_goals: number;
  }>(
    `SELECT
      m.id, m.league_id, m.season_id, m.kickoff_utc,
      m.home_team_id, m.away_team_id,
      ht.name AS home_team_name, at.name AS away_team_name,
      mr.home_goals, mr.away_goals
     FROM matches m
     JOIN match_results mr ON mr.match_id = m.id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY m.kickoff_utc ASC, m.id ASC`,
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
      `SELECT os.match_id, os.bookmaker, os.market, os.selection, os.decimal_odds
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.match_id = ANY($1::text[])
         AND os.captured_at <= m.kickoff_utc
       ORDER BY os.captured_at DESC`,
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

  return res.rows.map((r) => {
    const outcome: 'H' | 'D' | 'A' =
      r.home_goals > r.away_goals ? 'H' : r.home_goals === r.away_goals ? 'D' : 'A';
    const odds = oddsMap.get(r.id);
    const has1X2 = Boolean(odds?.home && odds?.draw && odds?.away);
    return {
      id: r.id,
      leagueId: r.league_id,
      seasonId: r.season_id,
      kickoffMs: new Date(r.kickoff_utc).getTime(),
      kickoffIso: new Date(r.kickoff_utc).toISOString(),
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeTeamName: r.home_team_name,
      awayTeamName: r.away_team_name,
      homeGoals: r.home_goals,
      awayGoals: r.away_goals,
      outcome,
      odds1X2: has1X2
        ? {
            home: odds!.home!,
            draw: odds!.draw!,
            away: odds!.away!,
            bookmaker: odds!.bookmaker,
          }
        : null,
      oddsOu25:
        odds?.over25 || odds?.under25
          ? { over25: odds.over25, under25: odds.under25 }
          : null,
    };
  });
}

interface ModelAccumulator {
  key: string;
  label: string;
  brierValues: number[];
  logLossValues: number[];
  correct: number;
  count: number;
  binaryEvents: { predictedProb: number; outcome: 0 | 1 }[];
}

function createAccumulator(key: string, label: string): ModelAccumulator {
  return {
    key,
    label,
    brierValues: [],
    logLossValues: [],
    correct: 0,
    count: 0,
    binaryEvents: [],
  };
}

function computeMeanAndCi95(values: number[], minBound = 0, maxBound = 10): {
  mean: number;
  ci95: [number, number];
} {
  const n = values.length;
  if (n === 0) return { mean: 0, ci95: [0, 0] };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 2) {
    const r = Number(mean.toFixed(5));
    return { mean: r, ci95: [r, r] };
  }
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const margin = 1.96 * se;
  return {
    mean: Number(mean.toFixed(5)),
    ci95: [
      Number(Math.max(minBound, mean - margin).toFixed(5)),
      Number(Math.min(maxBound, mean + margin).toFixed(5)),
    ],
  };
}

function computeWilsonAccuracyCi95(correct: number, total: number): [number, number] {
  if (total <= 0) return [0, 0];
  const ci = computeConfidenceInterval(correct / total, total, 1.96);
  return [Number((ci.lower * 100).toFixed(2)), Number((ci.upper * 100).toFixed(2))];
}

function recordModelPrediction(
  acc: ModelAccumulator,
  probs: ThreeWayProbabilities,
  outcome: 'H' | 'D' | 'A'
) {
  acc.count += 1;
  acc.brierValues.push(computeMulticlassBrier(probs, outcome));
  acc.logLossValues.push(computeMulticlassLogLoss(probs, outcome));

  const predicted =
    probs.home >= probs.draw && probs.home >= probs.away
      ? 'H'
      : probs.away >= probs.draw
      ? 'A'
      : 'D';
  if (predicted === outcome) acc.correct += 1;

  acc.binaryEvents.push(
    { predictedProb: probs.home, outcome: outcome === 'H' ? 1 : 0 },
    { predictedProb: probs.draw, outcome: outcome === 'D' ? 1 : 0 },
    { predictedProb: probs.away, outcome: outcome === 'A' ? 1 : 0 }
  );
}

function finalizeAccumulator(acc: ModelAccumulator): BacktestModelMetric {
  const { ece } = buildCalibrationBinsAndEce(acc.binaryEvents);
  const brierStats = computeMeanAndCi95(acc.brierValues, 0, 2);
  const logLossStats = computeMeanAndCi95(acc.logLossValues, 0, 15);
  return {
    modelKey: acc.key,
    modelLabel: acc.label,
    sampleCount: acc.count,
    accuracyPct: acc.count > 0 ? Number(((acc.correct / acc.count) * 100).toFixed(2)) : 0,
    accuracyCi95: computeWilsonAccuracyCi95(acc.correct, acc.count),
    brierScore: brierStats.mean,
    brierCi95: brierStats.ci95,
    logLoss: logLossStats.mean,
    logLossCi95: logLossStats.ci95,
    ece,
  };
}

export async function runWalkForwardBacktest(params: {
  leagueFilter?: LeagueFilter;
  seasonId?: string;
  calibrationMethod?: 'platt' | 'isotonic' | 'none';
  weights?: EnsembleWeights;
  persistRun?: boolean;
  trainAndActivate?: boolean;
  maxKickoffUtc?: string;
}): Promise<{
  summary: BacktestRunSummary;
  trainedParams: {
    rho: number;
    mlModel: SoftmaxMlModel;
    calibrator: FittedCalibrator;
    trainedUntilUtc: string;
  };
}> {
  const pool = getPool();
  if (!pool) {
    const err = new Error('Base de datos PostgreSQL no configurada.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const leagueFilter = params.leagueFilter ?? 'all';
  const calibrationMethod = params.calibrationMethod ?? 'platt';
  const weights: EnsembleWeights = params.weights ?? {
    poisson: 0.28,
    elo: 0.24,
    machineLearning: 0.24,
    recentForm: 0.12,
    homeAway: 0.12,
  };

  const matches = await loadChronologicalMatches({
    leagueFilter,
    seasonId: params.seasonId,
    maxKickoffUtc: params.maxKickoffUtc,
  });

  if (matches.length < 40) {
    const err = new Error(
      `Muestra insuficiente (${matches.length} partidos finalizados). Se requieren al menos 40 partidos cronológicos para backtesting walk-forward.`
    );
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const warmupCount = Math.max(30, Math.min(180, Math.floor(matches.length * 0.25)));
  const evalCount = matches.length - warmupCount;
  const foldSize = Math.max(25, Math.ceil(evalCount / 5));

  const state = createChronoState();
  const rhoTrainingBuffer: { lambdaHome: number; lambdaAway: number; hg: number; ag: number }[] = [];
  const mlTrainingBuffer: { features: number[]; outcome: 'H' | 'D' | 'A' }[] = [];
  const calTrainingBuffer: { probs: ThreeWayProbabilities; outcome: 'H' | 'D' | 'A' }[] = [];

  // Verificación de orden cronológico estricto
  let chronologicalOrderVerified = true;
  for (let idx = 1; idx < matches.length; idx += 1) {
    if (matches[idx].kickoffMs < matches[idx - 1].kickoffMs) {
      chronologicalOrderVerified = false;
      break;
    }
  }

  const warmupMatchIds = new Set<string>();
  const evaluatedMatchIds = new Set<string>();
  let warmupEligibleMlSamples = 0;
  let warmupSkippedColdStart = 0;
  let evalEligibleMlSamples = 0;
  let evalSkippedColdStart = 0;

  // 1. Warmup estrictamente cronológico (sin evaluar estas muestras)
  for (let i = 0; i < warmupCount; i += 1) {
    const m = matches[i];
    warmupMatchIds.add(m.id);
    const fv = extractPreMatchFeatures(state, {
      leagueId: m.leagueId,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      kickoffMs: m.kickoffMs,
    });
    if (fv.homePlayed >= 2 && fv.awayPlayed >= 2) {
      warmupEligibleMlSamples += 1;
      rhoTrainingBuffer.push({
        lambdaHome: fv.lambdaHome,
        lambdaAway: fv.lambdaAway,
        hg: m.homeGoals,
        ag: m.awayGoals,
      });
      mlTrainingBuffer.push({ features: fv.features, outcome: m.outcome });
    } else {
      warmupSkippedColdStart += 1;
    }
    updateChronoStateWithMatch(state, m);
  }

  let currentRho = fitDixonColesRho(rhoTrainingBuffer);
  let currentMlModel: SoftmaxMlModel =
    mlTrainingBuffer.length >= 35
      ? fitSoftmaxMlModel(mlTrainingBuffer)
      : createDefaultSoftmaxMlModel();
  let currentCalibrator: FittedCalibrator = { method: 'none', sampleCount: 0 };

  const accPoisson = createAccumulator('poisson', 'Poisson Independiente');
  const accDixonColes = createAccumulator('dixon_coles', 'Dixon-Coles (ρ)');
  const accElo = createAccumulator('elo', 'Elo Dinámico');
  const accStats = createAccumulator('stats_off_def', 'Estadísticas Of./Def. & Forma');
  const accMl = createAccumulator('machine_learning', 'ML Regresión Logística L2');
  const accEnsembleRaw = createAccumulator('ensemble_raw', 'Ensemble Ponderado (sin cal.)');
  const accEnsembleCal = createAccumulator(
    'ensemble_calibrated',
    `Ensemble Calibrado (${calibrationMethod})`
  );
  const accMarket = createAccumulator('market_devigged', 'Mercado Sin Margen (De-vigged)');

  const byLeagueMap = new Map<
    string,
    {
      count: number;
      correct: number;
      brierValues: number[];
      logLossValues: number[];
    }
  >();
  const bySeasonMap = new Map<
    string,
    { count: number; correct: number; brierSum: number; logLossSum: number }
  >();
  const folds: BacktestFoldSummary[] = [];

  let roiBetsPlaced = 0;
  let roiUnitsNet = 0;
  let oddsEvaluatedMatches = 0;

  let foldIdx = 1;
  let foldStartIso = matches[warmupCount].kickoffIso;
  let foldTrainMatchCount = warmupCount;
  let foldTrainMlSamples = mlTrainingBuffer.length;
  let foldTrainEndDate = matches[warmupCount - 1].kickoffIso.slice(0, 10);
  let foldCount = 0;
  let foldBrierSum = 0;
  let foldLogLossSum = 0;
  let foldCorrect = 0;

  // 2. Evaluación Walk-Forward estrictamente fuera de muestra
  for (let i = warmupCount; i < matches.length; i += 1) {
    const m = matches[i];
    evaluatedMatchIds.add(m.id);
    const fv = extractPreMatchFeatures(state, {
      leagueId: m.leagueId,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      kickoffMs: m.kickoffMs,
    });

    const poissonProbs = computePoissonScoreMatrix(fv.lambdaHome, fv.lambdaAway).threeWay;
    const dcProbs = computeDixonColesMatrix(fv.lambdaHome, fv.lambdaAway, currentRho).threeWay;
    const eloProbs = predictEloThreeWay(fv.homeElo, fv.awayElo, fv.leagueDrawRate);
    const statsProbs = predictOffDefStatsThreeWay(fv);
    const mlProbs = predictSoftmaxMl(fv.features, currentMlModel);

    const ensembleRaw = computeWeightedEnsemble(
      {
        poisson: poissonProbs,
        dixonColes: dcProbs,
        elo: eloProbs,
        machineLearning: mlProbs,
        statsOffDef: statsProbs,
      },
      weights
    );
    const ensembleCal = applyThreeWayCalibrator(ensembleRaw, currentCalibrator);

    recordModelPrediction(accPoisson, poissonProbs, m.outcome);
    recordModelPrediction(accDixonColes, dcProbs, m.outcome);
    recordModelPrediction(accElo, eloProbs, m.outcome);
    recordModelPrediction(accStats, statsProbs, m.outcome);
    recordModelPrediction(accMl, mlProbs, m.outcome);
    recordModelPrediction(accEnsembleRaw, ensembleRaw, m.outcome);
    recordModelPrediction(accEnsembleCal, ensembleCal, m.outcome);

    if (m.odds1X2) {
      oddsEvaluatedMatches += 1;
      const deVig = removeBookmakerMargin([m.odds1X2.home, m.odds1X2.draw, m.odds1X2.away]).fairProbs;
      recordModelPrediction(
        accMarket,
        { home: deVig[0], draw: deVig[1], away: deVig[2] },
        m.outcome
      );

      // Evaluación de valor real sobre cuotas pre-partido disponibles (EV >= 3%)
      const candidates: { sel: 'H' | 'D' | 'A'; prob: number; odds: number }[] = [
        { sel: 'H', prob: ensembleCal.home, odds: m.odds1X2.home },
        { sel: 'D', prob: ensembleCal.draw, odds: m.odds1X2.draw },
        { sel: 'A', prob: ensembleCal.away, odds: m.odds1X2.away },
      ];
      const bestValue = candidates
        .map((c) => ({ ...c, ev: c.prob * c.odds - 1 }))
        .sort((a, b) => b.ev - a.ev)[0];
      if (bestValue && bestValue.ev >= 0.03) {
        roiBetsPlaced += 1;
        const won = bestValue.sel === m.outcome;
        roiUnitsNet += won ? bestValue.odds - 1 : -1;
      }
    }

    const brier = computeMulticlassBrier(ensembleCal, m.outcome);
    const ll = computeMulticlassLogLoss(ensembleCal, m.outcome);
    const predSel =
      ensembleCal.home >= ensembleCal.draw && ensembleCal.home >= ensembleCal.away
        ? 'H'
        : ensembleCal.away >= ensembleCal.draw
        ? 'A'
        : 'D';
    const isHit = predSel === m.outcome ? 1 : 0;

    foldCount += 1;
    foldBrierSum += brier;
    foldLogLossSum += ll;
    foldCorrect += isHit;

    const lgEntry = byLeagueMap.get(m.leagueId) ?? {
      count: 0,
      correct: 0,
      brierValues: [],
      logLossValues: [],
    };
    lgEntry.count += 1;
    lgEntry.correct += isHit;
    lgEntry.brierValues.push(brier);
    lgEntry.logLossValues.push(ll);
    byLeagueMap.set(m.leagueId, lgEntry);

    const ssEntry = bySeasonMap.get(m.seasonId) ?? {
      count: 0,
      correct: 0,
      brierSum: 0,
      logLossSum: 0,
    };
    ssEntry.count += 1;
    ssEntry.correct += isHit;
    ssEntry.brierSum += brier;
    ssEntry.logLossSum += ll;
    bySeasonMap.set(m.seasonId, ssEntry);

    // Añadir a buffers de entrenamiento DESPUÉS de predecir (zero leakage)
    if (fv.homePlayed >= 2 && fv.awayPlayed >= 2) {
      evalEligibleMlSamples += 1;
      rhoTrainingBuffer.push({
        lambdaHome: fv.lambdaHome,
        lambdaAway: fv.lambdaAway,
        hg: m.homeGoals,
        ag: m.awayGoals,
      });
      mlTrainingBuffer.push({ features: fv.features, outcome: m.outcome });
    } else {
      evalSkippedColdStart += 1;
    }
    calTrainingBuffer.push({ probs: ensembleRaw, outcome: m.outcome });
    updateChronoStateWithMatch(state, m);

    const isEndOfFold = foldCount >= foldSize || i === matches.length - 1;
    if (isEndOfFold) {
      folds.push({
        foldIndex: foldIdx,
        startDate: foldStartIso.slice(0, 10),
        endDate: m.kickoffIso.slice(0, 10),
        trainMatchCount: foldTrainMatchCount,
        trainMlSamplesBeforeFold: foldTrainMlSamples,
        trainEndDate: foldTrainEndDate,
        matchesEvaluated: foldCount,
        accuracyPct: Number(((foldCorrect / foldCount) * 100).toFixed(2)),
        accuracyCi95: computeWilsonAccuracyCi95(foldCorrect, foldCount),
        brierScore: Number((foldBrierSum / foldCount).toFixed(5)),
        logLoss: Number((foldLogLossSum / foldCount).toFixed(5)),
        rhoFitted: currentRho,
      });

      // Re-entrenar modelos periódicamente para el siguiente bloque walk-forward
      currentRho = fitDixonColesRho(rhoTrainingBuffer);
      if (mlTrainingBuffer.length >= 40) {
        currentMlModel = fitSoftmaxMlModel(mlTrainingBuffer);
      }
      if (calTrainingBuffer.length >= 50 && calibrationMethod !== 'none') {
        currentCalibrator = fitThreeWayCalibrator(calTrainingBuffer, calibrationMethod);
      }

      foldIdx += 1;
      foldCount = 0;
      foldBrierSum = 0;
      foldLogLossSum = 0;
      foldCorrect = 0;
      if (i + 1 < matches.length) {
        foldStartIso = matches[i + 1].kickoffIso;
        foldTrainMatchCount = i + 1;
        foldTrainMlSamples = mlTrainingBuffer.length;
        foldTrainEndDate = m.kickoffIso.slice(0, 10);
      }
    }
  }

  let overlapCount = 0;
  for (const id of warmupMatchIds) {
    if (evaluatedMatchIds.has(id)) overlapCount += 1;
  }

  // Re-ajuste final con toda la muestra cronológica completada para inferencia futura (nunca usada en evaluación)
  const finalRho = fitDixonColesRho(rhoTrainingBuffer);
  const finalMlModel = fitSoftmaxMlModel(mlTrainingBuffer);
  const finalCalibrator = fitThreeWayCalibrator(calTrainingBuffer, calibrationMethod);

  const modelMetrics = [
    finalizeAccumulator(accEnsembleCal),
    finalizeAccumulator(accEnsembleRaw),
    finalizeAccumulator(accDixonColes),
    finalizeAccumulator(accPoisson),
    finalizeAccumulator(accElo),
    finalizeAccumulator(accStats),
    finalizeAccumulator(accMl),
    ...(accMarket.count > 0 ? [finalizeAccumulator(accMarket)] : []),
  ].sort((a, b) => a.logLoss - b.logLoss);

  const byLeague: BacktestLeagueMetric[] = Array.from(byLeagueMap.entries()).map(([lg, d]) => {
    const brierStats = computeMeanAndCi95(d.brierValues, 0, 2);
    const llStats = computeMeanAndCi95(d.logLossValues, 0, 15);
    return {
      leagueId: lg,
      matchesEvaluated: d.count,
      accuracyPct: Number(((d.correct / d.count) * 100).toFixed(2)),
      accuracyCi95: computeWilsonAccuracyCi95(d.correct, d.count),
      brierScore: brierStats.mean,
      brierCi95: brierStats.ci95,
      logLoss: llStats.mean,
      logLossCi95: llStats.ci95,
    };
  });

  const bySeason = Array.from(bySeasonMap.entries()).map(([sid, d]) => ({
    seasonId: sid,
    matchesEvaluated: d.count,
    accuracyPct: Number(((d.correct / d.count) * 100).toFixed(2)),
    accuracyCi95: computeWilsonAccuracyCi95(d.correct, d.count),
    brierScore: Number((d.brierSum / d.count).toFixed(5)),
    logLoss: Number((d.logLossSum / d.count).toFixed(5)),
  }));

  const { bins: calibrationBins, ece: finalEce } = buildCalibrationBinsAndEce(
    accEnsembleCal.binaryEvents
  );

  const runId = `bt_${Date.now()}`;
  const lastMatchIso = matches[matches.length - 1].kickoffIso;
  const ensembleFinalMetric = finalizeAccumulator(accEnsembleCal);

  const totalColdStartSkipped = warmupSkippedColdStart + evalSkippedColdStart;
  const datasetAudit: BacktestDatasetAudit = {
    totalChronologicalFinished: matches.length,
    warmupMatches: warmupCount,
    warmupEligibleMlSamples,
    warmupSkippedColdStart,
    evaluatedMatches: evalCount,
    evalEligibleMlSamples,
    evalSkippedColdStart,
    finalLiveRefitSamples: finalMlModel.trainedSamples,
    overlapCount,
    chronologicalOrderVerified,
    leakageAuditPassed: chronologicalOrderVerified && overlapCount === 0,
    explanation: `De ${matches.length} partidos finalizados ordenados cronológicamente, los primeros ${warmupCount} conforman el warmup inicial (nunca evaluados; ${warmupEligibleMlSamples} válidos para ML y ${warmupSkippedColdStart} omitidos por arranque en frío <2 partidos previos) y los ${evalCount} restantes forman el conjunto de prueba walk-forward fuera de muestra (${evalEligibleMlSamples} válidos añadidos tras su predicción y ${evalSkippedColdStart} omitidos en arranque de temporada). Tras concluir los ${folds.length} folds, el re-ajuste final para producción futura suma ${warmupEligibleMlSamples} + ${evalEligibleMlSamples} = ${finalMlModel.trainedSamples} muestras (${matches.length} − ${totalColdStartSkipped}).`,
  };

  const summary: BacktestRunSummary = {
    runId,
    createdAtUtc: new Date().toISOString(),
    cutoffUtc: lastMatchIso,
    leagueFilter,
    seasonFilter: params.seasonId ?? 'all',
    calibrationMethod: finalCalibrator.method,
    weightsUsed: weights,
    warmupMatches: warmupCount,
    evaluatedMatches: evalCount,
    dateRangeStart: matches[0].kickoffIso.slice(0, 10),
    dateRangeEnd: lastMatchIso.slice(0, 10),
    fittedRho: finalRho,
    mlTrainedSamples: finalMlModel.trainedSamples,
    ece: finalEce,
    datasetAudit,
    oddsCoverage: {
      matchesWithHistoricalOdds: oddsEvaluatedMatches,
      valueBetsSimulated: roiBetsPlaced,
      roiPct:
        roiBetsPlaced > 0 ? Number(((roiUnitsNet / roiBetsPlaced) * 100).toFixed(2)) : null,
      yieldUnits: roiBetsPlaced > 0 ? Number(roiUnitsNet.toFixed(2)) : null,
      note:
        oddsEvaluatedMatches === 0
          ? 'Los partidos históricos finalizados no tienen cuotas cerradas vinculadas; el ROI/Yield real se medirá exclusivamente con apuestas registradas y liquidadas tras capturar cuotas pre-partido.'
          : undefined,
    },
    modelMetrics,
    byLeague,
    bySeason,
    calibrationBins,
    folds,
  };

  if (params.persistRun !== false) {
    let activeModelId: string | null = null;
    if (params.trainAndActivate) {
      activeModelId = `ensemble-v2-p5-${Date.now()}`;
      await pool.query('UPDATE model_versions SET is_active = FALSE WHERE is_active = TRUE');
      await pool.query(
        `INSERT INTO model_versions (
          id, name, weights, thresholds, calibration_method, trained_until_utc,
          is_active, trained_params, eval_metrics
        )
        VALUES (
          $1, $2, $3::jsonb,
          COALESCE(
            (SELECT thresholds FROM model_versions ORDER BY created_at DESC LIMIT 1),
            '{"minCompletenessPct":65,"maxModelSpreadPct":12,"minExpectedValuePct":4,"strictModeNoForce":false}'::jsonb
          ),
          $4, $5::timestamptz, TRUE, $6::jsonb, $7::jsonb
        )`,
        [
          activeModelId,
          `Ensemble Walk-Forward (${finalCalibrator.method})`,
          JSON.stringify(weights),
          finalCalibrator.method,
          lastMatchIso,
          JSON.stringify({
            rho: finalRho,
            mlModel: finalMlModel,
            calibrator: finalCalibrator,
          }),
          JSON.stringify({
            brierScore: ensembleFinalMetric.brierScore,
            logLoss: ensembleFinalMetric.logLoss,
            accuracyPct: ensembleFinalMetric.accuracyPct,
            ece: finalEce,
            evaluatedMatches: evalCount,
          }),
        ]
      );

      await pool.query(
        `INSERT INTO calibration_history (
          model_version_id, league_id, window_end, bin_data, brier_score, log_loss
        ) VALUES ($1, $2, $3::timestamptz, $4::jsonb, $5, $6)`,
        [
          activeModelId,
          leagueFilter === 'all' ? null : leagueFilter,
          lastMatchIso,
          JSON.stringify(calibrationBins),
          ensembleFinalMetric.brierScore,
          ensembleFinalMetric.logLoss,
        ]
      );
    }

    try {
      await pool.query(
        `INSERT INTO backtest_runs (
          id, model_version_id, league_filter, season_filter, calibration_method,
          total_matches_evaluated, warmup_matches, summary_json,
          cutoff_utc, weights_json, dataset_audit_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $10::jsonb, $11::jsonb)`,
        [
          runId,
          activeModelId,
          leagueFilter,
          params.seasonId ?? 'all',
          finalCalibrator.method,
          evalCount,
          warmupCount,
          JSON.stringify(summary),
          lastMatchIso,
          JSON.stringify(weights),
          JSON.stringify(datasetAudit),
        ]
      );
    } catch {
      await pool.query(
        `INSERT INTO backtest_runs (
          id, model_version_id, league_filter, season_filter, calibration_method,
          total_matches_evaluated, warmup_matches, summary_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          runId,
          activeModelId,
          leagueFilter,
          params.seasonId ?? 'all',
          finalCalibrator.method,
          evalCount,
          warmupCount,
          JSON.stringify(summary),
        ]
      );
    }
  }

  return {
    summary,
    trainedParams: {
      rho: finalRho,
      mlModel: finalMlModel,
      calibrator: finalCalibrator,
      trainedUntilUtc: lastMatchIso,
    },
  };
}

export async function getBacktestHistoryFromDb(): Promise<BacktestRunSummary[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query<{ summary_json: BacktestRunSummary }>(
      `SELECT summary_json FROM backtest_runs ORDER BY created_at DESC LIMIT 12`
    );
    return res.rows.map((r) => r.summary_json);
  } catch {
    return [];
  }
}

export async function getBacktestByRunId(runId: string): Promise<BacktestRunSummary | null> {
  const pool = getPool();
  if (!pool) return null;
  const res = await pool.query<{
    summary_json: BacktestRunSummary;
    cutoff_utc: Date | null;
    weights_json: EnsembleWeights | null;
  }>(
    `SELECT summary_json, cutoff_utc, weights_json
     FROM backtest_runs
     WHERE id = $1
     LIMIT 1`,
    [runId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row.summary_json,
    cutoffUtc:
      row.summary_json.cutoffUtc ??
      (row.cutoff_utc ? new Date(row.cutoff_utc).toISOString() : undefined),
    weightsUsed: row.summary_json.weightsUsed ?? row.weights_json ?? undefined,
  };
}

export async function reproduceBacktestByRunId(
  runId: string
): Promise<BacktestReproductionResult> {
  const original = await getBacktestByRunId(runId);
  if (!original) {
    const err = new Error(`Ejecución de backtest '${runId}' no encontrada.`);
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const maxKickoffUtc =
    original.cutoffUtc ??
    (original.dateRangeEnd ? `${original.dateRangeEnd}T23:59:59.999Z` : undefined);

  const { summary: reproduced } = await runWalkForwardBacktest({
    leagueFilter: original.leagueFilter,
    seasonId: original.seasonFilter,
    calibrationMethod: original.calibrationMethod,
    weights: original.weightsUsed,
    maxKickoffUtc,
    persistRun: false,
    trainAndActivate: false,
  });

  const origCal =
    original.modelMetrics.find((m) => m.modelKey === 'ensemble_calibrated') ??
    original.modelMetrics[0];
  const repCal =
    reproduced.modelMetrics.find((m) => m.modelKey === 'ensemble_calibrated') ??
    reproduced.modelMetrics[0];

  const brierDiff = Number(Math.abs((origCal?.brierScore ?? 0) - (repCal?.brierScore ?? 0)).toFixed(6));
  const logLossDiff = Number(Math.abs((origCal?.logLoss ?? 0) - (repCal?.logLoss ?? 0)).toFixed(6));
  const accuracyDiff = Number(Math.abs((origCal?.accuracyPct ?? 0) - (repCal?.accuracyPct ?? 0)).toFixed(4));
  const eceDiff = Number(Math.abs(original.ece - reproduced.ece).toFixed(6));
  const identicalMatchCount = original.evaluatedMatches === reproduced.evaluatedMatches;

  return {
    originalRunId: runId,
    originalSummary: original,
    reproducedSummary: reproduced,
    reproducibilityCheck: {
      identicalMatchCount,
      brierDiff,
      logLossDiff,
      accuracyDiff,
      eceDiff,
      exactMatch:
        identicalMatchCount &&
        brierDiff <= 1e-5 &&
        logLossDiff <= 1e-5 &&
        accuracyDiff <= 0.01 &&
        eceDiff <= 1e-5,
    },
  };
}

export async function getActiveTrainedModelFromDb(): Promise<{
  id: string;
  name: string;
  weights: EnsembleWeights;
  calibrationMethod: string;
  trainedUntilUtc: string | null;
  rho: number;
  mlModel: SoftmaxMlModel;
  calibrator: FittedCalibrator | null;
  evalMetrics: {
    brierScore?: number;
    logLoss?: number;
    accuracyPct?: number;
    ece?: number;
    evaluatedMatches?: number;
  } | null;
} | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query<{
      id: string;
      name: string;
      weights: EnsembleWeights;
      calibration_method: string;
      trained_until_utc: Date | null;
      trained_params: {
        rho?: number;
        mlModel?: SoftmaxMlModel;
        calibrator?: FittedCalibrator;
      } | null;
      eval_metrics: Record<string, number> | null;
    }>(
      `SELECT id, name, weights, calibration_method, trained_until_utc, trained_params, eval_metrics
       FROM model_versions
       WHERE is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1`
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      weights: row.weights,
      calibrationMethod: row.calibration_method,
      trainedUntilUtc: row.trained_until_utc ? new Date(row.trained_until_utc).toISOString() : null,
      rho: typeof row.trained_params?.rho === 'number' ? row.trained_params.rho : -0.09,
      mlModel: row.trained_params?.mlModel ?? createDefaultSoftmaxMlModel(),
      calibrator: row.trained_params?.calibrator ?? null,
      evalMetrics: row.eval_metrics ?? null,
    };
  } catch {
    return null;
  }
}
