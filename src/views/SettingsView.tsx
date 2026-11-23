import React, { useState } from 'react';
import { CloudDownload, Database, Download, RefreshCw } from 'lucide-react';
import {
  ActiveTrainedModelInfo,
  DataSourceMode,
  DbStatusSummary,
  LeagueFilter,
  ProviderId,
  ProviderStatusInfo,
  QualityFilterThresholds,
  SyncExecutionSummary,
  SyncLogEntry,
} from '../types/football';

interface SettingsViewProps {
  dataSourceMode: DataSourceMode;
  onChangeDataSource: (mode: DataSourceMode) => void;
  dbStatus: DbStatusSummary | null;
  isMigrating: boolean;
  migrationMessage: string | null;
  onRefreshDbStatus: () => void;
  onRunMigrations: () => void;
  providers: ProviderStatusInfo[];
  syncLogs: SyncLogEntry[];
  isSyncing: boolean;
  syncResult: SyncExecutionSummary | null;
  syncError: string | null;
  onRefreshProviders: () => void;
  onRunSync: (params: {
    provider: ProviderId;
    leagueId: LeagueFilter;
    seasonYear?: number;
    includeOdds: boolean;
  }) => void;
  thresholds: QualityFilterThresholds;
  onUpdateThresholds: (next: QualityFilterThresholds) => void;
  onDownloadCsvTemplate: () => void;
  activeTrainedModel?: ActiveTrainedModelInfo | null;
  backtestCount?: number;
}

const PHASES_ROADMAP = [
  { phase: 'Fase 1', title: 'Diseño de arquitectura y estructura de carpetas', status: 'Completada' },
  { phase: 'Fase 2', title: 'Construcción de interfaz Dark Mode y Dashboard', status: 'Completada' },
  { phase: 'Fase 3', title: 'Base de datos PostgreSQL (Supabase) y persistencia', status: 'Implementada (pendiente credenciales)' },
  { phase: 'Fase 4', title: 'Integración de fuentes de datos reales (Provider Adapter)', status: 'Implementada (esperando claves API)' },
  { phase: 'Fase 5', title: 'Motor predictivo avanzado (Poisson, Dixon-Coles, Elo, ML, Ensemble)', status: 'Pendiente' },
  { phase: 'Fase 6', title: 'Enriquecimiento, histórico inmutable de cuotas, validación y monitorización', status: 'Completada' },
  { phase: 'Fase 7', title: 'Calibración Isotónica / Platt y reproducibilidad determinista', status: 'Pendiente' },
  { phase: 'Fase 8', title: 'Escáner automatizado de mercados y Value Finder', status: 'Pendiente' },
  { phase: 'Fase 9', title: 'Registro inmutable pre-partido, CLV y liquidación automática', status: 'Completada' },
  { phase: 'Fase 10', title: 'Backtesting walk-forward por temporadas e IC 95%', status: 'Pendiente' },
  { phase: 'Fase 11', title: 'Despliegue Docker, seguridad y documentación final', status: 'Pendiente' },
];

const LEAGUE_OPTIONS: { id: LeagueFilter; label: string }[] = [
  { id: 'all', label: 'Las 5 Grandes Ligas' },
  { id: 'premier_league', label: 'Premier League (Inglaterra)' },
  { id: 'laliga', label: 'LaLiga (España)' },
  { id: 'serie_a', label: 'Serie A (Italia)' },
  { id: 'bundesliga', label: 'Bundesliga (Alemania)' },
  { id: 'ligue_1', label: 'Ligue 1 (Francia)' },
];

function summarizeCoverage(p: ProviderStatusInfo): string {
  const parts: string[] = [];
  if (p.capabilities.supportsSchedules) parts.push('Calendario');
  if (p.capabilities.supportsHistoricalResults) parts.push('Resultados');
  if (p.capabilities.supportsStandings) parts.push('Tablas');
  if (p.capabilities.supportsTeamStats) parts.push('GF/GA');
  if (p.capabilities.supportsOdds) parts.push('Cuotas 1X2 / O-U');
  parts.push(p.capabilities.supportsXg ? 'xG' : 'Sin xG');
  return parts.join(' · ');
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  dataSourceMode,
  onChangeDataSource,
  dbStatus,
  isMigrating,
  migrationMessage,
  onRefreshDbStatus,
  onRunMigrations,
  providers,
  syncLogs,
  isSyncing,
  syncResult,
  syncError,
  onRefreshProviders,
  onRunSync,
  thresholds,
  onUpdateThresholds,
  onDownloadCsvTemplate,
  activeTrainedModel = null,
  backtestCount = 0,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('football_data');
  const [selectedLeague, setSelectedLeague] = useState<LeagueFilter>('premier_league');
  const [selectedSeasonYear, setSelectedSeasonYear] = useState<string>('auto');
  const [includeOdds, setIncludeOdds] = useState<boolean>(true);

  const fase3StatusText =
    dbStatus?.connected && dbStatus?.schemaReady
      ? 'Completada y conectada'
      : 'Implementada (esperando Supabase)';

  const anyConfiguredProvider = providers.some((p) => p.configured);
  const anySuccessfulSync = syncLogs.some((l) => l.status === 'success' || l.status === 'partial');
  const fase4StatusText = anySuccessfulSync
    ? 'Completada y sincronizada'
    : anyConfiguredProvider
    ? 'Lista para sincronizar'
    : 'Implementada (esperando claves API)';

  const hasTrainedPhase5 = Boolean(activeTrainedModel && backtestCount > 0);
  const fase5StatusText = hasTrainedPhase5 ? 'Completada y activa' : 'Implementada (lista para entrenar)';

  const activeProviderMeta = providers.find((p) => p.id === selectedProvider);
  const oddsProviderConfigured = Boolean(
    providers.find((p) => p.id === 'the_odds_api')?.configured
  );
  const canRunSync = Boolean(
    dbStatus?.connected &&
      dbStatus?.schemaReady &&
      activeProviderMeta?.configured &&
      !isSyncing
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Configuración, Base de Datos Supabase y Sincronización Real
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Estado real de conexión a PostgreSQL, adaptadores de fuentes deportivas (Fase 4),
          migraciones SQL y umbrales estadísticos.
        </p>
      </div>

      {/* Supabase / PostgreSQL Connection Status Panel */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Conexión PostgreSQL (Supabase)
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefreshDbStatus}
              className="px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Verificar conexión</span>
            </button>

            <button
              type="button"
              onClick={onRunMigrations}
              disabled={!dbStatus?.connected || isMigrating}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white whitespace-nowrap shrink-0"
            >
              {isMigrating ? 'Ejecutando...' : 'Ejecutar migraciones SQL'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
          <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
            <div className="font-sans text-slate-400">Estado conexión</div>
            <div
              className={`mt-1 font-semibold ${
                dbStatus?.connected ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {dbStatus?.connected
                ? 'CONECTADA'
                : dbStatus?.configured
                ? 'ERROR DE RED'
                : 'NO CONFIGURADA'}
            </div>
          </div>
          <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
            <div className="font-sans text-slate-400">Esquema SQL</div>
            <div
              className={`mt-1 font-semibold ${
                dbStatus?.schemaReady ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {dbStatus?.schemaReady ? 'MIGRADO' : 'PENDIENTE'}
            </div>
          </div>
          <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
            <div className="font-sans text-slate-400">Partidos / Equipos BD</div>
            <div className="mt-1 text-slate-100">
              {dbStatus?.counts.matches ?? 0} / {dbStatus?.counts.teams ?? 0}
            </div>
          </div>
          <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
            <div className="font-sans text-slate-400">Pronósticos guardados</div>
            <div className="mt-1 text-slate-100">{dbStatus?.counts.predictions ?? 0}</div>
          </div>
        </div>

        {dbStatus?.error && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/8 p-3 text-xs text-amber-200 space-y-1">
            <div className="font-semibold">Diagnóstico:</div>
            <p>{dbStatus.error}</p>
            <p className="text-slate-300">
              Configura <code className="font-mono text-slate-100">DATABASE_URL</code>,{' '}
              <code className="font-mono text-slate-100">SUPABASE_URL</code> y{' '}
              <code className="font-mono text-slate-100">SUPABASE_ANON_KEY</code> en el panel
              Secrets siguiendo <code className="font-mono text-slate-100">SUPABASE_SETUP.md</code>.
            </p>
          </div>
        )}

        {migrationMessage && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            {migrationMessage}
          </div>
        )}

        <div className="text-[11px] text-slate-400 font-mono tabular-nums flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Última importación:{' '}
            {dbStatus?.lastImportAt
              ? `${dbStatus.lastImportAt.slice(0, 19).replace('T', ' ')} UTC (${dbStatus.lastImportFilename ?? 'CSV'})`
              : 'Ninguna'}
          </span>
          <span>
            Último pronóstico:{' '}
            {dbStatus?.lastPredictionAt
              ? `${dbStatus.lastPredictionAt.slice(0, 19).replace('T', ' ')} UTC`
              : 'Ninguno'}
          </span>
        </div>
      </section>

      {/* Phase 4: Real Football API Providers & Sync Controls */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CloudDownload className="w-4 h-4 text-sky-400 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Sincronización de APIs Deportivas Reales (Fase 4)
              </h3>
              <p className="text-xs text-slate-400">
                Las claves se leen exclusivamente desde variables de entorno del servidor (nunca en el navegador).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefreshProviders}
            className="px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar estado APIs</span>
          </button>
        </div>

        {/* Provider Capabilities & Secret Status Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left py-2.5 pr-4 font-medium">Proveedor</th>
                <th className="text-left px-3 py-2.5 font-medium">Cobertura verificada</th>
                <th className="text-left px-3 py-2.5 font-medium">Límites y tarifa</th>
                <th className="text-left px-3 py-2.5 font-medium">Cuota / Último sync</th>
                <th className="text-right pl-3 py-2.5 font-medium">Credencial</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {providers.map((p) => (
                <tr key={p.id} className="hover:bg-slate-900/40">
                  <td className="py-3 pr-4 align-top">
                    <div className="font-medium text-slate-100 whitespace-nowrap">{p.name}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">{p.envVarName}</div>
                  </td>
                  <td className="px-3 py-3 align-top text-slate-300">
                    <div>{summarizeCoverage(p)}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{p.capabilities.termsNote}</div>
                  </td>
                  <td className="px-3 py-3 align-top text-slate-400">
                    <div>{p.capabilities.pricingSummary}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{p.capabilities.rateLimitSummary}</div>
                  </td>
                  <td className="px-3 py-3 align-top font-mono tabular-nums text-[11px] text-slate-300 whitespace-nowrap">
                    <div>{p.quotaRemaining ?? 'Sin consultar aún'}</div>
                    <div className="text-slate-500 mt-0.5">
                      {p.lastSyncedAt
                        ? `${p.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC`
                        : 'Sin sincronizaciones'}
                    </div>
                  </td>
                  <td className="pl-3 py-3 align-top text-right whitespace-nowrap">
                    <span
                      className={`font-mono text-xs font-medium ${
                        p.configured ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {p.configured ? 'Configurada' : `Falta Secret`}
                    </span>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    Cargando estado de proveedores desde el servidor...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Manual Sync Controls */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <label className="block space-y-1.5">
              <span className="text-slate-400">Proveedor fuente</span>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
                className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="football_data">Football-Data.org (v4)</option>
                <option value="api_football">API-Football (API-Sports v3)</option>
                <option value="the_odds_api">The Odds API (v4 — solo cuotas)</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-slate-400">Competición objetivo</span>
              <select
                value={selectedLeague}
                onChange={(e) => setSelectedLeague(e.target.value as LeagueFilter)}
                className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                {LEAGUE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-slate-400">Temporada</span>
              <select
                value={selectedSeasonYear}
                disabled={selectedProvider === 'the_odds_api'}
                onChange={(e) => setSelectedSeasonYear(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100 disabled:opacity-50 focus:outline-none focus:border-emerald-500"
              >
                <option value="auto">Actual (2026/27)</option>
                <option value="2025">2025/26</option>
                <option value="2024">2024/25 (Free API-Football)</option>
                <option value="2023">2023/24 (Free API-Football)</option>
                <option value="2022">2022/23 (Free API-Football)</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  onRunSync({
                    provider: selectedProvider,
                    leagueId: selectedLeague,
                    seasonYear:
                      selectedSeasonYear === 'auto' ? undefined : Number(selectedSeasonYear),
                    includeOdds: selectedProvider !== 'the_odds_api' && includeOdds,
                  })
                }
                disabled={!canRunSync}
                className="w-full px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <CloudDownload className="w-3.5 h-3.5" />
                <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar con PostgreSQL'}</span>
              </button>
            </div>
          </div>

          {selectedProvider !== 'the_odds_api' && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeOdds}
                disabled={!oddsProviderConfigured}
                onChange={(e) => setIncludeOdds(e.target.checked)}
                className="accent-sky-500 rounded"
              />
              <span>
                Anexar cuotas de The Odds API tras sincronizar partidos{' '}
                {!oddsProviderConfigured && '(requiere ODDS_API_KEY en Secrets)'}
              </span>
            </label>
          )}

          {activeProviderMeta && !activeProviderMeta.configured && (
            <p className="text-xs text-amber-300">
              Para habilitar {activeProviderMeta.name}, añade el secreto{' '}
              <code className="font-mono text-slate-100">{activeProviderMeta.envVarName}</code> en
              Settings → Secrets y reinicia el servidor.
            </p>
          )}

          {syncError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {syncError}
            </div>
          )}

          {syncResult && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200 space-y-1">
              <div className="font-medium font-mono tabular-nums">
                Sincronización completada ({syncResult.leaguesSynced.length} liga/s):{' '}
                {syncResult.teamsUpserted} equipos nuevos, {syncResult.matchesUpserted} partidos
                actualizados, {syncResult.oddsInserted} cuotas guardadas ({syncResult.requestsUsed}{' '}
                peticiones usadas).
              </div>
              {syncResult.warnings.length > 0 && (
                <div className="text-slate-300">
                  Notas de cobertura: {syncResult.warnings.join(' ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sync Audit Logs */}
        {syncLogs.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <h4 className="text-xs font-medium text-slate-300">
              Historial de sincronizaciones recientes (PostgreSQL)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="text-slate-400 border-b border-slate-800 font-sans">
                  <tr>
                    <th className="text-left py-2 pr-3 font-medium">Fecha UTC</th>
                    <th className="text-left px-2 py-2 font-medium">Proveedor</th>
                    <th className="text-left px-2 py-2 font-medium">Liga</th>
                    <th className="text-left px-2 py-2 font-medium">Estado</th>
                    <th className="text-right px-2 py-2 font-medium">Partidos</th>
                    <th className="text-right px-2 py-2 font-medium">Cuotas</th>
                    <th className="text-left pl-3 py-2 font-medium">Detalle / Cuota</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {syncLogs.slice(0, 8).map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                        {log.syncedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="px-2 py-2 text-slate-200 whitespace-nowrap">{log.providerId}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{log.leagueId ?? '—'}</td>
                      <td
                        className={`px-2 py-2 whitespace-nowrap ${
                          log.status === 'success'
                            ? 'text-emerald-400'
                            : log.status === 'partial'
                            ? 'text-amber-300'
                            : 'text-rose-400'
                        }`}
                      >
                        {log.status.toUpperCase()}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-200">{log.matchesUpserted}</td>
                      <td className="px-2 py-2 text-right text-slate-200">{log.oddsInserted}</td>
                      <td className="pl-3 py-2 font-sans text-slate-400 max-w-xs truncate">
                        {log.errorMessage ?? log.quotaRemaining ?? log.warnings[0] ?? 'OK'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quality Filter Settings */}
        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Umbrales del Filtro de Calidad
          </h3>

          <div className="space-y-4 text-xs">
            <label className="block space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Completitud mínima de datos</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {thresholds.minCompletenessPct}%
                </span>
              </div>
              <input
                type="range"
                min="40"
                max="95"
                step="5"
                value={thresholds.minCompletenessPct}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...thresholds,
                    minCompletenessPct: Number(e.target.value),
                  })
                }
                className="w-full accent-emerald-500"
              />
            </label>

            <label className="block space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Discrepancia máxima entre modelos</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {thresholds.maxModelSpreadPct} pp
                </span>
              </div>
              <input
                type="range"
                min="4"
                max="25"
                step="1"
                value={thresholds.maxModelSpreadPct}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...thresholds,
                    maxModelSpreadPct: Number(e.target.value),
                  })
                }
                className="w-full accent-emerald-500"
              />
            </label>

            <label className="block space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Valor Esperado (EV) mínimo requerido</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {thresholds.minExpectedValuePct}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="0.5"
                value={thresholds.minExpectedValuePct}
                onChange={(e) =>
                  onUpdateThresholds({
                    ...thresholds,
                    minExpectedValuePct: Number(e.target.value),
                  })
                }
                className="w-full accent-emerald-500"
              />
            </label>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div className="text-slate-200 font-medium">Modo sin picks forzados (Prueba)</div>
                <div className="text-slate-400">
                  Fuerza el estado de 0 selecciones recomendadas para verificar la UI.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateThresholds({
                    ...thresholds,
                    strictModeNoForce: !thresholds.strictModeNoForce,
                  })
                }
                className={`px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 ${
                  thresholds.strictModeNoForce
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {thresholds.strictModeNoForce ? 'Activo' : 'Inactivo'}
              </button>
            </div>
          </div>
        </section>

        {/* Data Source & CSV */}
        <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Origen de Datos y Plantilla CSV
          </h3>

          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['database', 'Base de datos (PostgreSQL)'],
                  ['sandbox', 'Sandbox aislado (Sintético)'],
                  ['csv', 'CSV temporal en memoria'],
                  ['none', 'Sin datos'],
                ] as [DataSourceMode, string][]
              ).map(([modeId, label]) => (
                <button
                  key={modeId}
                  type="button"
                  onClick={() => onChangeDataSource(modeId)}
                  className={`px-3 py-2 rounded-md border text-xs font-medium transition-colors whitespace-nowrap ${
                    dataSourceMode === modeId
                      ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300'
                      : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-4">
              <div className="text-slate-400">
                Descarga la plantilla CSV compatible (soporta también cabeceras de
                Football-Data.co.uk como HomeTeam, AwayTeam, FTHG, FTAG, B365H/D/A, HS/AS, HC/AC).
              </div>
              <button
                type="button"
                onClick={onDownloadCsvTemplate}
                className="px-3.5 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Plantilla CSV</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* 11-Phase Roadmap Tracker */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-100">
          Estado del Plan de Desarrollo (Fases 1–11)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
          {PHASES_ROADMAP.map((item) => {
            const label =
              item.phase === 'Fase 3'
                ? fase3StatusText
                : item.phase === 'Fase 4'
                ? fase4StatusText
                : ['Fase 5', 'Fase 6', 'Fase 7', 'Fase 8', 'Fase 10'].includes(item.phase)
                ? fase5StatusText
                : item.status;
            const isDone = label.startsWith('Completada');
            return (
              <div
                key={item.phase}
                className="px-3.5 py-2.5 rounded-md border border-slate-800 bg-[#0B0F17] flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-mono text-slate-400 mr-2">{item.phase}:</span>
                  <span className="text-slate-200">{item.title}</span>
                </div>
                <span
                  className={`font-mono whitespace-nowrap ${
                    isDone
                      ? 'text-emerald-400'
                      : label.includes('Implementada') || label.includes('Lista')
                      ? 'text-amber-300'
                      : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
