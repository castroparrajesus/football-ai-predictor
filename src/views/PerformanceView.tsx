import React, { useState } from 'react';
import { Play, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react';
import {
  ActiveTrainedModelInfo,
  BacktestReproductionResult,
  BacktestRunSummary,
  CalibrationBin,
  DataAuditReport,
  DataSourceMode,
  LeagueFilter,
  PredictionHistoryItem,
} from '../types/football';
import { LEAGUES_CATALOG, SANDBOX_TREND_SERIES } from '../data/sandboxDataset';
import { CalibrationCurveChart, ProbabilisticTrendChart } from '../components/charts/SimpleCharts';

interface PerformanceViewProps {
  history: PredictionHistoryItem[];
  calibrationBins: CalibrationBin[];
  dataSourceMode?: DataSourceMode;
  auditReport?: DataAuditReport | null;
  backtestHistory?: BacktestRunSummary[];
  activeTrainedModel?: ActiveTrainedModelInfo | null;
  isRunningBacktest?: boolean;
  backtestError?: string | null;
  onRunBacktest?: (params: {
    leagueId: LeagueFilter;
    calibrationMethod: 'platt' | 'isotonic' | 'none';
    trainAndActivate: boolean;
  }) => void;
  reproductionResult?: BacktestReproductionResult | null;
  isReproducing?: boolean;
  onReproduceBacktest?: (runId: string) => void;
}

const LEAGUE_NAME_MAP: Record<string, string> = {
  premier_league: 'Premier League',
  laliga: 'LaLiga',
  serie_a: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
  all: 'Todas (5 Ligas)',
};

export const PerformanceView: React.FC<PerformanceViewProps> = ({
  history,
  calibrationBins,
  dataSourceMode = 'sandbox',
  auditReport = null,
  backtestHistory = [],
  activeTrainedModel = null,
  isRunningBacktest = false,
  backtestError = null,
  onRunBacktest,
  reproductionResult = null,
  isReproducing = false,
  onReproduceBacktest,
}) => {
  const [btLeague, setBtLeague] = useState<LeagueFilter>('all');
  const [btCalMethod, setBtCalMethod] = useState<'platt' | 'isotonic' | 'none'>('platt');
  const [trainAndActivate, setTrainAndActivate] = useState<boolean>(true);
  const [selectedRunIdx, setSelectedRunIdx] = useState<number>(0);

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

  const activeBacktest = backtestHistory[selectedRunIdx] ?? backtestHistory[0] ?? null;
  const displayedCalibrationBins =
    dataSourceMode === 'database' && activeBacktest && activeBacktest.calibrationBins.length > 0
      ? activeBacktest.calibrationBins
      : calibrationBins;

  const foldTrendSeries =
    dataSourceMode === 'database' && activeBacktest
      ? activeBacktest.folds.map((f) => ({
          label: `F${f.foldIndex} (${f.endDate.slice(2, 7)})`,
          brier: f.brierScore,
          logLoss: f.logLoss,
          roiPct: 0,
        }))
      : settled.length > 0
      ? SANDBOX_TREND_SERIES
      : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Evaluación Walk-Forward, Calibración y Auditoría de Datos
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Validación estrictamente cronológica sin data leakage, comparación entre modelos frente al
          mercado sin margen, Brier Score, Log Loss, ECE y cobertura real en PostgreSQL.
        </p>
      </div>

      {/* Data Audit Panel (Database Mode) */}
      {dataSourceMode === 'database' && auditReport && (
        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Auditoría de Calidad y Cobertura de Datos (PostgreSQL)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Rango cronológico:{' '}
                <span className="font-mono text-slate-200">
                  {auditReport.totals.dateRangeMinUtc?.slice(0, 10) ?? '—'} →{' '}
                  {auditReport.totals.dateRangeMaxUtc?.slice(0, 10) ?? '—'}
                </span>
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-300">
              Duplicados exactos:{' '}
              <span
                className={
                  auditReport.totals.duplicateFixtureGroups === 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }
              >
                {auditReport.totals.duplicateFixtureGroups}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Partidos totales</div>
              <div className="text-base font-semibold text-slate-100 mt-1">
                {auditReport.totals.matches}
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Finalizados c/ marcador</div>
              <div className="text-base font-semibold text-emerald-400 mt-1">
                {auditReport.totals.finishedWithResults} / {auditReport.totals.finishedMatches}
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Próximos / En juego</div>
              <div className="text-base font-semibold text-slate-100 mt-1">
                {auditReport.totals.scheduledMatches}
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Cuotas vigentes</div>
              <div className="text-base font-semibold text-sky-400 mt-1">
                {auditReport.oddsAudit.upcomingMatchesWithOdds} partidos ({auditReport.oddsAudit.totalOddsRows} filas)
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Cuotas cerradas hist.</div>
              <div className="text-base font-semibold text-slate-300 mt-1">
                {auditReport.oddsAudit.finishedMatchesWithOdds}
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Equipos / Stats Temp.</div>
              <div className="text-base font-semibold text-slate-100 mt-1">
                {auditReport.totals.teams} / {auditReport.coverage.teamSeasonStatsRows}
              </div>
            </div>
          </div>

          {auditReport.missingDataGaps.length > 0 && (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/8 p-3.5 space-y-1.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-300">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Brechas reales detectadas (no se fabrican datos ficticios):</span>
              </div>
              <ul className="list-disc pl-5 text-amber-100/85 space-y-0.5">
                {auditReport.missingDataGaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Walk-Forward Training & Backtesting Runner */}
      {dataSourceMode === 'database' && onRunBacktest && (
        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Entrenamiento y Backtesting Walk-Forward (Zero Data Leakage)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Evalúa en bloques temporales crecientes re-ajustando Dixon-Coles (ρ), Regresión
                Logística L2 y calibración fuera de muestra en cada fold.
              </p>
            </div>

            {activeTrainedModel && (
              <div className="px-3 py-2 rounded-md border border-emerald-500/30 bg-emerald-500/8 text-xs font-mono tabular-nums text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Modelo activo: {activeTrainedModel.calibrationMethod.toUpperCase()} · ρ=
                  {activeTrainedModel.rho} · ML n={activeTrainedModel.mlTrainedSamples}
                  {activeTrainedModel.evalMetrics?.logLoss
                    ? ` · LogLoss ${activeTrainedModel.evalMetrics.logLoss.toFixed(4)}`
                    : ''}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs items-end">
            <label className="block space-y-1.5">
              <span className="text-slate-400">Ámbito de evaluación</span>
              <select
                value={btLeague}
                onChange={(e) => setBtLeague(e.target.value as LeagueFilter)}
                className="w-full h-9 px-3 rounded-md border border-slate-700 bg-[#0B0F17] text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">Todas las 5 Grandes Ligas</option>
                <option value="premier_league">Premier League</option>
                <option value="laliga">LaLiga</option>
                <option value="serie_a">Serie A</option>
                <option value="bundesliga">Bundesliga</option>
                <option value="ligue_1">Ligue 1</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-slate-400">Método de calibración</span>
              <select
                value={btCalMethod}
                onChange={(e) => setBtCalMethod(e.target.value as 'platt' | 'isotonic' | 'none')}
                className="w-full h-9 px-3 rounded-md border border-slate-700 bg-[#0B0F17] text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="platt">Platt Scaling (Logístico L2)</option>
                <option value="isotonic">Calibración Isotónica (PAVA)</option>
                <option value="none">Sin post-calibración</option>
              </select>
            </label>

            <label className="flex items-center gap-2 h-9 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={trainAndActivate}
                onChange={(e) => setTrainAndActivate(e.target.checked)}
                className="accent-emerald-500 rounded"
              />
              <span>Activar parámetros entrenados en vivo</span>
            </label>

            <button
              type="button"
              disabled={isRunningBacktest}
              onClick={() =>
                onRunBacktest({
                  leagueId: btLeague,
                  calibrationMethod: btCalMethod,
                  trainAndActivate,
                })
              }
              className="h-9 px-4 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isRunningBacktest ? 'Entrenando folds...' : 'Entrenar y Evaluar Walk-Forward'}</span>
            </button>
          </div>

          {backtestError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {backtestError}
            </div>
          )}
        </section>
      )}

      {/* Walk-Forward Model Comparison, League & Season Breakdown */}
      {dataSourceMode === 'database' && activeBacktest && (
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Comparativa de Rendimiento por Modelo (Fuera de Muestra · IC 95%)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                  Run <span className="text-slate-200">{activeBacktest.runId}</span> ·{' '}
                  {activeBacktest.evaluatedMatches} partidos evaluados (+{activeBacktest.warmupMatches}{' '}
                  warmup) · {activeBacktest.dateRangeStart} → {activeBacktest.dateRangeEnd} · ρ=
                  {activeBacktest.fittedRho} · ECE={activeBacktest.ece.toFixed(4)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onReproduceBacktest && (
                  <button
                    type="button"
                    disabled={isReproducing}
                    onClick={() => onReproduceBacktest(activeBacktest.runId)}
                    className="h-8 px-3 rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isReproducing ? 'animate-spin' : ''}`} />
                    <span>{isReproducing ? 'Reproduciendo...' : 'Reproducir por Run ID'}</span>
                  </button>
                )}

                {backtestHistory.length > 1 && (
                  <select
                    value={selectedRunIdx}
                    onChange={(e) => setSelectedRunIdx(Number(e.target.value))}
                    aria-label="Seleccionar ejecución histórica de backtesting"
                    className="h-8 px-2.5 rounded-md border border-slate-700 bg-[#0B0F17] text-xs text-slate-200"
                  >
                    {backtestHistory.map((run, idx) => (
                      <option key={run.runId} value={idx}>
                        {run.createdAtUtc.slice(0, 16).replace('T', ' ')} ·{' '}
                        {LEAGUE_NAME_MAP[run.leagueFilter] ?? run.leagueFilter} ·{' '}
                        {run.calibrationMethod} ({run.evaluatedMatches}p)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {reproductionResult && reproductionResult.originalRunId === activeBacktest.runId && (
              <div
                className={`rounded-md border p-3 text-xs font-mono tabular-nums space-y-1 ${
                  reproductionResult.reproducibilityCheck.exactMatch
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                }`}
              >
                <div className="font-sans font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Reproducibilidad {reproductionResult.reproducibilityCheck.exactMatch ? 'VERIFICADA (exactMatch)' : 'CON DIFERENCIAS'} para {reproductionResult.originalRunId}
                  </span>
                </div>
                <div className="text-[11px]">
                  Muestra idéntica: {reproductionResult.reproducibilityCheck.identicalMatchCount ? 'SÍ' : 'NO'} ·{' '}
                  ΔBrier={reproductionResult.reproducibilityCheck.brierDiff.toFixed(6)} ·{' '}
                  ΔLogLoss={reproductionResult.reproducibilityCheck.logLossDiff.toFixed(6)} ·{' '}
                  ΔAcierto={reproductionResult.reproducibilityCheck.accuracyDiff.toFixed(4)}pp ·{' '}
                  ΔECE={reproductionResult.reproducibilityCheck.eceDiff.toFixed(6)}
                </div>
              </div>
            )}

            {activeBacktest.datasetAudit && (
              <div className="rounded-md border border-slate-800 bg-[#0B0F17] p-3.5 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">
                    Auditoría Cronológica de Conjuntos (Warmup vs Evaluación vs Re-ajuste Final)
                  </span>
                  <span
                    className={`font-mono text-[11px] font-medium ${
                      activeBacktest.datasetAudit.leakageAuditPassed
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {activeBacktest.datasetAudit.leakageAuditPassed
                      ? `Zero Leakage · Solapamiento = ${activeBacktest.datasetAudit.overlapCount}`
                      : 'ALERTA DE SOLAPAMIENTO'}
                  </span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {activeBacktest.datasetAudit.explanation}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono tabular-nums text-[11px] text-slate-300">
                  <div>
                    Finalizados cronológicos: <span className="text-slate-100">{activeBacktest.datasetAudit.totalChronologicalFinished}</span>
                  </div>
                  <div>
                    Warmup (no evaluado): <span className="text-slate-100">{activeBacktest.datasetAudit.warmupMatches}</span>{' '}
                    <span className="text-slate-500">({activeBacktest.datasetAudit.warmupEligibleMlSamples} ML)</span>
                  </div>
                  <div>
                    Evaluados OOS: <span className="text-emerald-400">{activeBacktest.datasetAudit.evaluatedMatches}</span>{' '}
                    <span className="text-slate-500">({activeBacktest.datasetAudit.evalEligibleMlSamples} ML)</span>
                  </div>
                  <div>
                    Re-ajuste futuro ML: <span className="text-sky-400">{activeBacktest.datasetAudit.finalLiveRefitSamples}</span>{' '}
                    <span className="text-slate-500">(-{activeBacktest.datasetAudit.warmupSkippedColdStart + activeBacktest.datasetAudit.evalSkippedColdStart} frío)</span>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="text-left py-2.5 pr-4 font-medium">Modelo Predictivo</th>
                    <th className="text-right px-3 py-2.5 font-medium">Muestra</th>
                    <th className="text-right px-3 py-2.5 font-medium">Acierto 1X2 (IC 95%)</th>
                    <th className="text-right px-3 py-2.5 font-medium">Brier ↓ (IC 95%)</th>
                    <th className="text-right px-3 py-2.5 font-medium">Log Loss ↓ (IC 95%)</th>
                    <th className="text-right pl-3 py-2.5 font-medium">ECE Calibración ↓</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                  {activeBacktest.modelMetrics.map((m, idx) => (
                    <tr
                      key={m.modelKey}
                      className={idx === 0 ? 'bg-emerald-500/8 font-semibold' : 'hover:bg-slate-800/30'}
                    >
                      <td className="py-2.5 pr-4 font-sans text-slate-200">{m.modelLabel}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{m.sampleCount}</td>
                      <td className="px-3 py-2.5 text-right text-slate-200">
                        <div>{m.accuracyPct.toFixed(2)}%</div>
                        {m.accuracyCi95 && (
                          <div className="text-[10px] text-slate-500 font-normal">
                            [{m.accuracyCi95[0].toFixed(1)}–{m.accuracyCi95[1].toFixed(1)}%]
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-100">
                        <div>{m.brierScore.toFixed(4)}</div>
                        {m.brierCi95 && (
                          <div className="text-[10px] text-slate-500 font-normal">
                            [{m.brierCi95[0].toFixed(3)}–{m.brierCi95[1].toFixed(3)}]
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-emerald-400">
                        <div>{m.logLoss.toFixed(4)}</div>
                        {m.logLossCi95 && (
                          <div className="text-[10px] text-slate-500 font-normal">
                            [{m.logLossCi95[0].toFixed(3)}–{m.logLossCi95[1].toFixed(3)}]
                          </div>
                        )}
                      </td>
                      <td className="pl-3 py-2.5 text-right text-slate-300">{m.ece.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {activeBacktest.oddsCoverage.note && (
              <p className="text-xs text-amber-300/90 pt-1">
                Nota de mercado y ROI: {activeBacktest.oddsCoverage.note}
              </p>
            )}
          </section>

          {/* League & Season Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Rendimiento Walk-Forward por Liga (con IC 95%)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium">Liga</th>
                      <th className="text-right px-2 py-2 font-medium">Partidos</th>
                      <th className="text-right px-2 py-2 font-medium">Acierto</th>
                      <th className="text-right px-2 py-2 font-medium">Brier</th>
                      <th className="text-right pl-2 py-2 font-medium">Log Loss (IC 95%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {activeBacktest.byLeague.map((lg) => (
                      <tr key={lg.leagueId}>
                        <td className="py-2 pr-3 font-sans text-slate-200">
                          {LEAGUE_NAME_MAP[lg.leagueId] ?? lg.leagueId}
                          {lg.matchesEvaluated < 100 && (
                            <span className="ml-1.5 text-[10px] font-mono text-amber-300">
                              (N&lt;100)
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right text-slate-300">{lg.matchesEvaluated}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{lg.accuracyPct.toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right text-slate-200">{lg.brierScore.toFixed(4)}</td>
                        <td className="pl-2 py-2 text-right text-slate-100">
                          <div>{lg.logLoss.toFixed(4)}</div>
                          {lg.logLossCi95 && (
                            <div className="text-[10px] text-slate-500 font-normal">
                              [{lg.logLossCi95[0].toFixed(3)}–{lg.logLossCi95[1].toFixed(3)}]
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Rendimiento Walk-Forward por Temporada y Folds
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium">Temporada / Bloque</th>
                      <th className="text-right px-2 py-2 font-medium">Partidos</th>
                      <th className="text-right px-2 py-2 font-medium">Acierto</th>
                      <th className="text-right px-2 py-2 font-medium">Brier</th>
                      <th className="text-right pl-2 py-2 font-medium">Log Loss</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {activeBacktest.bySeason.map((ss) => (
                      <tr key={ss.seasonId}>
                        <td className="py-2 pr-3 text-slate-200">{ss.seasonId}</td>
                        <td className="px-2 py-2 text-right text-slate-300">{ss.matchesEvaluated}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{ss.accuracyPct.toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right text-slate-200">{ss.brierScore.toFixed(4)}</td>
                        <td className="pl-2 py-2 text-right text-slate-100">{ss.logLoss.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pt-3 border-t border-slate-800 overflow-x-auto">
                <table className="w-full text-[11px] font-mono tabular-nums">
                  <thead className="text-slate-400 border-b border-slate-800 font-sans">
                    <tr>
                      <th className="text-left py-1.5 pr-2 font-medium">Fold</th>
                      <th className="text-left px-2 py-1.5 font-medium">Ventana Eval.</th>
                      <th className="text-right px-2 py-1.5 font-medium">Train (ML)</th>
                      <th className="text-right px-2 py-1.5 font-medium">Eval N</th>
                      <th className="text-right px-2 py-1.5 font-medium">Brier</th>
                      <th className="text-right px-2 py-1.5 font-medium">LogLoss</th>
                      <th className="text-right pl-2 py-1.5 font-medium">ρ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {activeBacktest.folds.map((f) => (
                      <tr key={f.foldIndex}>
                        <td className="py-1.5 pr-2 text-slate-300">#{f.foldIndex}</td>
                        <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">
                          {f.startDate} → {f.endDate}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-400">
                          {f.trainMatchCount !== undefined
                            ? `${f.trainMatchCount} (${f.trainMlSamplesBeforeFold ?? 0})`
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-300">{f.matchesEvaluated}</td>
                        <td className="px-2 py-1.5 text-right text-slate-200">{f.brierScore.toFixed(4)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-200">{f.logLoss.toFixed(4)}</td>
                        <td className="pl-2 py-1.5 text-right text-slate-400">{f.rhoFitted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Top Live Settled Predictions KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 font-mono tabular-nums">
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">Pronósticos en vivo liquidados</div>
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
          <div className="font-sans text-xs text-slate-400">Brier Score en vivo</div>
          <div className="text-xl font-semibold text-slate-100 mt-1.5">
            {avgBrier !== null ? avgBrier.toFixed(4) : '—'}
          </div>
        </div>
        <div className="p-4 rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="font-sans text-xs text-slate-400">Log Loss en vivo</div>
          <div className="text-xl font-semibold text-slate-100 mt-1.5">
            {avgLogLoss !== null ? avgLogLoss.toFixed(4) : '—'}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Curva de calibración {activeBacktest ? '(Fuera de muestra Walk-Forward)' : ''}
          </h3>
          {displayedCalibrationBins.length > 0 ? (
            <CalibrationCurveChart bins={displayedCalibrationBins} />
          ) : (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500">
              Ejecuta un backtest Walk-Forward o liquida pronósticos para generar la curva de calibración.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Evolución por Folds: Brier Score & Log Loss
          </h3>
          <ProbabilisticTrendChart data={foldTrendSeries} />
        </div>
      </div>

      {/* Live Settled Breakdown by League */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-100">
          Desglose de pronósticos guardados por liga
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
