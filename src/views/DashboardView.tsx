import React from 'react';
import { AlertCircle, ArrowUpRight, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import {
  CalibrationBin,
  LeagueFilter,
  MatchRecord,
  NavSectionId,
  PredictionHistoryItem,
  QualityFilterThresholds,
  ValueOpportunity,
} from '../types/football';
import { LEAGUES_CATALOG, SANDBOX_TREND_SERIES } from '../data/sandboxDataset';
import { formatPct } from '../utils/previewMath';
import { CalibrationCurveChart, ProbabilisticTrendChart } from '../components/charts/SimpleCharts';

interface DashboardViewProps {
  matches: MatchRecord[];
  selectedLeague: LeagueFilter;
  history: PredictionHistoryItem[];
  calibrationBins: CalibrationBin[];
  valueOpportunities: ValueOpportunity[];
  thresholds: QualityFilterThresholds;
  onToggleStrictNoForce: () => void;
  onAnalyzeMatch: (match: MatchRecord) => void;
  onNavigate: (section: NavSectionId) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  matches,
  selectedLeague,
  history,
  calibrationBins,
  valueOpportunities,
  thresholds,
  onToggleStrictNoForce,
  onAnalyzeMatch,
  onNavigate,
}) => {
  const settled = history.filter((h) => h.status !== 'pendiente');
  const avgBrier =
    settled.length > 0
      ? settled.reduce((sum, h) => sum + (h.brierScore ?? 0), 0) / settled.length
      : null;
  const avgLogLoss =
    settled.length > 0
      ? settled.reduce((sum, h) => sum + (h.logLoss ?? 0), 0) / settled.length
      : null;
  const totalRoiUnits = settled.reduce((sum, h) => sum + (h.simulatedRoiUnit ?? 0), 0);

  const qualifiedPicks = thresholds.strictModeNoForce
    ? []
    : valueOpportunities.filter(
        (v) =>
          v.hasStatisticalValue &&
          (v.confidenceTier === 'A' || v.confidenceTier === 'B')
      );

  const discardedMatches = matches.filter((m) => m.confidenceTier === 'DESCARTADO');
  const incompleteMatches = matches.filter((m) => m.dataCompleteness < 85);

  const leagueName =
    selectedLeague === 'all'
      ? '5 Grandes Ligas'
      : LEAGUES_CATALOG.find((l) => l.id === selectedLeague)?.name ?? selectedLeague;

  return (
    <div className="space-y-8">
      {/* KPI Summary Strip */}
      <section aria-label="Resumen del día">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
            <div className="text-xs text-slate-400">Partidos próximos ({leagueName})</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="font-mono text-2xl font-semibold text-slate-100">
                {matches.length}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('matches_today')}
                className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
              >
                <span>Ver calendario</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
            <div className="text-xs text-slate-400">Selecciones con filtro A/B + EV</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="font-mono text-2xl font-semibold text-slate-100">
                {qualifiedPicks.length}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {discardedMatches.length} descartados
              </span>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
            <div className="text-xs text-slate-400">Brier Score / Log Loss medio</div>
            <div className="mt-2 flex items-baseline justify-between font-mono">
              <span className="text-2xl font-semibold text-slate-100">
                {avgBrier !== null ? avgBrier.toFixed(3) : '—'}
              </span>
              <span className="text-xs text-slate-400">
                LL: {avgLogLoss !== null ? avgLogLoss.toFixed(3) : '—'}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
            <div className="text-xs text-slate-400">ROI simulado ({settled.length} liquidadas)</div>
            <div className="mt-2 flex items-baseline justify-between font-mono">
              <span
                className={`text-2xl font-semibold ${
                  settled.length === 0
                    ? 'text-slate-100'
                    : totalRoiUnits >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {settled.length === 0
                  ? '—'
                  : `${totalRoiUnits >= 0 ? '+' : ''}${totalRoiUnits.toFixed(2)} u`}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('performance')}
                className="font-sans text-xs text-slate-400 hover:text-slate-200"
              >
                Detalle
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main 2-column split: Qualified Picks + Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Qualified picks */}
        <section className="xl:col-span-2 rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Selecciones que superan filtros estadísticos
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Requiere Nivel A o B, completitud ≥ {thresholds.minCompletenessPct}% y EV ≥{' '}
                {thresholds.minExpectedValuePct}%.
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleStrictNoForce}
              className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>
                {thresholds.strictModeNoForce ? 'Restaurar umbral' : 'Simular filtro sin picks'}
              </span>
            </button>
          </div>

          {qualifiedPicks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-[#0B0F17] p-6 text-center space-y-2">
              <p className="font-display text-sm font-semibold text-amber-300 tracking-wide">
                HOY NO SE DETECTAN PRONÓSTICOS CON SUFICIENTE CALIDAD ESTADÍSTICA.
              </p>
              <p className="text-xs text-slate-400 max-w-xl mx-auto">
                El sistema no fuerza pronósticos ni rellena el panel cuando no existe ventaja
                matemática verificada, faltan datos o hay discrepancia relevante entre modelos.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="text-left py-2.5 pr-4 font-medium">Partido</th>
                    <th className="text-left py-2.5 px-3 font-medium">Mercado / Selección</th>
                    <th className="text-right py-2.5 px-3 font-medium">Prob. Modelo</th>
                    <th className="text-right py-2.5 px-3 font-medium">Cuota</th>
                    <th className="text-right py-2.5 px-3 font-medium">EV</th>
                    <th className="text-right py-2.5 pl-3 font-medium">Nivel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 tabular-nums">
                  {qualifiedPicks.map((pick) => {
                    const matchObj = matches.find((m) => m.id === pick.matchId);
                    return (
                      <tr key={pick.id} className="hover:bg-slate-800/30">
                        <td className="py-3 pr-4 font-medium text-slate-200">
                          {matchObj ? (
                            <button
                              type="button"
                              onClick={() => onAnalyzeMatch(matchObj)}
                              className="hover:text-emerald-400 text-left transition-colors"
                            >
                              {pick.matchLabel}
                            </button>
                          ) : (
                            pick.matchLabel
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          {pick.market} · <span className="text-slate-100">{pick.selection}</span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-200">
                          {formatPct(pick.modelProb)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-200">
                          {pick.decimalOdds.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-emerald-400 font-medium">
                          +{(pick.expectedValue * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 pl-3 text-right font-mono text-emerald-300">
                          {pick.confidenceTier}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Alerts & Quality Watch */}
        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Alertas de calidad y datos
          </h2>

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-slate-200">Proveedores API pendientes (Fase 4)</div>
                <p className="text-slate-400 mt-0.5">
                  Las claves y conectores de API-Football, Football-Data y The Odds API se
                  integrarán en Fase 4.
                </p>
              </div>
            </div>

            {incompleteMatches.length > 0 ? (
              incompleteMatches.map((m) => (
                <div
                  key={m.id}
                  className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-slate-200">
                      {m.homeTeamName} vs {m.awayTeamName} ({m.dataCompleteness}%)
                    </div>
                    <p className="text-slate-400 mt-0.5">
                      {m.missingDataNotes[0] ?? 'Cobertura de datos por debajo del óptimo.'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400">
                {matches.length === 0
                  ? 'No hay partidos cargados para evaluar alertas.'
                  : 'Todos los partidos cargados superan el 85% de cobertura de variables.'}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Upcoming matches quick table */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Partidos próximos y probabilidades base del Ensemble
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('matches_today')}
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300 whitespace-nowrap"
          >
            Abrir analizador completo
          </button>
        </div>

        {matches.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            No hay partidos disponibles en la vista actual. Importa un CSV o activa el Sandbox de
            prueba para inspeccionar partidos.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="text-left py-2.5 pr-4 font-medium">Fecha / Liga</th>
                  <th className="text-left py-2.5 px-3 font-medium">Encuentro</th>
                  <th className="text-right py-2.5 px-3 font-medium">1 (Local)</th>
                  <th className="text-right py-2.5 px-3 font-medium">X (Empate)</th>
                  <th className="text-right py-2.5 px-3 font-medium">2 (Visitante)</th>
                  <th className="text-right py-2.5 px-3 font-medium">Confianza</th>
                  <th className="text-right py-2.5 pl-3 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 tabular-nums">
                {matches.map((m) => {
                  const lg = LEAGUES_CATALOG.find((l) => l.id === m.leagueId);
                  return (
                    <tr key={m.id} className="hover:bg-slate-800/30">
                      <td className="py-3 pr-4 text-slate-400 whitespace-nowrap">
                        <span className="font-mono text-slate-300">{m.date} {m.kickoffTime}</span>
                        <span className="mx-1.5 text-slate-600">·</span>
                        <span>{lg?.name}</span>
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-100 whitespace-nowrap">
                        {m.homeTeamName} vs {m.awayTeamName}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-200">
                        {formatPct(m.models.ensemble.home)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-200">
                        {formatPct(m.models.ensemble.draw)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-200">
                        {formatPct(m.models.ensemble.away)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
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
                      <td className="py-3 pl-3 text-right">
                        <button
                          type="button"
                          onClick={() => onAnalyzeMatch(m)}
                          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors whitespace-nowrap"
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
      </section>

      {/* Trend & Calibration Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Evolución de métricas probabilísticas
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Seguimiento semanal de Brier Score y Log Loss fuera de muestra.
            </p>
          </div>
          <ProbabilisticTrendChart
            data={matches.length > 0 ? SANDBOX_TREND_SERIES : []}
          />
        </section>

        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Curva de calibración (Probabilidad vs Frecuencia)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              La línea discontinua representa calibración perfecta. Pasa el cursor sobre cada punto.
            </p>
          </div>
          {calibrationBins.length > 0 ? (
            <CalibrationCurveChart bins={calibrationBins} />
          ) : (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
              Sin datos históricos suficientes para generar curva de calibración.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
