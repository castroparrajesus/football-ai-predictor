import React, { useMemo, useState } from 'react';
import { ConfidenceTier, MatchRecord, QualityFilterThresholds } from '../types/football';
import { computePoissonScoreMatrix, formatPct } from '../utils/previewMath';

interface PredictionsViewProps {
  matches: MatchRecord[];
  thresholds: QualityFilterThresholds;
  onAnalyzeMatch: (match: MatchRecord) => void;
}

export const PredictionsView: React.FC<PredictionsViewProps> = ({
  matches,
  thresholds,
  onAnalyzeMatch,
}) => {
  const [tierFilter, setTierFilter] = useState<'qualified' | ConfidenceTier | 'all'>('qualified');

  const filtered = useMemo(() => {
    if (thresholds.strictModeNoForce && tierFilter === 'qualified') {
      return [];
    }
    return matches.filter((m) => {
      if (tierFilter === 'qualified') {
        return (
          (m.confidenceTier === 'A' || m.confidenceTier === 'B') &&
          m.dataCompleteness >= thresholds.minCompletenessPct
        );
      }
      if (tierFilter === 'all') return true;
      return m.confidenceTier === tierFilter;
    });
  }, [matches, tierFilter, thresholds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Pronósticos y Filtro de Calidad Estadística
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Clasificación estricta en Niveles A, B, C y DESCARTADO. Cada mercado se calcula de forma
            independiente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#111827] border border-slate-800">
          {[
            { id: 'qualified', label: 'Aprobados (A/B)' },
            { id: 'A', label: 'Nivel A' },
            { id: 'B', label: 'Nivel B' },
            { id: 'C', label: 'Nivel C' },
            { id: 'DESCARTADO', label: 'Descartados' },
            { id: 'all', label: 'Todos' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTierFilter(tab.id as typeof tierFilter)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                tierFilter === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-[#111827] p-8 text-center space-y-2">
          <p className="font-display text-sm font-semibold text-amber-300">
            HOY NO SE DETECTAN PRONÓSTICOS CON SUFICIENTE CALIDAD ESTADÍSTICA.
          </p>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            Ningún encuentro cumple simultáneamente los criterios de completitud, convergencia de
            modelos y calibración para el filtro seleccionado.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-[#111827]">
          <table className="w-full text-xs">
            <thead className="bg-[#0F1520] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Partido</th>
                <th className="text-right px-3 py-3 font-medium">1 / X / 2</th>
                <th className="text-right px-3 py-3 font-medium">Over 2.5</th>
                <th className="text-right px-3 py-3 font-medium">BTTS Sí</th>
                <th className="text-right px-3 py-3 font-medium">Completitud</th>
                <th className="text-right px-3 py-3 font-medium">Nivel</th>
                <th className="text-right px-4 py-3 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 tabular-nums">
              {filtered.map((m) => {
                const poisson = computePoissonScoreMatrix(
                  m.expectedLambdaHome,
                  m.expectedLambdaAway
                );
                return (
                  <tr key={m.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">
                        {m.homeTeamName} vs {m.awayTeamName}
                      </div>
                      <div className="text-[11px] text-slate-400">{m.confidenceReasons[0]}</div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-200 whitespace-nowrap">
                      {formatPct(m.models.ensemble.home, 0)} / {formatPct(m.models.ensemble.draw, 0)} /{' '}
                      {formatPct(m.models.ensemble.away, 0)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-200">
                      {formatPct(poisson.markets.goals.over25)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-200">
                      {formatPct(poisson.markets.goals.bttsYes)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-300">
                      {m.dataCompleteness}%
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-semibold">
                      <span
                        className={
                          m.confidenceTier === 'A'
                            ? 'text-emerald-400'
                            : m.confidenceTier === 'B'
                            ? 'text-emerald-300'
                            : m.confidenceTier === 'C'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }
                      >
                        {m.confidenceTier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onAnalyzeMatch(m)}
                        className="px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium whitespace-nowrap"
                      >
                        ANALIZAR PARTIDO
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
