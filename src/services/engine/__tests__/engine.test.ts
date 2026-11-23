import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyIsotonicBinary,
  applyPlattBinary,
  buildCalibrationBinsAndEce,
  computeConfidenceInterval,
  computeMulticlassBrier,
  computeMulticlassLogLoss,
  fitIsotonicBinary,
  fitPlattBinary,
} from '../calibration.ts';
import {
  computeDixonColesMatrix,
  createChronoState,
  dixonColesTau,
  extractPreMatchFeatures,
  fitSoftmaxMlModel,
  HistoricalMatchSample,
  predictEloThreeWay,
  predictSoftmaxMl,
  updateChronoStateWithMatch,
} from '../models.ts';
import {
  calculateValueMetrics,
  computePoissonScoreMatrix,
  removeBookmakerMargin,
} from '../../../utils/previewMath.ts';
import {
  computeClvPct,
  computeOddsTimelineMetrics,
  evaluateSelectionOutcome,
} from '../monitoringService.ts';

test('Poisson y Dixon-Coles normalizan la matriz de marcadores y tau ajusta marcadores bajos', () => {
  const poisson = computePoissonScoreMatrix(1.65, 1.15, 6);
  const pSum = poisson.matrix.reduce((s, c) => s + c.probability, 0);
  assert.ok(Math.abs(pSum - 1) < 1e-6, `Poisson sum=${pSum}`);

  const dc = computeDixonColesMatrix(1.65, 1.15, -0.1, 6);
  const dcSum = dc.matrix.reduce((s, c) => s + c.probability, 0);
  assert.ok(Math.abs(dcSum - 1) < 1e-6, `Dixon-Coles sum=${dcSum}`);

  const threeWaySum = dc.threeWay.home + dc.threeWay.draw + dc.threeWay.away;
  assert.ok(Math.abs(threeWaySum - 1) < 1e-6);

  const tau00 = dixonColesTau(0, 0, 1.4, 1.2, -0.1);
  const tau11 = dixonColesTau(1, 1, 1.4, 1.2, -0.1);
  const tau22 = dixonColesTau(2, 2, 1.4, 1.2, -0.1);
  assert.ok(tau00 > 1);
  assert.ok(tau11 > 1);
  assert.equal(tau22, 1);
});

test('Elo dinámico y extracción cronológica garantizan ausencia de data leakage', () => {
  const state = createChronoState();
  const baseMs = Date.UTC(2025, 8, 1, 15, 0, 0);

  // Antes de partidos, ambos equipos parten de 1500
  const pre0 = extractPreMatchFeatures(state, {
    leagueId: 'premier_league',
    homeTeamId: 't_home',
    awayTeamId: 't_away',
    kickoffMs: baseMs,
  });
  assert.equal(pre0.homeElo, 1500);
  assert.equal(pre0.awayElo, 1500);
  assert.equal(pre0.homePlayed, 0);

  const m1: HistoricalMatchSample = {
    id: 'm1',
    leagueId: 'premier_league',
    seasonId: '2025-2026',
    kickoffMs: baseMs,
    kickoffIso: new Date(baseMs).toISOString(),
    homeTeamId: 't_home',
    awayTeamId: 't_away',
    homeTeamName: 'Home FC',
    awayTeamName: 'Away FC',
    homeGoals: 3,
    awayGoals: 0,
    outcome: 'H',
    odds1X2: null,
    oddsOu25: null,
  };
  updateChronoStateWithMatch(state, m1);

  const nextMs = baseMs + 7 * 86_400_000;
  const pre1 = extractPreMatchFeatures(state, {
    leagueId: 'premier_league',
    homeTeamId: 't_home',
    awayTeamId: 't_away',
    kickoffMs: nextMs,
  });
  assert.ok(pre1.homeElo > 1500);
  assert.ok(pre1.awayElo < 1500);
  assert.equal(pre1.homeRestDays, 7);
  assert.equal(pre1.awayRestDays, 7);

  const eloProbs = predictEloThreeWay(pre1.homeElo, pre1.awayElo, 0.26);
  assert.ok(eloProbs.home > eloProbs.away);
  assert.ok(Math.abs(eloProbs.home + eloProbs.draw + eloProbs.away - 1) < 1e-6);
});

test('Regresión Logística Multinomial L2 aprende señal y produce probabilidades válidas', () => {
  const samples: { features: number[]; outcome: 'H' | 'D' | 'A' }[] = [];
  for (let i = 0; i < 60; i += 1) {
    const diff = i % 3 === 0 ? 1.2 : i % 3 === 1 ? 0.0 : -1.2;
    const outcome: 'H' | 'D' | 'A' = i % 3 === 0 ? 'H' : i % 3 === 1 ? 'D' : 'A';
    samples.push({
      features: [1, diff, diff * 0.4, -diff * 0.3, diff * 0.2, diff * 0.1, 0, diff * 0.3],
      outcome,
    });
  }

  const model = fitSoftmaxMlModel(samples);
  assert.equal(model.trainedSamples, 60);

  const strongHome = predictSoftmaxMl([1, 1.5, 0.6, -0.45, 0.3, 0.15, 0, 0.45], model);
  const strongAway = predictSoftmaxMl([1, -1.5, -0.6, 0.45, -0.3, -0.15, 0, -0.45], model);
  assert.ok(strongHome.home > strongHome.away);
  assert.ok(strongAway.away > strongAway.home);
  assert.ok(Math.abs(strongHome.home + strongHome.draw + strongHome.away - 1) < 1e-5);
});

test('Calibración Platt, PAVA Isotónica, Wilson CI y métricas Brier/LogLoss', () => {
  const probs: number[] = [];
  const outcomes: (0 | 1)[] = [];
  for (let i = 0; i < 80; i += 1) {
    const p = 0.1 + (i / 80) * 0.8;
    probs.push(p);
    outcomes.push(i % 10 < Math.round(p * 10) ? 1 : 0);
  }

  const platt = fitPlattBinary(probs, outcomes);
  const calLow = applyPlattBinary(0.2, platt);
  const calHigh = applyPlattBinary(0.8, platt);
  assert.ok(calHigh > calLow);

  const iso = fitIsotonicBinary(probs, outcomes);
  assert.ok(iso.length > 0);
  for (let i = 1; i < iso.length; i += 1) {
    assert.ok(iso[i].y >= iso[i - 1].y - 1e-9, 'PAVA debe ser monótona no decreciente');
  }
  assert.ok(applyIsotonicBinary(0.85, iso) >= applyIsotonicBinary(0.15, iso));

  const ci = computeConfidenceInterval(0.55, 25);
  assert.ok(ci.lower < 0.55 && ci.upper > 0.55);

  const brier = computeMulticlassBrier({ home: 0.6, draw: 0.25, away: 0.15 }, 'H');
  const ll = computeMulticlassLogLoss({ home: 0.6, draw: 0.25, away: 0.15 }, 'H');
  assert.ok(brier > 0 && brier < 0.4);
  assert.ok(ll > 0 && ll < 1);

  const { bins, ece } = buildCalibrationBinsAndEce(
    probs.map((p, idx) => ({ predictedProb: p, outcome: outcomes[idx] }))
  );
  assert.ok(bins.length > 0);
  assert.ok(ece >= 0 && ece <= 1);
});

test('Cálculo de EV y eliminación de margen (De-vigging)', () => {
  const devig = removeBookmakerMargin([2.1, 3.4, 3.6]);
  const fairSum = devig.fairProbs.reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(fairSum - 1) < 1e-6);
  assert.ok(devig.overround > 0);

  const val = calculateValueMetrics(0.54, 2.1, devig.fairProbs[0]);
  assert.ok(val.expectedValue > 0.1);
  assert.ok(val.edge > 0.05);
  assert.ok(Math.abs(val.fairOdds - 1 / 0.54) < 1e-4);
});

test('Fase 6: cálculo de CLV, evaluación automática de mercados e histórico de cuotas', () => {
  // CLV positivo: tomamos 2.20 y cerró en 2.00 -> +10%
  assert.equal(computeClvPct(2.2, 2.0), 10);
  // CLV negativo: tomamos 1.90 y cerró en 2.00 -> -5%
  assert.equal(computeClvPct(1.9, 2.0), -5);
  assert.equal(computeClvPct(1.0, 2.0), null);

  // Evaluación automática de resultados por mercado
  assert.equal(evaluateSelectionOutcome('Resultado 1X2', 'Arsenal (1)', 2, 1, 'Arsenal', 'Chelsea'), 1);
  assert.equal(evaluateSelectionOutcome('Resultado 1X2', 'Empate (X)', 2, 1, 'Arsenal', 'Chelsea'), 0);
  assert.equal(evaluateSelectionOutcome('Doble Oportunidad', '1X', 1, 1), 1);
  assert.equal(evaluateSelectionOutcome('Goles', 'Más de 2.5 goles', 2, 1), 1);
  assert.equal(evaluateSelectionOutcome('Goles', 'Menos de 2.5 goles', 2, 1), 0);
  assert.equal(evaluateSelectionOutcome('Ambos Marcan', 'Sí', 1, 2), 1);
  assert.equal(evaluateSelectionOutcome('Ambos Marcan', 'No', 1, 0), 1);

  // Línea temporal de cuotas sin cierre aún (> 120m antes)
  const earlyOnly = computeOddsTimelineMetrics([
    {
      id: 1,
      decimalOdds: 2.1,
      capturedAt: '2026-11-20T10:00:00.000Z',
      minutesToKickoff: 1440,
      isClosing: false,
    },
    {
      id: 2,
      decimalOdds: 1.95,
      capturedAt: '2026-11-20T18:00:00.000Z',
      minutesToKickoff: 960,
      isClosing: false,
    },
  ]);
  assert.ok(earlyOnly !== null);
  assert.equal(earlyOnly.openingOdds, 2.1);
  assert.equal(earlyOnly.latestOdds, 1.95);
  assert.equal(earlyOnly.closingOdds, null);
  assert.equal(earlyOnly.deltaOdds, -0.15);

  // Con snapshot dentro de la ventana de cierre (<= 90m)
  const withClosing = computeOddsTimelineMetrics([
    {
      id: 1,
      decimalOdds: 2.1,
      capturedAt: '2026-11-20T10:00:00.000Z',
      minutesToKickoff: 1440,
      isClosing: false,
    },
    {
      id: 3,
      decimalOdds: 1.88,
      capturedAt: '2026-11-21T13:30:00.000Z',
      minutesToKickoff: 30,
      isClosing: true,
    },
  ]);
  assert.ok(withClosing !== null);
  assert.equal(withClosing.closingOdds, 1.88);
  assert.equal(computeClvPct(withClosing.openingOdds, withClosing.closingOdds!), 11.702);
});
