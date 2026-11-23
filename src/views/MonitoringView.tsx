import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Lock,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  DataAuditReport,
  DataSourceMode,
  LeagueFilter,
  MonitoringConfigState,
  MonitoringDashboardData,
  OddsHistoryTimeline,
  PerformanceBreakdownRow,
} from '../types/football';

type MonitoringTab = 'alerts' | 'quality' | 'odds' | 'tracking';

interface MonitoringViewProps {
  dataSourceMode: DataSourceMode;
  selectedLeague: LeagueFilter;
  monitoring: MonitoringDashboardData | null;
  oddsTimelines: OddsHistoryTimeline[];
  auditReport: DataAuditReport | null;
  isLoading: boolean;
  actionMessage: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onUpdateConfig: (partial: Partial<MonitoringConfigState>) => void;
  onCaptureOddsNow: (league: LeagueFilter) => void;
  onCaptureUpcomingPredictions: (league: LeagueFilter) => void;
  onAutoSettle: () => void;
}

const LEAGUE_LABELS: Record<string, string> = {
  premier_league: 'Premier League',
  laliga: 'LaLiga',
  serie_a: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
};

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: PerformanceBreakdownRow[];
}) {
  return (
    <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-4 space-y-3">
      <h4 className="font-display text-sm font-semibold text-slate-100">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">
          Sin pronósticos pre-partido registrados en este desglose.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left py-2 pr-3 font-medium">Grupo</th>
                <th className="text-right px-2 py-2 font-medium">Reg. / Liq.</th>
                <th className="text-right px-2 py-2 font-medium">Acierto (IC 95%)</th>
                <th className="text-right px-2 py-2 font-medium">Brier</th>
                <th className="text-right px-2 py-2 font-medium">LogLoss</th>
                <th className="text-right px-2 py-2 font-medium">ECE</th>
                <th className="text-right px-2 py-2 font-medium">ROI Real</th>
                <th className="text-right px-2 py-2 font-medium">Yield</th>
                <th className="text-right pl-2 py-2 font-medium">CLV (N)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {rows.map((r) => (
                <tr key={r.groupKey} className="hover:bg-slate-800/30">
                  <td className="py-2 pr-3 font-sans text-slate-200">{r.groupLabel}</td>
                  <td className="px-2 py-2 text-right text-slate-300">
                    {r.totalPredictions} / {r.settledCount}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-200">
                    {r.hitRatePct !== null ? (
                      <>
                        {r.hitRatePct.toFixed(1)}%
                        {r.hitRateCi95 && (
                          <span className="block text-[10px] text-slate-500">
                            [{r.hitRateCi95[0]}–{r.hitRateCi95[1]}%]
                          </span>
                        )}
                      </>
                    ) : (
                      'N/D'
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-200">
                    {r.brierScore !== null ? r.brierScore.toFixed(4) : 'N/D'}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-200">
                    {r.logLoss !== null ? r.logLoss.toFixed(4) : 'N/D'}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">
                    {r.ece !== null ? r.ece.toFixed(4) : 'N/D'}
                  </td>
                  <td
                    className={`px-2 py-2 text-right ${
                      r.realizedRoiPct === null
                        ? 'text-slate-500'
                        : r.realizedRoiPct >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {r.realizedRoiPct !== null
                      ? `${r.realizedRoiPct >= 0 ? '+' : ''}${r.realizedRoiPct.toFixed(2)}%`
                      : 'N/D'}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">
                    {r.realizedYieldUnits !== null
                      ? `${r.realizedYieldUnits >= 0 ? '+' : ''}${r.realizedYieldUnits.toFixed(2)}u`
                      : 'N/D'}
                  </td>
                  <td className="pl-2 py-2 text-right text-slate-300">
                    {r.clvAvgPct !== null
                      ? `${r.clvAvgPct >= 0 ? '+' : ''}${r.clvAvgPct.toFixed(2)}% (${r.clvSampleCount})`
                      : 'N/D'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  dataSourceMode,
  selectedLeague,
  monitoring,
  oddsTimelines,
  auditReport,
  isLoading,
  actionMessage,
  actionError,
  onRefresh,
  onUpdateConfig,
  onCaptureOddsNow,
  onCaptureUpcomingPredictions,
  onAutoSettle,
}) => {
  const [activeTab, setActiveTab] = useState<MonitoringTab>('alerts');
  const [oddsFilterText, setOddsFilterText] = useState('');
  const [expandedTimelineKey, setExpandedTimelineKey] = useState<string | null>(null);

  if (dataSourceMode !== 'database') {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-[#111827] p-6 space-y-2">
        <h2 className="font-display text-base font-semibold text-slate-100">
          Monitorización, Histórico Inmutable de Cuotas y Seguimiento Real
        </h2>
        <p className="text-xs text-slate-300">
          Cambia el origen de datos a <strong className="text-emerald-400">Base de datos (PostgreSQL)</strong>{' '}
          para consultar alertas operativas, histórico inmutable de cuotas y métricas reales liquidadas.
        </p>
      </div>
    );
  }

  const filteredTimelines = oddsTimelines.filter((t) => {
    if (!oddsFilterText.trim()) return true;
    const q = oddsFilterText.toLowerCase();
    return (
      t.matchLabel.toLowerCase().includes(q) ||
      t.bookmaker.toLowerCase().includes(q) ||
      t.selection.toLowerCase().includes(q)
    );
  });

  const cfg = monitoring?.config;
  const live = monitoring?.liveRealMetrics;

  return (
    <div className="space-y-6">
      {/* Header & Global Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Monitorización, Calidad de Datos e Histórico Inmutable (Fase 6)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Control de degradación, mercados bloqueados, línea de tiempo de cuotas pre-partido,
            seguimiento automático y rendimiento real liquidado.
          </p>
        </div>

        <button
          type="button"
          disabled={isLoading}
          onClick={onRefresh}
          className="h-9 px-3.5 rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-200 inline-flex items-center gap-2 self-start lg:self-auto whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isLoading ? 'Actualizando...' : 'Actualizar monitorización'}</span>
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {(
          [
            ['alerts', 'Alertas, Control y Validación', monitoring?.alerts.length ?? 0],
            ['quality', 'Calidad de Datos y Proveedores', null],
            ['odds', 'Histórico Inmutable de Cuotas', oddsTimelines.length],
            ['tracking', 'Seguimiento y Rendimiento Real', live?.totalPredictionsLogged ?? 0],
          ] as [MonitoringTab, string, number | null][]
        ).map(([tabId, label, count]) => {
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`px-3.5 py-2 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap ${
                active
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                  : 'bg-[#111827] text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>{label}</span>
              {count !== null && (
                <span className="font-mono tabular-nums text-[11px] opacity-80">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {actionMessage && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          {actionError}
        </div>
      )}

      {/* TAB 1: ALERTS, VALIDATION & AUTOMATION CONTROL */}
      {activeTab === 'alerts' && monitoring && (
        <div className="space-y-6">
          {/* Model Validation Status & Blocked Markets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Estado de Validación del Modelo
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Criterio estricto: ≥100 partidos evaluados por liga, LogLoss ≤1.05 y ≥30
                    pronósticos en vivo liquidados.
                  </p>
                </div>
                <span
                  className={`font-mono text-xs font-semibold whitespace-nowrap ${
                    monitoring.modelValidationStatus.isValidated
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }`}
                >
                  {monitoring.modelValidationStatus.isValidated ? 'VALIDADO' : 'NO VALIDADO'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                {monitoring.modelValidationStatus.reasons.map((r) => (
                  <div key={r} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>{r}</span>
                  </div>
                ))}
                {monitoring.modelValidationStatus.reasons.length === 0 && (
                  <div className="flex items-center gap-2 text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Todas las ligas y seguimiento en vivo cumplen los criterios mínimos.</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800 overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead className="text-slate-400 border-b border-slate-800 font-sans">
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium">Liga</th>
                      <th className="text-right px-2 py-2 font-medium">Eval. OOS</th>
                      <th className="text-right px-2 py-2 font-medium">Log Loss</th>
                      <th className="text-right pl-2 py-2 font-medium">Diagnóstico</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {monitoring.modelValidationStatus.byLeague.map((lg) => (
                      <tr key={lg.leagueId}>
                        <td className="py-2 pr-3 font-sans text-slate-200">
                          {LEAGUE_LABELS[lg.leagueId] ?? lg.leagueId}
                        </td>
                        <td className="px-2 py-2 text-right text-slate-300">{lg.evaluatedMatches}</td>
                        <td className="px-2 py-2 text-right text-slate-200">
                          {lg.logLoss !== null ? lg.logLoss.toFixed(4) : '—'}
                        </td>
                        <td
                          className={`pl-2 py-2 text-right ${
                            lg.status === 'validado'
                              ? 'text-emerald-400'
                              : lg.status === 'muestra_pequena'
                              ? 'text-amber-300'
                              : 'text-rose-400'
                          }`}
                        >
                          {lg.status === 'validado'
                            ? 'Validado'
                            : lg.status === 'muestra_pequena'
                            ? 'Muestra <100'
                            : lg.status === 'alerta_degradacion'
                            ? 'Degradación'
                            : 'Sin evaluar'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Blocked Markets & Automation Controls */}
            <div className="space-y-6">
              <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Control de Mercados con Datos Insuficientes
                  </h3>
                </div>
                <div className="space-y-2.5 text-xs">
                  {monitoring.blockedMarkets.map((bm) => (
                    <div
                      key={bm.market}
                      className="rounded-md border border-slate-800 bg-[#0B0F17] p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-200">{bm.market}</span>
                        <span className="font-mono tabular-nums text-[11px] text-rose-400">
                          {bm.currentRows} filas · Req: {bm.requiredMinimum}
                        </span>
                      </div>
                      <p className="text-slate-400">{bm.reason}</p>
                    </div>
                  ))}
                </div>
              </section>

              {cfg && (
                <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400 shrink-0" />
                    <h3 className="font-display text-sm font-semibold text-slate-100">
                      Automatización Pre-partido y Protección de Cuota
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2.5 cursor-pointer">
                      <span className="text-slate-200">Auto-liquidación tras marcador</span>
                      <input
                        type="checkbox"
                        checked={cfg.autoSettleEnabled}
                        onChange={(e) =>
                          onUpdateConfig({ autoSettleEnabled: e.target.checked })
                        }
                        className="accent-emerald-500"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2.5 cursor-pointer">
                      <span className="text-slate-200">Auto-captura The Odds API</span>
                      <input
                        type="checkbox"
                        checked={cfg.autoOddsCaptureEnabled}
                        onChange={(e) =>
                          onUpdateConfig({ autoOddsCaptureEnabled: e.target.checked })
                        }
                        className="accent-sky-500"
                      />
                    </label>

                    <label className="block rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2 space-y-1">
                      <span className="text-slate-400">Intervalo captura (min)</span>
                      <select
                        value={cfg.captureIntervalMinutes}
                        onChange={(e) =>
                          onUpdateConfig({ captureIntervalMinutes: Number(e.target.value) })
                        }
                        className="w-full bg-transparent text-slate-100 font-mono focus:outline-none"
                      >
                        <option value={180}>Cada 3 horas (180m)</option>
                        <option value={360}>Cada 6 horas (360m)</option>
                        <option value={720}>Cada 12 horas (720m)</option>
                        <option value={1440}>Diario (1440m)</option>
                      </select>
                    </label>

                    <label className="block rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2 space-y-1">
                      <span className="text-slate-400">Reserva mínima créditos Odds API</span>
                      <select
                        value={cfg.minRemainingCreditsGuard}
                        onChange={(e) =>
                          onUpdateConfig({ minRemainingCreditsGuard: Number(e.target.value) })
                        }
                        className="w-full bg-transparent text-slate-100 font-mono focus:outline-none"
                      >
                        <option value={25}>25 créditos</option>
                        <option value={50}>50 créditos (Recomendado)</option>
                        <option value={100}>100 créditos</option>
                        <option value={200}>200 créditos</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-slate-500 pt-1">
                    <span>
                      Última captura cuotas:{' '}
                      {cfg.lastAutoOddsRunAt
                        ? cfg.lastAutoOddsRunAt.slice(0, 16).replace('T', ' ') + ' UTC'
                        : 'Manual / Nunca'}
                    </span>
                    <span>
                      Última auto-liquidación:{' '}
                      {cfg.lastAutoSettleRunAt
                        ? cfg.lastAutoSettleRunAt.slice(0, 16).replace('T', ' ') + ' UTC'
                        : 'Pendiente'}
                    </span>
                  </div>
                </section>
              )}
            </div>
          </div>

          {/* Alerts List */}
          <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Alertas Activas del Sistema ({monitoring.alerts.length})
            </h3>
            <div className="space-y-2.5 text-xs">
              {monitoring.alerts.map((al) => {
                const borderColor =
                  al.severity === 'critical'
                    ? 'border-rose-500/35 bg-rose-500/8'
                    : al.severity === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/8'
                    : 'border-sky-500/30 bg-sky-500/8';
                const titleColor =
                  al.severity === 'critical'
                    ? 'text-rose-300'
                    : al.severity === 'warning'
                    ? 'text-amber-300'
                    : 'text-sky-300';
                return (
                  <div key={al.id} className={`rounded-md border p-3.5 space-y-1 ${borderColor}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold flex items-center gap-2 ${titleColor}`}>
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>{al.title}</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase text-slate-400">
                        {al.category.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-slate-300">{al.detail}</p>
                    {al.actionHint && (
                      <p className="text-[11px] text-slate-400">Acción: {al.actionHint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: DATA QUALITY & ENRICHMENT PROVIDERS */}
      {activeTab === 'quality' && monitoring && (
        <div className="space-y-6">
          {auditReport && (
            <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Cobertura Real de Variables Avanzadas en PostgreSQL
                </h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
                <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                  <div className="font-sans text-slate-400">Partidos totales</div>
                  <div className="text-base font-semibold text-slate-100 mt-1">
                    {auditReport.totals.matches}
                  </div>
                </div>
                <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                  <div className="font-sans text-slate-400">Stats Temporada</div>
                  <div className="text-base font-semibold text-emerald-400 mt-1">
                    {auditReport.coverage.teamSeasonStatsRows}
                  </div>
                </div>
                <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                  <div className="font-sans text-slate-400">Stats Partido (Tiros/Córn.)</div>
                  <div className="text-base font-semibold text-amber-300 mt-1">
                    {auditReport.coverage.teamMatchStatsRows}
                  </div>
                </div>
                <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                  <div className="font-sans text-slate-400">Registros xG / xGA</div>
                  <div className="text-base font-semibold text-amber-300 mt-1">
                    {auditReport.coverage.xgRows}
                  </div>
                </div>
                <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                  <div className="font-sans text-slate-400">Alineaciones</div>
                  <div className="text-base font-semibold text-amber-300 mt-1">
                    {auditReport.coverage.lineupRows}
                  </div>
                </div>
                <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                  <div className="font-sans text-slate-400">Bajas / Lesiones</div>
                  <div className="text-base font-semibold text-amber-300 mt-1">
                    {auditReport.coverage.injuryRows}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Evaluación Técnica de Proveedores para Enriquecimiento (Sin Contratar Servicios)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Comparativa auditada de precios, cobertura en las 5 Grandes Ligas, historial, límites
                y términos de uso para xG, tiros, córners, tarjetas, alineaciones y bajas.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="text-left py-2.5 pr-3 font-medium">Proveedor / Estado</th>
                    <th className="text-left px-2 py-2.5 font-medium">Precio y Límites</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">xG</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">Tiros</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">Córn.</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">Tarj.</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">Alin.</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">Bajas</th>
                    <th className="text-center px-1.5 py-2.5 font-medium">Cierre</th>
                    <th className="text-left pl-3 py-2.5 font-medium">Dictamen y ToS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {monitoring.providerEvaluations.map((pe) => {
                    const mark = (v: boolean) => (
                      <span className={`font-mono ${v ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {v ? 'SÍ' : '—'}
                      </span>
                    );
                    const statusColor =
                      pe.status === 'configurado'
                        ? 'text-emerald-400'
                        : pe.status === 'descartado_tos'
                        ? 'text-rose-400'
                        : 'text-amber-300';
                    const statusLabel =
                      pe.status === 'configurado'
                        ? 'Configurado'
                        : pe.status === 'descartado_tos'
                        ? 'Descartado (ToS)'
                        : 'Evaluado (no contratado)';

                    return (
                      <tr key={pe.id} className="align-top hover:bg-slate-800/25">
                        <td className="py-3 pr-3">
                          <div className="font-medium text-slate-100">{pe.name}</div>
                          <div className={`font-mono text-[11px] mt-0.5 ${statusColor}`}>
                            {statusLabel}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-slate-300 max-w-xs">
                          <div>{pe.pricingSummary}</div>
                          <div className="text-[11px] text-slate-500 mt-1">{pe.rateLimits}</div>
                        </td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.xg)}</td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.shots)}</td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.corners)}</td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.cards)}</td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.lineups)}</td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.injuries)}</td>
                        <td className="px-1.5 py-3 text-center">{mark(pe.supports.closingOdds)}</td>
                        <td className="pl-3 py-3 text-slate-300 max-w-sm">
                          <div>{pe.recommendedRole}</div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {pe.historicalAvailability}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: IMMUTABLE ODDS HISTORY */}
      {activeTab === 'odds' && (
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Histórico Inmutable de Cuotas Pre-partido (Apertura → Movimiento → Cierre)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Protegido por trigger append-only en PostgreSQL (bloquea borrados/alteraciones).
                  Cierre marcado automáticamente ≤90 min antes del inicio.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={oddsFilterText}
                  onChange={(e) => setOddsFilterText(e.target.value)}
                  placeholder="Filtrar partido, bookmaker o selección..."
                  className="h-8 px-3 rounded-md border border-slate-700 bg-[#0B0F17] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onCaptureOddsNow(selectedLeague)}
                  className="h-8 px-3.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Capturar snapshot ahora</span>
                </button>
              </div>
            </div>

            {filteredTimelines.length === 0 ? (
              <p className="text-xs text-slate-400 py-4">
                No hay snapshots de cuotas para el filtro seleccionado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-2.5 pr-3 font-medium">Partido / Mercado</th>
                      <th className="text-left px-2 py-2.5 font-medium">Bookmaker</th>
                      <th className="text-left px-2 py-2.5 font-medium">Selección</th>
                      <th className="text-right px-2 py-2.5 font-medium">Apertura</th>
                      <th className="text-right px-2 py-2.5 font-medium">Última</th>
                      <th className="text-right px-2 py-2.5 font-medium">Cierre (≤90m)</th>
                      <th className="text-right px-2 py-2.5 font-medium">Movimiento</th>
                      <th className="text-right pl-2 py-2.5 font-medium">Snaps / Vínc.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {filteredTimelines.slice(0, 120).map((t) => {
                      const rowKey = `${t.matchId}|${t.bookmaker}|${t.market}|${t.selection}`;
                      const isExpanded = expandedTimelineKey === rowKey;
                      return (
                        <React.Fragment key={rowKey}>
                          <tr
                            onClick={() =>
                              setExpandedTimelineKey(isExpanded ? null : rowKey)
                            }
                            className="cursor-pointer hover:bg-slate-800/35"
                          >
                            <td className="py-2.5 pr-3 font-sans">
                              <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                )}
                                <span>{t.matchLabel}</span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 pl-5">
                                {LEAGUE_LABELS[t.leagueId] ?? t.leagueId} · {t.kickoffUtc.slice(0, 16).replace('T', ' ')} UTC · {t.market}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 font-sans text-slate-300">{t.bookmaker}</td>
                            <td className="px-2 py-2.5 font-sans text-slate-200">{t.selection}</td>
                            <td className="px-2 py-2.5 text-right text-slate-300">
                              {t.openingOdds.toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5 text-right text-slate-100 font-semibold">
                              {t.latestOdds.toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5 text-right text-sky-400">
                              {t.closingOdds !== null ? t.closingOdds.toFixed(2) : 'Pendiente'}
                            </td>
                            <td
                              className={`px-2 py-2.5 text-right ${
                                Math.abs(t.deltaPct) < 0.01
                                  ? 'text-slate-500'
                                  : t.deltaOdds < 0
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {t.deltaOdds >= 0 ? '+' : ''}
                              {t.deltaOdds.toFixed(2)} ({t.deltaPct >= 0 ? '+' : ''}
                              {t.deltaPct.toFixed(1)}%)
                            </td>
                            <td className="pl-2 py-2.5 text-right text-slate-300">
                              {t.snapshotCount} / {t.linkedOpportunitiesCount}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-[#0B0F17]">
                              <td colSpan={8} className="px-5 py-3">
                                <div className="text-[11px] font-sans text-slate-400 mb-2">
                                  Línea temporal inmutable ({t.snapshots.length} capturas):
                                </div>
                                <div className="flex flex-wrap gap-3 text-[11px]">
                                  {t.snapshots.map((s) => (
                                    <div
                                      key={s.id}
                                      className="rounded border border-slate-800 bg-[#111827] px-2.5 py-1.5"
                                    >
                                      <div className="text-slate-100 font-semibold">
                                        {s.decimalOdds.toFixed(2)}{' '}
                                        {s.isClosing && (
                                          <span className="text-sky-400 font-normal">[CIERRE]</span>
                                        )}
                                      </div>
                                      <div className="text-slate-500">
                                        {s.capturedAt.slice(0, 16).replace('T', ' ')} UTC (
                                        {s.minutesToKickoff !== null
                                          ? `${s.minutesToKickoff}m antes`
                                          : '—'}
                                        )
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: PRE-MATCH TRACKING & REAL PERFORMANCE */}
      {activeTab === 'tracking' && live && (
        <div className="space-y-6">
          {/* Batch Actions & Disclaimer */}
          <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Seguimiento Automático Pre-partido y Métricas Reales Liquidadas
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Registra pronósticos estrictamente antes del inicio y liquídalos al confirmarse
                  los resultados oficiales.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onCaptureUpcomingPredictions(selectedLeague)}
                  className="h-8 px-3.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Registrar próximas predicciones</span>
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={onAutoSettle}
                  className="h-8 px-3.5 rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Liquidar resultados pendientes</span>
                </button>
              </div>
            </div>

            <div className="rounded-md border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5 text-xs text-amber-200">
              {live.profitabilityDisclaimer}
            </div>

            {/* Real KPIs Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">Registradas</div>
                <div className="text-base font-semibold text-slate-100 mt-1">
                  {live.totalPredictionsLogged}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">Liquidadas / Pend.</div>
                <div className="text-base font-semibold text-slate-100 mt-1">
                  {live.settledCount} / {live.pendingCount}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">Acierto Real</div>
                <div className="text-base font-semibold text-slate-100 mt-1">
                  {live.hitRatePct !== null ? `${live.hitRatePct.toFixed(1)}%` : 'N/D'}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">Brier Score</div>
                <div className="text-base font-semibold text-slate-100 mt-1">
                  {live.brierScore !== null ? live.brierScore.toFixed(4) : 'N/D'}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">Log Loss</div>
                <div className="text-base font-semibold text-slate-100 mt-1">
                  {live.logLoss !== null ? live.logLoss.toFixed(4) : 'N/D'}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">ECE Real</div>
                <div className="text-base font-semibold text-slate-100 mt-1">
                  {live.ece !== null ? live.ece.toFixed(4) : 'N/D'}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">ROI / Yield Real</div>
                <div
                  className={`text-base font-semibold mt-1 ${
                    live.realizedRoiPct === null
                      ? 'text-slate-500'
                      : live.realizedRoiPct >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {live.realizedRoiPct !== null
                    ? `${live.realizedRoiPct >= 0 ? '+' : ''}${live.realizedRoiPct.toFixed(1)}%`
                    : 'N/D'}
                </div>
              </div>
              <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
                <div className="font-sans text-slate-400">CLV Promedio</div>
                <div className="text-base font-semibold text-sky-400 mt-1">
                  {live.clvAvgPct !== null
                    ? `${live.clvAvgPct >= 0 ? '+' : ''}${live.clvAvgPct.toFixed(2)}%`
                    : 'N/D'}
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6">
            <BreakdownTable title="Rendimiento Real por Liga" rows={live.byLeague} />
            <BreakdownTable title="Rendimiento Real por Mercado" rows={live.byMarket} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BreakdownTable title="Rendimiento Real por Temporada" rows={live.bySeason} />
              <BreakdownTable title="Rendimiento Real por Versión de Modelo" rows={live.byModel} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
