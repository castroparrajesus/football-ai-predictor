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
            Análisis Estructural e Informe Explicativo
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Síntesis explicable basada en Elo dinámico, expectativas Dixon-Coles, forma reciente,
            localía y cobertura real de datos sin valores ficticios.
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
          Carga datos desde PostgreSQL, un archivo CSV o activa el Sandbox de prueba para generar un informe analítico.
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
                <div className="text-xs text-slate-400 font-mono tabular-nums">
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

          {activeMatch.smallSampleWarning && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              {activeMatch.smallSampleWarning}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm text-slate-300 leading-relaxed">
            <div className="space-y-2">
              <h4 className="font-display text-sm font-semibold text-slate-100">
                Lectura probabilística del Ensemble
              </h4>
              <p className="text-xs text-slate-300">
                La combinación calibrada asigna{' '}
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
              {activeMatch.confidenceInterval90 && (
                <p className="text-[11px] font-mono tabular-nums text-slate-400">
                  IC 90% Wilson · Local [{formatPct(activeMatch.confidenceInterval90.home[0], 0)}–{formatPct(activeMatch.confidenceInterval90.home[1], 0)}] · Empate [{formatPct(activeMatch.confidenceInterval90.draw[0], 0)}–{formatPct(activeMatch.confidenceInterval90.draw[1], 0)}] · Visitante [{formatPct(activeMatch.confidenceInterval90.away[0], 0)}–{formatPct(activeMatch.confidenceInterval90.away[1], 0)}]
                </p>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="font-display text-sm font-semibold text-slate-100">
                Balance de ataque, defensa y contexto
              </h4>
              <p className="text-xs text-slate-300">
                {homeTeam && awayTeam
                  ? `${homeTeam.name} (Elo ${homeTeam.eloRating}) suma ${homeTeam.homePerformance.wins}G-${homeTeam.homePerformance.draws}E-${homeTeam.homePerformance.losses}P en casa; xG acumulado: ${homeTeam.xg ?? 'N/D'}. ${awayTeam.name} (Elo ${awayTeam.eloRating}) registra xGA: ${awayTeam.xga ?? 'N/D'} y ${awayTeam.restDays ?? 'N/D'} días desde su último partido en BD.`
                  : 'Registro con parámetros lambda calculados; sin tabla completa de estadísticas por equipo.'}
              </p>
            </div>
          </div>

          {activeMatch.keyFactors && activeMatch.keyFactors.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
              {activeMatch.keyFactors.map((kf) => (
                <div
                  key={kf.label}
                  className="px-3 py-2 rounded-md border border-slate-800 bg-[#0B0F17] flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-slate-400">{kf.label}</span>
                  <span className="font-mono tabular-nums text-slate-200">{kf.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-slate-800 text-xs text-slate-400">
            <strong className="text-slate-300">Motivos de calificación ({activeMatch.confidenceTier}):</strong>{' '}
            {activeMatch.confidenceReasons.join(' ')}
          </div>
        </div>
      )}
    </div>
  );
};
