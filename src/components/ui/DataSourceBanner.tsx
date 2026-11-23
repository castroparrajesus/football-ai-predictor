import React from 'react';
import { AlertTriangle, Database, FileSpreadsheet, FlaskConical } from 'lucide-react';
import { DataSourceMode } from '../../types/football';

interface DataSourceBannerProps {
  mode: DataSourceMode;
  csvCount: number;
  csvErrors: string[];
  onSwitchMode: (mode: DataSourceMode) => void;
  onDownloadTemplate: () => void;
}

export const DataSourceBanner: React.FC<DataSourceBannerProps> = ({
  mode,
  csvCount,
  csvErrors,
  onSwitchMode,
  onDownloadTemplate,
}) => {
  if (mode === 'sandbox') {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <FlaskConical className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs sm:text-sm text-slate-200 leading-relaxed">
            <span className="font-semibold text-amber-300">Modo Sandbox (Datos sintéticos de prueba):</span>{' '}
            Sin conexión API configurada en Fase 2. Los partidos, perfiles y métricas mostrados son
            datos de verificación visual y cálculo matemático, nunca resultados reales ni cuotas en vivo.
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
            onClick={() => onSwitchMode('none')}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Limpiar Sandbox
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'csv') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-xs sm:text-sm text-slate-200">
            <span className="font-semibold text-emerald-300">Fuente CSV activa:</span>{' '}
            <span className="font-mono">{csvCount}</span> partidos importados desde archivo local.
            {csvErrors.length > 0 && (
              <span className="text-amber-300 ml-2">
                ({csvErrors.length} advertencias de formato)
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
            onClick={() => onSwitchMode('sandbox')}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Ver Sandbox
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
          <span className="font-semibold text-slate-100">Sin proveedor de datos conectado:</span>{' '}
          No hay API deportiva configurada (Fase 4). Importa un archivo CSV real o activa el
          Sandbox de prueba para evaluar la interfaz y cálculos.
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
          className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap"
        >
          Cargar Sandbox de prueba
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
