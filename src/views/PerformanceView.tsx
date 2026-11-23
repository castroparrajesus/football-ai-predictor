import React from 'react';
import { CalibrationBin, PredictionHistoryItem } from '../types/football';
import { LEAGUES_CATALOG, SANDBOX_TREND_SERIES } from '../data/sandboxDataset';
import { CalibrationCurveChart, ProbabilisticTrendChart } from '../components/charts/SimpleCharts';

interface PerformanceViewProps {
  history: PredictionHistoryItem[];
  calibrationBins: CalibrationBin[];
}

export const PerformanceView: React.FC<PerformanceViewProps> = ({
  history,
  calibrationBins,
}) => {
  const settled = history.filter((h) => h.status !== 'pendiente');
  const won = settled.filter((h) => h.status === 'acertada').length;
  const lost = settled.filter((h) => h.status === 'fallada').length;
  const hitRate = settled.length > 0 ? (won / settled.length) * 100 : 0;

  const avgBrier =
    settled.length > 0
      ? settled.reduce((s, h) => s + (h.brierScore ?? 0), 0) / settled.length
      : null;
  const avgLogLoss =
    settled.length > 0
      ? settled.reduce((s, h) => s + (h.logLoss ?? 0), 0) / settled.length
      : null;
  const netUnits = settled.reduce((s, h) => s + (h.simulatedRoiUnit ?? 0), 0);
  const roiPct = settled.length > 0 ? (netUnits / settled.length) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Panel de Rendimiento Probabilístico y Calibración
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Evaluación basada en Brier Score, Log Loss, calibración y ROI simulado por liga, mercado y
          nivel de confianza.
        </p>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 font-mono tabular-nums">
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">Predicciones liquidadas</div>
          <div className="text-xl font-semibold text-slate-100 mt-1.5">
            {settled.length} <span className="text-xs text-slate-400 font-normal">({won}G / {lost}P)</span>
          </div>
        </div>
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">Tasa de acierto</div>
          <div className="text-xl font-semibold text-slate-100 mt-1.5">{hitRate.toFixed(1)}%</div>
        </div>
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">ROI simulado</div>
          <div
            className={`text-xl font-semibold mt-1.5 ${
              roiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {roiPct >= 0 ? '+' : ''}
            {roiPct.toFixed(1)}%
          </div>
        </div>
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">Brier Score medio</div>
          <div className="text-xl font-semibold text-slate-100 mt-1.5">
            {avgBrier !== null ? avgBrier.toFixed(4) : '—'}
          </div>
        </div>
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">Log Loss medio</div>
          <div className="text-xl font-semibold text-slate-100 mt-1.5">
            {avgLogLoss !== null ? avgLogLoss.toFixed(4) : '—'}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Curva de calibración
          </h3>
          {calibrationBins.length > 0 ? (
            <CalibrationCurveChart bins={calibrationBins} />
          ) : (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500">
              Sin muestra suficiente para calibración.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Tendencia semanal Brier Score & Log Loss
          </h3>
          <ProbabilisticTrendChart
            data={settled.length > 0 ? SANDBOX_TREND_SERIES : []}
          />
        </div>
      </div>

      {/* Breakdown by League */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-100">
          Desglose de rendimiento por liga
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left py-2 pr-4 font-medium">Liga</th>
                <th className="text-right px-3 py-2 font-medium">Liquidadas</th>
                <th className="text-right px-3 py-2 font-medium">Aciertos</th>
                <th className="text-right px-3 py-2 font-medium">Brier</th>
                <th className="text-right pl-3 py-2 font-medium">Balance u.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {LEAGUES_CATALOG.map((lg) => {
                const items = settled.filter((s) => s.leagueId === lg.id);
                const wins = items.filter((i) => i.status === 'acertada').length;
                const brier =
                  items.length > 0
                    ? items.reduce((a, b) => a + (b.brierScore ?? 0), 0) / items.length
                    : null;
                const units = items.reduce((a, b) => a + (b.simulatedRoiUnit ?? 0), 0);
                return (
                  <tr key={lg.id}>
                    <td className="py-2.5 pr-4 font-sans text-slate-200">{lg.name}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{items.length}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{wins}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">
                      {brier !== null ? brier.toFixed(3) : '—'}
                    </td>
                    <td
                      className={`pl-3 py-2.5 text-right ${
                        items.length === 0
                          ? 'text-slate-500'
                          : units >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {items.length === 0
                        ? '—'
                        : `${units >= 0 ? '+' : ''}${units.toFixed(2)} u`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
