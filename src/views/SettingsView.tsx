import React from 'react';
import { Database, Download, RefreshCw } from 'lucide-react';
import {
  DataSourceMode,
  DbStatusSummary,
  QualityFilterThresholds,
} from '../types/football';

interface SettingsViewProps {
  dataSourceMode: DataSourceMode;
  onChangeDataSource: (mode: DataSourceMode) => void;
  dbStatus: DbStatusSummary | null;
  isMigrating: boolean;
  migrationMessage: string | null;
  onRefreshDbStatus: () => void;
  onRunMigrations: () => void;
  thresholds: QualityFilterThresholds;
  onUpdateThresholds: (next: QualityFilterThresholds) => void;
  onDownloadCsvTemplate: () => void;
}

const PHASES_ROADMAP = [
  { phase: 'Fase 1', title: 'Diseño de arquitectura y estructura de carpetas', status: 'Completada' },
  { phase: 'Fase 2', title: 'Construcción de interfaz Dark Mode y Dashboard', status: 'Completada' },
  { phase: 'Fase 3', title: 'Base de datos PostgreSQL (Supabase) y persistencia', status: 'Implementada (pendiente credenciales)' },
  { phase: 'Fase 4', title: 'Integración de fuentes de datos reales (Provider Adapter)', status: 'Pendiente' },
  { phase: 'Fase 5', title: 'Implementación del modelo Poisson / Dixon-Coles en backend', status: 'Pendiente' },
  { phase: 'Fase 6', title: 'Elo dinámico y modelos Machine Learning', status: 'Pendiente' },
  { phase: 'Fase 7', title: 'Ensemble y calibración Isotónica / Platt', status: 'Pendiente' },
  { phase: 'Fase 8', title: 'Escáner automatizado de mercados y Value Finder', status: 'Pendiente' },
  { phase: 'Fase 9', title: 'Registro inmutable pre-partido y liquidación automática', status: 'Pendiente' },
  { phase: 'Fase 10', title: 'Backtesting walk-forward por temporadas', status: 'Pendiente' },
  { phase: 'Fase 11', title: 'Despliegue Docker, seguridad y documentación final', status: 'Pendiente' },
];

const DATA_PROVIDERS = [
  {
    name: 'Football-Data.org',
    coverage: '5 Grandes Ligas (calendario, tablas, marcadores)',
    limits: 'Tier gratuito ~10 req/min; sin xG ni alineaciones detalladas',
    status: 'Adaptador planificado (Fase 4)',
  },
  {
    name: 'API-Football (API-Sports)',
    coverage: 'Estadísticas de partido, lesiones, alineaciones y cuotas pre-partido',
    limits: 'Plan gratuito 100 req/día; planes pagos desde ~19 USD/mes',
    status: 'Adaptador planificado (Fase 4)',
  },
  {
    name: 'Sportmonks Football API',
    coverage: 'Eventos detallados, xG en planes superiores, lesiones y alineaciones',
    limits: 'Tarificación modular por competición',
    status: 'Adaptador planificado (Fase 4)',
  },
  {
    name: 'The Odds API',
    coverage: 'Cuotas decimales multi-bookmaker (1X2, Over/Under)',
    limits: 'Tier gratuito 500 créditos/mes',
    status: 'Adaptador planificado (Fase 4)',
  },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  dataSourceMode,
  onChangeDataSource,
  dbStatus,
  isMigrating,
  migrationMessage,
  onRefreshDbStatus,
  onRunMigrations,
  thresholds,
  onUpdateThresholds,
  onDownloadCsvTemplate,
}) => {
  const fase3StatusText =
    dbStatus?.connected && dbStatus?.schemaReady
      ? 'Completada y conectada'
      : 'Implementada (esperando Supabase)';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Configuración, Base de Datos Supabase y Plan de Fases
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Estado real de conexión a PostgreSQL, ejecución de migraciones, umbrales estadísticos y
          separación de orígenes de datos.
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
              className="px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Verificar conexión</span>
            </button>

            <button
              type="button"
              onClick={onRunMigrations}
              disabled={!dbStatus?.connected || isMigrating}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white"
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
              {dbStatus?.connected ? 'CONECTADA' : dbStatus?.configured ? 'ERROR DE RED' : 'NO CONFIGURADA'}
            </div>
          </div>
          <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
            <div className="font-sans text-slate-400">Esquema SQL</div>
            <div
              className={`mt-1 font-semibold ${
                dbStatus?.schemaReady ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {dbStatus?.schemaReady ? 'MIGRADO (15 tablas)' : 'PENDIENTE'}
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

        <div className="text-[11px] text-slate-400 font-mono flex flex-wrap gap-x-6 gap-y-1">
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
                <span className="font-mono text-slate-100">{thresholds.minCompletenessPct}%</span>
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
                <span className="font-mono text-slate-100">{thresholds.maxModelSpreadPct} pp</span>
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
                <span className="font-mono text-slate-100">{thresholds.minExpectedValuePct}%</span>
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

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
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
                className={`px-3 py-1.5 rounded-md border text-xs font-medium ${
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
                  className={`px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
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

      {/* Researched Data Providers */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-100">
          Proveedores de Datos Evaluados (Arquitectura Desacoplada)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="text-left py-2.5 pr-4 font-medium">Proveedor</th>
                <th className="text-left px-3 py-2.5 font-medium">Cobertura</th>
                <th className="text-left px-3 py-2.5 font-medium">Límites y licenciamiento</th>
                <th className="text-right pl-3 py-2.5 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {DATA_PROVIDERS.map((p) => (
                <tr key={p.name}>
                  <td className="py-2.5 pr-4 font-medium text-slate-200 whitespace-nowrap">{p.name}</td>
                  <td className="px-3 py-2.5 text-slate-300">{p.coverage}</td>
                  <td className="px-3 py-2.5 text-slate-400">{p.limits}</td>
                  <td className="pl-3 py-2.5 text-right text-amber-300 whitespace-nowrap">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 11-Phase Roadmap Tracker */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-100">
          Estado del Plan de Desarrollo (Fases 1–11)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
          {PHASES_ROADMAP.map((item) => {
            const label = item.phase === 'Fase 3' ? fase3StatusText : item.status;
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
                    isDone ? 'text-emerald-400' : label.includes('Implementada') ? 'text-amber-300' : 'text-slate-500'
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
