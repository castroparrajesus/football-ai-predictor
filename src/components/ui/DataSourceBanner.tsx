import React from 'react';
import { AlertTriangle, Database, FileSpreadsheet, FlaskConical } from 'lucide-react';
import { DataSourceMode, DbStatusSummary } from '../../types/football';

interface DataSourceBannerProps {
  mode: DataSourceMode;
  dbStatus: DbStatusSummary | null;
  csvCount: number;
  csvErrorsCount: number;
  onSwitchMode: (mode: DataSourceMode) => void;
  onDownloadTemplate: () => void;
  onOpenSettings: () => void;
}

export const DataSourceBanner: React.FC<DataSourceBannerProps> = ({
  mode,
  dbStatus,
  csvCount,
  csvErrorsCount,
  onSwitchMode,
  onDownloadTemplate,
  onOpenSettings,
}) => {
  if (mode === 'database') {
    const isReady = Boolean(dbStatus?.connected && dbStatus?.schemaReady);
    if (!isReady) {
      return (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/8 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            <div className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              <span className="font-semibold text-rose-300">
                PostgreSQL (Supabase) no configurado o desconectado:
              </span>{' '}
              {dbStatus?.error ??
                'Configura DATABASE_URL en los Secrets del servidor para habilitar la persistencia real.'}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Configurar Supabase
            </button>
            <button
              type="button"
              onClick={() => onSwitchMode('sandbox')}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap"
            >
              Usar Sandbox
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <Database className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-xs sm:text-sm text-slate-200">
            <span className="font-semibold text-emerald-300">
              PostgreSQL conectado (Persistencia real):
            </span>{' '}
            <span className="font-mono">
              {dbStatus?.counts.matches ?? 0} partidos · {dbStatus?.counts.teams ?? 0} equipos ·{' '}
              {dbStatus?.counts.predictions ?? 0} pronósticos
            </span>
            {dbStatus?.lastImportAt && (
              <span className="text-slate-400 ml-2">
                · Última importación: {dbStatus.lastImportAt.slice(0, 16).replace('T', ' ')} UTC
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onDownloadTemplate}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Plantilla CSV
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode('sandbox')}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Ver Sandbox
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'sandbox') {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <FlaskConical className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs sm:text-sm text-slate-200 leading-relaxed">
            <span className="font-semibold text-amber-300">
              Modo Sandbox aislado (Datos sintéticos de prueba):
            </span>{' '}
            Estos datos son de demostración y nunca se guardan ni mezclan con PostgreSQL.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dbStatus?.connected && dbStatus?.schemaReady && (
            <button
              type="button"
              onClick={() => onSwitchMode('database')}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              Ir a PostgreSQL real
            </button>
          )}
          <button
            type="button"
            onClick={onDownloadTemplate}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Plantilla CSV
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode('none')}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Limpiar
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'csv') {
    return (
      <div className="rounded-lg border border-slate-700 bg-[#111827] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-xs sm:text-sm text-slate-200">
            <span className="font-semibold text-slate-100">Vista CSV temporal (sin persistir en BD):</span>{' '}
            <span className="font-mono">{csvCount}</span> partidos válidos cargados en memoria.
            {csvErrorsCount > 0 && (
              <span className="text-amber-300 ml-2">
                ({csvErrorsCount} filas omitidas por validación)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onDownloadTemplate}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Descargar plantilla
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode('database')}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Ver Base de Datos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start gap-3">
        <Database className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
        <div className="text-xs sm:text-sm text-slate-300">
          <span className="font-semibold text-slate-100">Sin datos activos en pantalla:</span>{' '}
          Conecta Supabase PostgreSQL, importa un archivo CSV o activa el Sandbox aislado.
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onSwitchMode('database')}
          className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          Modo PostgreSQL
        </button>
        <button
          type="button"
          onClick={() => onSwitchMode('sandbox')}
          className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap"
        >
          Cargar Sandbox
        </button>
      </div>
    </div>
  );
};

export const MissingDataNotice: React.FC<{ notes: string[] }> = ({ notes }) => {
  if (notes.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/6 px-3.5 py-2.5 text-xs text-amber-200/90 space-y-1">
      <div className="flex items-center gap-2 font-medium text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Datos incompletos detectados (reduce confianza)</span>
      </div>
      <ul className="list-disc list-inside text-slate-300 space-y-0.5">
        {notes.map((note, idx) => (
          <li key={idx}>{note}</li>
        ))}
      </ul>
    </div>
  );
};
