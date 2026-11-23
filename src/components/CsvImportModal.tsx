import React from 'react';
import { AlertTriangle, Database, X } from 'lucide-react';
import { CsvParseResult } from '../utils/csvImporter';
import { LEAGUES_CATALOG } from '../data/sandboxDataset';

interface CsvImportModalProps {
  filename: string;
  parseResult: CsvParseResult | null;
  dbReady: boolean;
  isSaving: boolean;
  saveError: string | null;
  onCancel: () => void;
  onConfirmSaveDb: () => void;
  onUseLocalPreviewOnly: () => void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  filename,
  parseResult,
  dbReady,
  isSaving,
  saveError,
  onCancel,
  onConfirmSaveDb,
  onUseLocalPreviewOnly,
}) => {
  if (!parseResult) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Revisión previa de importación CSV"
    >
      <div className="w-full max-w-3xl rounded-lg border border-slate-800 bg-[#0F1520] flex flex-col max-h-[85vh] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Revisión previa de importación CSV
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Archivo: {filename} · Filas procesadas: {parseResult.rowsProcessed}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar revisión CSV"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Filas válidas</div>
              <div className="text-lg font-semibold text-emerald-400 mt-1">
                {parseResult.dbRows.length}
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Duplicados en archivo</div>
              <div className="text-lg font-semibold text-amber-400 mt-1">
                {parseResult.duplicateRowsCount}
              </div>
            </div>
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="font-sans text-slate-400">Errores por fila</div>
              <div className="text-lg font-semibold text-rose-400 mt-1">
                {parseResult.errors.length}
              </div>
            </div>
          </div>

          {parseResult.errors.length > 0 && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/8 p-3 space-y-1.5">
              <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Incidencias detectadas (estas filas no se insertarán)</span>
              </div>
              <ul className="space-y-1 text-slate-300 max-h-28 overflow-y-auto font-mono text-[11px]">
                {parseResult.errors.map((err, idx) => (
                  <li key={idx}>
                    Fila {err.rowNumber}: {err.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parseResult.dbRows.length > 0 && (
            <div className="rounded-md border border-slate-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[#111827] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Liga</th>
                    <th className="text-left px-3 py-2 font-medium">Partido</th>
                    <th className="text-right px-3 py-2 font-medium">Cuotas 1X2</th>
                    <th className="text-right px-3 py-2 font-medium">Marcador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                  {parseResult.dbRows.slice(0, 12).map((row, idx) => {
                    const lg = LEAGUES_CATALOG.find((l) => l.id === row.leagueId);
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-slate-300">{row.date}</td>
                        <td className="px-3 py-2 font-sans text-slate-300">{lg?.name}</td>
                        <td className="px-3 py-2 font-sans text-slate-100">
                          {row.homeTeamName} vs {row.awayTeamName}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {row.oddsHome ? `${row.oddsHome}/${row.oddsDraw}/${row.oddsAway}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {row.homeGoals !== null && row.homeGoals !== undefined
                            ? `${row.homeGoals}-${row.awayGoals}`
                            : 'Pendiente'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parseResult.dbRows.length > 12 && (
                <div className="px-3 py-2 bg-[#111827] text-slate-400 text-[11px] border-t border-slate-800">
                  Mostrando 12 de {parseResult.dbRows.length} registros válidos.
                </div>
              )}
            </div>
          )}

          {!dbReady && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/8 p-3 text-amber-200">
              PostgreSQL aún no está conectado o migrado. Puedes revisar estos datos en modo CSV
              en memoria o configurar Supabase para guardarlos de forma persistente.
            </div>
          )}

          {saveError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-rose-200">
              {saveError}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2.5 bg-[#111827]">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onUseLocalPreviewOnly}
            disabled={parseResult.matches.length === 0}
            className="px-3.5 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Solo vista CSV temporal
          </button>
          <button
            type="button"
            onClick={onConfirmSaveDb}
            disabled={!dbReady || parseResult.dbRows.length === 0 || isSaving}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            {isSaving ? (
              <span>Guardando en PostgreSQL...</span>
            ) : (
              <>
                <Database className="w-3.5 h-3.5" />
                <span>Confirmar y guardar en PostgreSQL</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
