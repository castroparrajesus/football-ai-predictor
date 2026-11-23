import React, { useState } from 'react';
import { PredictionHistoryItem } from '../types/football';
import { LEAGUES_CATALOG } from '../data/sandboxDataset';
import { formatPct } from '../utils/previewMath';

interface HistoryViewProps {
  history: PredictionHistoryItem[];
  onSettlePrediction: (id: string, outcome: 0 | 1, actualScore: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onSettlePrediction,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pendiente' | 'acertada' | 'fallada'>('all');

  const filtered = history.filter((item) =>
    statusFilter === 'all' ? true : item.status === statusFilter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Historial Inmutable de Predicciones y Liquidación
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Cada registro guarda fecha previa al partido, cuotas vigentes y versión del modelo para
            impedir fuga de información futura.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#111827] border border-slate-800">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'pendiente', label: 'Pendientes' },
            { id: 'acertada', label: 'Acertadas' },
            { id: 'fallada', label: 'Falladas' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatusFilter(t.id as typeof statusFilter)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === t.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">
          No existen predicciones registradas en el historial para el filtro actual. Puedes
          registrar snapshots pre-partido desde el analizador de cualquier encuentro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-[#111827]">
          <table className="w-full text-xs">
            <thead className="bg-[#0F1520] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Registro / Partido</th>
                <th className="text-left px-3 py-3 font-medium">Mercado / Selección</th>
                <th className="text-right px-3 py-3 font-medium">Prob.</th>
                <th className="text-right px-3 py-3 font-medium">Cuota</th>
                <th className="text-right px-3 py-3 font-medium">Brier / LL</th>
                <th className="text-right px-3 py-3 font-medium">ROI u.</th>
                <th className="text-right px-4 py-3 font-medium">Estado / Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 tabular-nums">
              {filtered.map((item) => {
                const league = LEAGUES_CATALOG.find((l) => l.id === item.leagueId);
                return (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{item.matchLabel}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {league?.name} · Pre-kickoff: {item.recordedAtUtc}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">
                      <div>{item.market}: {item.selection}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Esp: {item.expectedScore} · Nivel {item.confidenceTier}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-200">
                      {formatPct(item.predictedProb)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-200">
                      {item.oddsAtPrediction.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-300">
                      {item.brierScore !== null
                        ? `${item.brierScore.toFixed(3)} / ${item.logLoss?.toFixed(3)}`
                        : '—'}
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-mono ${
                        item.simulatedRoiUnit === null
                          ? 'text-slate-500'
                          : item.simulatedRoiUnit >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {item.simulatedRoiUnit !== null
                        ? `${item.simulatedRoiUnit >= 0 ? '+' : ''}${item.simulatedRoiUnit.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.status === 'pendiente' ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSettlePrediction(item.id, 1, '2-1')}
                            className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 font-medium"
                          >
                            Marcar Acierto
                          </button>
                          <button
                            type="button"
                            onClick={() => onSettlePrediction(item.id, 0, '1-1')}
                            className="px-2 py-1 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 font-medium"
                          >
                            Marcar Fallo
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`font-mono ${
                            item.status === 'acertada' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {item.status.toUpperCase()} ({item.actualResult})
                        </span>
                      )}
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
