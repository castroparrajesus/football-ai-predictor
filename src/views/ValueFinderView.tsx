import React, { useState } from 'react';
import { QualityFilterThresholds, ValueOpportunity } from '../types/football';
import { calculateValueMetrics, formatPct, removeBookmakerMargin } from '../utils/previewMath';

interface ValueFinderViewProps {
  opportunities: ValueOpportunity[];
  thresholds: QualityFilterThresholds;
}

export const ValueFinderView: React.FC<ValueFinderViewProps> = ({
  opportunities,
  thresholds,
}) => {
  // Calculadora manual de Valor (Sección 8)
  const [calcProbPct, setCalcProbPct] = useState<string>('55');
  const [calcOddsHome, setCalcOddsHome] = useState<string>('2.05');
  const [calcOddsOpp1, setCalcOddsOpp1] = useState<string>('3.50');
  const [calcOddsOpp2, setCalcOddsOpp2] = useState<string>('3.60');
  const [onlyValue, setOnlyValue] = useState<boolean>(false);

  const prob = Math.max(0.01, Math.min(0.99, (parseFloat(calcProbPct) || 50) / 100));
  const odds = Math.max(1.01, parseFloat(calcOddsHome) || 2.0);
  const o2 = parseFloat(calcOddsOpp1) || 0;
  const o3 = parseFloat(calcOddsOpp2) || 0;

  const hasFullMarket = o2 > 1 && o3 > 1;
  const deVig = hasFullMarket ? removeBookmakerMargin([odds, o2, o3]) : null;
  const calc = calculateValueMetrics(prob, odds, deVig?.fairProbs[0] ?? null);

  const displayed = onlyValue
    ? opportunities.filter((o) => o.hasStatisticalValue)
    : opportunities;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Detector de Valor Estadístico (Value Finder)
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Compara la probabilidad calibrada del modelo contra la cuota decimal del mercado y evalúa
          el valor esperado matemático (EV). Una probabilidad alta sin precio favorable no constituye valor.
        </p>
      </div>

      {/* Interactive Formula Calculator */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Calculadora Matemática de Valor Esperado y Margen
          </h3>
          <span className="text-[11px] font-mono text-slate-400">
            EV = (P_modelo × Cuota) − 1
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block text-xs space-y-1.5">
            <span className="text-slate-400">Probabilidad modelo (%)</span>
            <input
              type="number"
              min="1"
              max="99"
              step="0.5"
              value={calcProbPct}
              onChange={(e) => setCalcProbPct(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#0B0F17] border border-slate-800 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block text-xs space-y-1.5">
            <span className="text-slate-400">Cuota decimal selección</span>
            <input
              type="number"
              min="1.01"
              step="0.01"
              value={calcOddsHome}
              onChange={(e) => setCalcOddsHome(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#0B0F17] border border-slate-800 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block text-xs space-y-1.5">
            <span className="text-slate-400">Cuota contraparte 1 (opcional)</span>
            <input
              type="number"
              min="1.01"
              step="0.01"
              value={calcOddsOpp1}
              onChange={(e) => setCalcOddsOpp1(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#0B0F17] border border-slate-800 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block text-xs space-y-1.5">
            <span className="text-slate-400">Cuota contraparte 2 (opcional)</span>
            <input
              type="number"
              min="1.01"
              step="0.01"
              value={calcOddsOpp2}
              onChange={(e) => setCalcOddsOpp2(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#0B0F17] border border-slate-800 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-slate-800/80 font-mono tabular-nums text-xs">
          <div>
            <div className="font-sans text-slate-400">Prob. implícita bruta</div>
            <div className="text-sm text-slate-100 mt-1">{formatPct(calc.impliedProb)}</div>
          </div>
          <div>
            <div className="font-sans text-slate-400">Implícita sin margen</div>
            <div className="text-sm text-slate-100 mt-1">
              {deVig ? formatPct(deVig.fairProbs[0]) : 'N/D'}
              {deVig && (
                <span className="text-[11px] text-slate-500 ml-1">
                  (Vig {(deVig.overround * 100).toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="font-sans text-slate-400">Cuota justa modelo</div>
            <div className="text-sm text-slate-100 mt-1">{calc.fairOdds.toFixed(2)}</div>
          </div>
          <div>
            <div className="font-sans text-slate-400">Diferencia (Edge)</div>
            <div className={`text-sm mt-1 ${calc.edge >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {calc.edge >= 0 ? '+' : ''}
              {(calc.edge * 100).toFixed(2)} pp
            </div>
          </div>
          <div>
            <div className="font-sans text-slate-400">EV por unidad</div>
            <div
              className={`text-sm font-semibold mt-1 ${
                calc.expectedValue > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {calc.expectedValue >= 0 ? '+' : ''}
              {(calc.expectedValue * 100).toFixed(2)}%
            </div>
          </div>
        </div>
      </section>

      {/* Scanner across active matches */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Escáner de Mercados vs Cuotas Disponibles
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Umbral mínimo configurado: EV ≥ {thresholds.minExpectedValuePct}% y confianza A/B.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOnlyValue((v) => !v)}
            className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap ${
              onlyValue
                ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {onlyValue ? 'Mostrando solo con valor' : 'Filtrar solo valor positivo'}
          </button>
        </div>

        {displayed.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-lg">
            No se detectan selecciones con valor estadístico positivo bajo los criterios actuales.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="text-left py-2.5 pr-3 font-medium">Partido / Selección</th>
                  <th className="text-right px-2.5 py-2.5 font-medium">Prob. Modelo</th>
                  <th className="text-right px-2.5 py-2.5 font-medium">Cuota</th>
                  <th className="text-right px-2.5 py-2.5 font-medium">Impl. Bruta</th>
                  <th className="text-right px-2.5 py-2.5 font-medium">Sin Margen</th>
                  <th className="text-right px-2.5 py-2.5 font-medium">Cuota Justa</th>
                  <th className="text-right px-2.5 py-2.5 font-medium">EV</th>
                  <th className="text-right pl-2.5 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {displayed.map((opp) => (
                  <tr key={opp.id} className="hover:bg-slate-800/30">
                    <td className="py-3 pr-3 font-sans">
                      <div className="font-medium text-slate-100">{opp.matchLabel}</div>
                      <div className="text-[11px] text-slate-400">
                        {opp.market} · {opp.selection} (Nivel {opp.confidenceTier})
                      </div>
                    </td>
                    <td className="px-2.5 py-3 text-right text-slate-200">{formatPct(opp.modelProb)}</td>
                    <td className="px-2.5 py-3 text-right text-slate-200">{opp.decimalOdds.toFixed(2)}</td>
                    <td className="px-2.5 py-3 text-right text-slate-400">{formatPct(opp.impliedProbRaw)}</td>
                    <td className="px-2.5 py-3 text-right text-slate-300">
                      {opp.impliedProbNoMargin !== null ? formatPct(opp.impliedProbNoMargin) : 'N/D'}
                    </td>
                    <td className="px-2.5 py-3 text-right text-slate-200">{opp.fairOdds.toFixed(2)}</td>
                    <td
                      className={`px-2.5 py-3 text-right font-semibold ${
                        opp.expectedValue > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {opp.expectedValue >= 0 ? '+' : ''}
                      {(opp.expectedValue * 100).toFixed(1)}%
                    </td>
                    <td className="pl-2.5 py-3 text-right font-sans">
                      {opp.hasStatisticalValue ? (
                        <span className="text-emerald-400 font-medium">Valor detectado</span>
                      ) : (
                        <span className="text-slate-400">{opp.rejectionReason ?? 'Sin ventaja'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
