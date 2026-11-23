import React, { useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { MatchRecord, TeamStatisticalProfile } from '../types/football';
import { formatPct } from '../utils/previewMath';
import { MissingDataNotice } from '../components/ui/DataSourceBanner';

interface AiAnalysisViewProps {
  matches: MatchRecord[];
  teams: TeamStatisticalProfile[];
  onAnalyzeMatch: (match: MatchRecord) => void;
}

export const AiAnalysisView: React.FC<AiAnalysisViewProps> = ({
  matches,
  teams,
  onAnalyzeMatch,
}) => {
  const [selectedMatchId, setSelectedMatchId] = useState<string>(matches[0]?.id ?? '');
  const activeMatch = matches.find((m) => m.id === selectedMatchId) ?? matches[0] ?? null;

  const homeTeam = activeMatch
    ? teams.find((t) => t.id === activeMatch.homeTeamId)
    : undefined;
  const awayTeam = activeMatch
    ? teams.find((t) => t.id === activeMatch.awayTeamId)
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Análisis IA e Informe Contextual
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Síntesis determinista de factores tácticos, xG, localía y discrepancias. La capa de
            análisis narrativo LLM en servidor se conectará en Fase 4–7 sobre datos reales.
          </p>
        </div>

        {matches.length > 0 && (
          <select
            value={activeMatch?.id ?? ''}
            onChange={(e) => setSelectedMatchId(e.target.value)}
            aria-label="Seleccionar partido para informe"
            className="h-9 px-3 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.homeTeamName} vs {m.awayTeamName} ({m.date})
              </option>
            ))}
          </select>
        )}
      </div>

      {!activeMatch ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">
          Carga un archivo CSV o activa el Sandbox de prueba para generar un informe analítico.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <BrainCircuit className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-100">
                  Informe estructurado: {activeMatch.homeTeamName} vs {activeMatch.awayTeamName}
                </h3>
                <div className="text-xs text-slate-400 font-mono">
                  Confianza: {activeMatch.confidenceTier} · Completitud: {activeMatch.dataCompleteness}% ·
                  Discrepancia: {activeMatch.models.modelSpread} pp
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onAnalyzeMatch(activeMatch)}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              ANALIZAR PARTIDO
            </button>
          </div>

          <MissingDataNotice notes={activeMatch.missingDataNotes} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm text-slate-300 leading-relaxed">
            <div className="space-y-2">
              <h4 className="font-display text-sm font-semibold text-slate-100">
                Lectura probabilística del Ensemble
              </h4>
              <p className="text-xs text-slate-300">
                La combinación ponderada asigna{' '}
                <span className="font-mono text-slate-100">
                  {formatPct(activeMatch.models.ensemble.home)}
                </span>{' '}
                a victoria de {activeMatch.homeTeamName},{' '}
                <span className="font-mono text-slate-100">
                  {formatPct(activeMatch.models.ensemble.draw)}
                </span>{' '}
                al empate y{' '}
                <span className="font-mono text-slate-100">
                  {formatPct(activeMatch.models.ensemble.away)}
                </span>{' '}
                a victoria de {activeMatch.awayTeamName}. Ninguno de estos desenlaces constituye una
                certeza; la dispersión entre modelos es de{' '}
                <span className="font-mono">{activeMatch.models.modelSpread}</span> puntos
                porcentuales.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-display text-sm font-semibold text-slate-100">
                Balance de ataque, defensa y contexto
              </h4>
              <p className="text-xs text-slate-300">
                {homeTeam && awayTeam
                  ? `${homeTeam.name} registra ${homeTeam.xg ?? 'N/D'} xG acumulados y ${homeTeam.homePerformance.wins} victorias en ${homeTeam.homePerformance.played} partidos como local. ${awayTeam.name} presenta ${awayTeam.xga ?? 'N/D'} xGA y ${awayTeam.restDays ?? 'N/D'} días de descanso.`
                  : 'Registro importado con parámetros lambda directos; sin histórico granular de tiros ni xG por equipo.'}
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-xs text-slate-400">
            <strong className="text-slate-300">Motivos de calificación ({activeMatch.confidenceTier}):</strong>{' '}
            {activeMatch.confidenceReasons.join(' ')}
          </div>
        </div>
      )}
    </div>
  );
};
