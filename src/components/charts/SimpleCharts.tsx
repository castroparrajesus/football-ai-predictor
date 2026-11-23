import React, { useState } from 'react';
import { CalibrationBin, ScoreMatrixCell } from '../../types/football';

interface CalibrationCurveProps {
  bins: CalibrationBin[];
}

export const CalibrationCurveChart: React.FC<CalibrationCurveProps> = ({ bins }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const width = 460;
  const height = 240;
  const pad = { top: 20, right: 20, bottom: 34, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const toX = (p: number) => pad.left + p * plotW;
  const toY = (p: number) => pad.top + (1 - p) * plotH;

  const pointsPath = bins
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${toX(b.meanPredicted).toFixed(1)} ${toY(b.observedFrequency).toFixed(1)}`)
    .join(' ');

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible" role="img" aria-label="Curva de calibración probabilística">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              y1={toY(tick)}
              x2={width - pad.right}
              y2={toY(tick)}
              stroke="#1E293B"
              strokeWidth="1"
            />
            <text
              x={pad.left - 8}
              y={toY(tick) + 4}
              textAnchor="end"
              className="fill-slate-500 text-[10px] font-mono"
            >
              {Math.round(tick * 100)}%
            </text>
            <line
              x1={toX(tick)}
              y1={pad.top}
              x2={toX(tick)}
              y2={height - pad.bottom}
              stroke="#1E293B"
              strokeWidth="1"
            />
            <text
              x={toX(tick)}
              y={height - pad.bottom + 16}
              textAnchor="middle"
              className="fill-slate-500 text-[10px] font-mono"
            >
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}

        {/* Diagonal ideal y = x */}
        <line
          x1={toX(0)}
          y1={toY(0)}
          x2={toX(1)}
          y2={toY(1)}
          stroke="#475569"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />

        {bins.length > 0 && (
          <path d={pointsPath} fill="none" stroke="#10B981" strokeWidth="2.2" />
        )}

        {bins.map((b, idx) => {
          const cx = toX(b.meanPredicted);
          const cy = toY(b.observedFrequency);
          const isHovered = hoveredIdx === idx;
          return (
            <g
              key={b.binLabel}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 6 : 4.5}
                fill="#10B981"
                stroke="#0B0F17"
                strokeWidth="2"
              />
            </g>
          );
        })}

        <text
          x={pad.left + plotW / 2}
          y={height - 2}
          textAnchor="middle"
          className="fill-slate-400 text-[10px]"
        >
          Probabilidad predicha por el modelo
        </text>
      </svg>

      {hoveredIdx !== null && bins[hoveredIdx] && (
        <div className="mt-2 px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-200 flex items-center justify-between font-mono">
          <span>Rango {bins[hoveredIdx].binLabel} (n={bins[hoveredIdx].sampleCount})</span>
          <span>
            Pred: {(bins[hoveredIdx].meanPredicted * 100).toFixed(1)}% / Real:{' '}
            {(bins[hoveredIdx].observedFrequency * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
};

interface TrendPoint {
  label: string;
  brier: number;
  logLoss: number;
  roiPct: number;
}

export const ProbabilisticTrendChart: React.FC<{ data: TrendPoint[] }> = ({ data }) => {
  const width = 460;
  const height = 220;
  const pad = { top: 20, right: 20, bottom: 30, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (data.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
        Sin histórico suficiente para graficar Brier Score y Log Loss.
      </div>
    );
  }

  const maxLogLoss = Math.max(...data.map((d) => d.logLoss), 0.7);
  const minVal = 0.1;

  const toX = (i: number) =>
    pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const toY = (v: number) =>
    pad.top + (1 - (v - minVal) / (maxLogLoss - minVal)) * plotH;

  const brierPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.brier).toFixed(1)}`)
    .join(' ');
  const logLossPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.logLoss).toFixed(1)}`)
    .join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Evolución de Brier Score y Log Loss">
        {[0.15, 0.3, 0.45, 0.6].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              y1={toY(tick)}
              x2={width - pad.right}
              y2={toY(tick)}
              stroke="#1E293B"
              strokeWidth="1"
            />
            <text
              x={pad.left - 8}
              y={toY(tick) + 4}
              textAnchor="end"
              className="fill-slate-500 text-[10px] font-mono"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}

        <path d={logLossPath} fill="none" stroke="#F59E0B" strokeWidth="2" />
        <path d={brierPath} fill="none" stroke="#10B981" strokeWidth="2" />

        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={toX(i)} cy={toY(d.brier)} r="3.5" fill="#10B981" />
            <circle cx={toX(i)} cy={toY(d.logLoss)} r="3.5" fill="#F59E0B" />
            <text
              x={toX(i)}
              y={height - 8}
              textAnchor="middle"
              className="fill-slate-400 text-[10px]"
            >
              {d.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-5 mt-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-emerald-500 inline-block" />
          Brier Score (menor es mejor)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-amber-500 inline-block" />
          Log Loss (menor es mejor)
        </span>
      </div>
    </div>
  );
};

export const ScoreMatrixHeatmap: React.FC<{
  matrix: ScoreMatrixCell[];
  homeName: string;
  awayName: string;
  maxDisplay?: number;
}> = ({ matrix, homeName, awayName, maxDisplay = 5 }) => {
  const maxProb = Math.max(...matrix.map((m) => m.probability), 0.01);
  const indices = Array.from({ length: maxDisplay + 1 }, (_, i) => i);

  const getProb = (hg: number, ag: number) =>
    matrix.find((m) => m.homeGoals === hg && m.awayGoals === ag)?.probability ?? 0;

  return (
    <div className="overflow-x-auto">
      <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
        <span>Filas: {homeName} (Local) · Columnas: {awayName} (Visitante)</span>
        <span className="font-mono text-slate-500">Distribución Poisson 0–{maxDisplay}</span>
      </div>
      <table className="w-full border-collapse text-xs font-mono tabular-nums">
        <thead>
          <tr>
            <th className="p-1.5 text-left text-slate-500 font-normal border border-slate-800/80 bg-[#0F1520]">
              L \ V
            </th>
            {indices.map((ag) => (
              <th
                key={ag}
                className="p-1.5 text-center text-slate-300 font-medium border border-slate-800/80 bg-[#0F1520]"
              >
                {ag}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {indices.map((hg) => (
            <tr key={hg}>
              <th className="p-1.5 text-center text-slate-300 font-medium border border-slate-800/80 bg-[#0F1520]">
                {hg}
              </th>
              {indices.map((ag) => {
                const prob = getProb(hg, ag);
                const intensity = prob / maxProb;
                const alpha = Math.max(0.05, intensity * 0.48);
                return (
                  <td
                    key={`${hg}-${ag}`}
                    style={{ backgroundColor: `rgba(16, 185, 129, ${alpha.toFixed(2)})` }}
                    className="p-1.5 text-center border border-slate-800/80 text-slate-100"
                    title={`${hg}-${ag}: ${(prob * 100).toFixed(2)}%`}
                  >
                    {(prob * 100).toFixed(1)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
