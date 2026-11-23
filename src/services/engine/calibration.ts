import { CalibrationBin, ThreeWayProbabilities } from '../../types/football.ts';

export interface PlattBinaryParams {
  a: number;
  b: number;
}

export interface Platt3WayCalibrator {
  method: 'platt';
  sampleCount: number;
  home: PlattBinaryParams;
  draw: PlattBinaryParams;
  away: PlattBinaryParams;
}

export interface IsotonicPoint {
  upperX: number;
  y: number;
}

export interface Isotonic3WayCalibrator {
  method: 'isotonic';
  sampleCount: number;
  home: IsotonicPoint[];
  draw: IsotonicPoint[];
  away: IsotonicPoint[];
}

export interface UncalibratedCalibrator {
  method: 'none';
  sampleCount: number;
}

export type FittedCalibrator =
  | Platt3WayCalibrator
  | Isotonic3WayCalibrator
  | UncalibratedCalibrator;

function clampProb(p: number): number {
  return Math.max(1e-5, Math.min(1 - 1e-5, p));
}

function logit(p: number): number {
  const c = clampProb(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  if (z >= 35) return 1 - 1e-15;
  if (z <= -35) return 1e-15;
  return 1 / (1 + Math.exp(-z));
}

export function normalizeThreeWay(p: ThreeWayProbabilities): ThreeWayProbabilities {
  const h = Math.max(1e-5, p.home);
  const d = Math.max(1e-5, p.draw);
  const a = Math.max(1e-5, p.away);
  const s = h + d + a;
  return { home: h / s, draw: d / s, away: a / s };
}

/**
 * Ajusta calibración logística (Platt Scaling) con regularización L2 mediante descenso de gradiente.
 */
export function fitPlattBinary(
  probs: number[],
  outcomes: (0 | 1)[]
): PlattBinaryParams {
  if (probs.length < 30) {
    return { a: 1, b: 0 };
  }

  let a = 1.0;
  let b = 0.0;
  const lr = 0.05;
  const l2 = 0.01;
  const n = probs.length;
  const xs = probs.map(logit);

  for (let iter = 0; iter < 350; iter += 1) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const pred = sigmoid(a * xs[i] + b);
      const err = pred - outcomes[i];
      gradA += err * xs[i];
      gradB += err;
    }
    a -= lr * (gradA / n + l2 * (a - 1));
    b -= lr * (gradB / n + l2 * b);
  }

  // Evitar inversión de pendiente por ruido extremo en muestras pequeñas
  if (!Number.isFinite(a) || a <= 0.1 || a > 5) a = 1;
  if (!Number.isFinite(b) || Math.abs(b) > 3) b = 0;
  return { a: Number(a.toFixed(5)), b: Number(b.toFixed(5)) };
}

export function applyPlattBinary(prob: number, params: PlattBinaryParams): number {
  return clampProb(sigmoid(params.a * logit(prob) + params.b));
}

/**
 * Pool Adjacent Violators Algorithm (PAVA) para calibración isotónica monótona no decreciente.
 */
export function fitIsotonicBinary(
  probs: number[],
  outcomes: (0 | 1)[]
): IsotonicPoint[] {
  if (probs.length < 40) {
    return [];
  }

  const paired = probs
    .map((x, idx) => ({ x: clampProb(x), y: outcomes[idx], w: 1 }))
    .sort((u, v) => u.x - v.x);

  interface Block {
    maxX: number;
    sumY: number;
    weight: number;
  }

  const blocks: Block[] = [];
  for (const item of paired) {
    blocks.push({ maxX: item.x, sumY: item.y, weight: item.w });
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sumY / prev.weight > last.sumY / last.weight) {
        prev.maxX = last.maxX;
        prev.sumY += last.sumY;
        prev.weight += last.weight;
        blocks.pop();
      } else {
        break;
      }
    }
  }

  return blocks.map((blk) => ({
    upperX: Number(blk.maxX.toFixed(5)),
    y: Number(clampProb(blk.sumY / blk.weight).toFixed(5)),
  }));
}

export function applyIsotonicBinary(prob: number, curve: IsotonicPoint[]): number {
  if (curve.length === 0) return clampProb(prob);
  const p = clampProb(prob);
  for (let i = 0; i < curve.length; i += 1) {
    if (p <= curve[i].upperX) {
      return curve[i].y;
    }
  }
  return curve[curve.length - 1].y;
}

export function fitThreeWayCalibrator(
  samples: { probs: ThreeWayProbabilities; outcome: 'H' | 'D' | 'A' }[],
  method: 'platt' | 'isotonic' | 'none'
): FittedCalibrator {
  if (method === 'none' || samples.length < 40) {
    return { method: 'none', sampleCount: samples.length };
  }

  const hProbs = samples.map((s) => s.probs.home);
  const dProbs = samples.map((s) => s.probs.draw);
  const aProbs = samples.map((s) => s.probs.away);

  const hY = samples.map((s) => (s.outcome === 'H' ? 1 : 0)) as (0 | 1)[];
  const dY = samples.map((s) => (s.outcome === 'D' ? 1 : 0)) as (0 | 1)[];
  const aY = samples.map((s) => (s.outcome === 'A' ? 1 : 0)) as (0 | 1)[];

  if (method === 'isotonic') {
    return {
      method: 'isotonic',
      sampleCount: samples.length,
      home: fitIsotonicBinary(hProbs, hY),
      draw: fitIsotonicBinary(dProbs, dY),
      away: fitIsotonicBinary(aProbs, aY),
    };
  }

  return {
    method: 'platt',
    sampleCount: samples.length,
    home: fitPlattBinary(hProbs, hY),
    draw: fitPlattBinary(dProbs, dY),
    away: fitPlattBinary(aProbs, aY),
  };
}

export function applyThreeWayCalibrator(
  probs: ThreeWayProbabilities,
  calibrator: FittedCalibrator | null | undefined
): ThreeWayProbabilities {
  if (!calibrator || calibrator.method === 'none') {
    return normalizeThreeWay(probs);
  }
  if (calibrator.method === 'platt') {
    return normalizeThreeWay({
      home: applyPlattBinary(probs.home, calibrator.home),
      draw: applyPlattBinary(probs.draw, calibrator.draw),
      away: applyPlattBinary(probs.away, calibrator.away),
    });
  }
  return normalizeThreeWay({
    home: applyIsotonicBinary(probs.home, calibrator.home),
    draw: applyIsotonicBinary(probs.draw, calibrator.draw),
    away: applyIsotonicBinary(probs.away, calibrator.away),
  });
}

export function computeMulticlassBrier(
  probs: ThreeWayProbabilities,
  outcome: 'H' | 'D' | 'A'
): number {
  const yH = outcome === 'H' ? 1 : 0;
  const yD = outcome === 'D' ? 1 : 0;
  const yA = outcome === 'A' ? 1 : 0;
  return (
    Math.pow(probs.home - yH, 2) +
    Math.pow(probs.draw - yD, 2) +
    Math.pow(probs.away - yA, 2)
  );
}

export function computeMulticlassLogLoss(
  probs: ThreeWayProbabilities,
  outcome: 'H' | 'D' | 'A'
): number {
  const p = outcome === 'H' ? probs.home : outcome === 'D' ? probs.draw : probs.away;
  return -Math.log(clampProb(p));
}

export function buildCalibrationBinsAndEce(
  events: { predictedProb: number; outcome: 0 | 1 }[]
): { bins: CalibrationBin[]; ece: number } {
  const ranges = [
    { label: '0-20%', min: 0, max: 0.2 },
    { label: '20-35%', min: 0.2, max: 0.35 },
    { label: '35-50%', min: 0.35, max: 0.5 },
    { label: '50-65%', min: 0.5, max: 0.65 },
    { label: '65-80%', min: 0.65, max: 0.8 },
    { label: '80-100%', min: 0.8, max: 1.01 },
  ];

  const bins: CalibrationBin[] = [];
  let ece = 0;
  const total = events.length;

  for (const r of ranges) {
    const items = events.filter((e) => e.predictedProb >= r.min && e.predictedProb < r.max);
    if (items.length === 0) continue;
    const meanPred = items.reduce((s, i) => s + i.predictedProb, 0) / items.length;
    const obsFreq = items.reduce((s, i) => s + i.outcome, 0) / items.length;
    ece += (items.length / Math.max(1, total)) * Math.abs(meanPred - obsFreq);
    bins.push({
      binLabel: r.label,
      meanPredicted: Number(meanPred.toFixed(4)),
      observedFrequency: Number(obsFreq.toFixed(4)),
      sampleCount: items.length,
    });
  }

  return { bins, ece: Number(ece.toFixed(5)) };
}

/**
 * Intervalo de confianza de Wilson aproximado para una proporción/probabilidad estimada
 * dado el tamaño efectivo de muestra del equipo/partido.
 */
export function computeConfidenceInterval(
  prob: number,
  effectiveSampleSize: number,
  z = 1.645 // 90% CI
): { lower: number; upper: number } {
  const n = Math.max(4, effectiveSampleSize);
  const p = clampProb(prob);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    lower: Number(Math.max(0.01, center - margin).toFixed(4)),
    upper: Number(Math.min(0.99, center + margin).toFixed(4)),
  };
}
