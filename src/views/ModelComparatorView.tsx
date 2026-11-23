import React, { useState } from 'react';
import { EnsembleWeights, MatchRecord } from '../types/football';
import { combineEnsembleProbabilities, formatPct } from '../utils/previewMath';

interface ModelComparatorViewProps {
  matches: MatchRecord[];
  weights: EnsembleWeights;
  onUpdateWeights: (weights: EnsembleWeights) => void;
}

export const ModelComparatorView: React.FC<ModelComparatorViewProps> = ({
  matches,
  weights,
  onUpdateWeights,
}) => {
  const [selectedMatchId, setSelectedMatchId] = useState<string>(matches[0]?.id ?? '');
  const activeMatch = matches.find((m) => m.id === selectedMatchId) ?? matches[0] ?? null;

  const weightSum =
    weights.poisson +
    weights.elo +
    weights.machineLearning +
    weights.recentForm +
    weights.homeAway;

  const updateWeight = (key: keyof EnsembleWeights, value: number) => {
    onUpdateWeights({
      ...weights,
      [key]: value,
    });
  };

  if (!activeMatch) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">
        No hay partidos cargados para comparar modelos. Importa un CSV o activa el Sandbox de prueba.
      </div>
    );
  }

  const liveEnsemble = combineEnsembleProbabilities(
    {
      poisson: activeMatch.models.poisson,
      elo: activeMatch.models.elo,
      machineLearning: activeMatch.models.machineLearning,
      recentForm: activeMatch.models.recentForm,
      homeAway: activeMatch.models.homeAway,
    },
    weights
  );

  const rows = [
    { label: 'Poisson', probs: activeMatch.models.poisson },
    { label: 'Elo', probs: activeMatch.models.elo },
    { label: 'Machine Learning', probs: activeMatch.models.machineLearning },
    { label: 'Forma reciente', probs: activeMatch.models.recentForm },
    { label: 'Local / Visitante', probs: activeMatch.models.homeAway },
    { label: 'Ensemble final', probs: liveEnsemble, isEnsemble: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Comparador Multi-Modelo y Pesos del Ensemble
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Evalúa consenso o discrepancia entre algoritmos. Las desviaciones amplias reducen la
            confianza operativa.
          </p>
        </div>

        <select
          value={activeMatch.id}
          onChange={(e) => setSelectedMatchId(e.target.value)}
          aria-label="Seleccionar partido a comparar"
          className="h-9 px-3 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
        >
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.homeTeamName} vs {m.awayTeamName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold text-slate-100">
              {activeMatch.homeTeamName} vs {activeMatch.awayTeamName}
            </h3>
            <span
              className={`text-xs font-mono ${
                activeMatch.models.modelSpread > 10 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              Dispersión máxima: {activeMatch.models.modelSpread} pp (
              {activeMatch.models.modelSpread > 10 ? 'Discrepancia relevante' : 'Consenso estable'})
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="text-left py-2.5 pr-4 font-medium">Modelo</th>
                  <th className="text-right px-3 py-2.5 font-medium">Local</th>
                  <th className="text-right px-3 py-2.5 font-medium">Empate</th>
                  <th className="text-right px-3 py-2.5 font-medium">Visitante</th>
                  <th className="text-left pl-4 py-2.5 font-medium w-48">Distribución visual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {rows.map((r) => (
                  <tr
                    key={r.label}
                    className={r.isEnsemble ? 'bg-emerald-500/8 font-semibold' : 'hover:bg-slate-800/30'}
                  >
                    <td
                      className={`py-3 pr-4 font-sans ${
                        r.isEnsemble ? 'text-emerald-300' : 'text-slate-200'
                      }`}
                    >
                      {r.label}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-100">{formatPct(r.probs.home)}</td>
                    <td className="px-3 py-3 text-right text-slate-100">{formatPct(r.probs.draw)}</td>
                    <td className="px-3 py-3 text-right text-slate-100">{formatPct(r.probs.away)}</td>
                    <td className="pl-4 py-3">
                      <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-800">
                        <div
                          style={{ width: `${r.probs.home * 100}%` }}
                          className="bg-emerald-500 h-full"
                          title={`Local ${formatPct(r.probs.home)}`}
                        />
                        <div
                          style={{ width: `${r.probs.draw * 100}%` }}
                          className="bg-amber-500 h-full"
                          title={`Empate ${formatPct(r.probs.draw)}`}
                        />
                        <div
                          style={{ width: `${r.probs.away * 100}%` }}
                          className="bg-slate-400 h-full"
                          title={`Visitante ${formatPct(r.probs.away)}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-5 text-xs text-slate-400 pt-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
              Local
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
              Empate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 inline-block" />
              Visitante
            </span>
          </div>
        </div>

        {/* Interactive Weights Adjuster */}
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Pesos configurables del Ensemble
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Los porcentajes se normalizan automáticamente. En Fase 7 se optimizarán fuera de
              muestra mediante Log Loss.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            {(
              [
                ['poisson', 'Poisson'],
                ['elo', 'Elo dinámico'],
                ['machineLearning', 'Machine Learning'],
                ['recentForm', 'Forma reciente'],
                ['homeAway', 'Local / Visitante'],
              ] as [keyof EnsembleWeights, string][]
            ).map(([key, label]) => {
              const pct = weightSum > 0 ? (weights[key] / weightSum) * 100 : 20;
              return (
                <label key={key} className="block space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">{label}</span>
                    <span className="font-mono text-slate-100">{pct.toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={weights[key]}
                    onChange={(e) => updateWeight(key, parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
