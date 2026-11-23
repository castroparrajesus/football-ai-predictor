import React, { useRef } from 'react';
import { Menu, Upload } from 'lucide-react';
import { LEAGUES_CATALOG } from '../../data/sandboxDataset';
import { DataSourceMode, DbStatusSummary, LeagueFilter, NavSectionId } from '../../types/football';
import { NAV_ITEMS } from './Sidebar';

interface TopBarProps {
  activeSection: NavSectionId;
  selectedLeague: LeagueFilter;
  onChangeLeague: (league: LeagueFilter) => void;
  dataSourceMode: DataSourceMode;
  onChangeDataSource: (mode: DataSourceMode) => void;
  dbStatus: DbStatusSummary | null;
  onImportCsvFile: (file: File) => void;
  onOpenMobileMenu: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  selectedLeague,
  onChangeLeague,
  dataSourceMode,
  onChangeDataSource,
  dbStatus,
  onImportCsvFile,
  onOpenMobileMenu,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentNav = NAV_ITEMS.find((n) => n.id === activeSection);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportCsvFile(file);
      e.target.value = '';
    }
  };

  const dbLabel = !dbStatus
    ? 'BD: Verificando...'
    : dbStatus.connected && dbStatus.schemaReady
    ? 'BD: PostgreSQL conectado'
    : dbStatus.configured && dbStatus.connected
    ? 'BD: Migración pendiente'
    : 'BD: Sin configurar';

  const dbColorClass =
    dbStatus?.connected && dbStatus?.schemaReady
      ? 'text-emerald-400'
      : dbStatus?.configured && !dbStatus?.connected
      ? 'text-rose-400'
      : 'text-amber-400';

  return (
    <header className="sticky top-0 z-30 h-16 bg-[#0B0F17]/95 backdrop-blur border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Abrir menú de navegación"
          className="lg:hidden p-2 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800/60 shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-500"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="hidden sm:inline text-slate-500 whitespace-nowrap">
            Football AI Predictor
          </span>
          <span className="hidden sm:inline text-slate-700" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-100 truncate">
            {currentNav?.label ?? 'Dashboard'}
          </h1>
          <span className="hidden xl:inline text-slate-700" aria-hidden="true">
            ·
          </span>
          <span className={`hidden xl:inline text-xs font-mono whitespace-nowrap ${dbColorClass}`}>
            {dbLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <label className="sr-only" htmlFor="global-league-select">
          Filtrar por liga
        </label>
        <select
          id="global-league-select"
          value={selectedLeague}
          onChange={(e) => onChangeLeague(e.target.value as LeagueFilter)}
          className="h-9 px-3 rounded-lg bg-[#111827] border border-slate-800 text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 whitespace-nowrap"
        >
          <option value="all">Todas las ligas (5)</option>
          {LEAGUES_CATALOG.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name} — {league.country}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="data-source-select">
          Fuente de datos
        </label>
        <select
          id="data-source-select"
          value={dataSourceMode}
          onChange={(e) => onChangeDataSource(e.target.value as DataSourceMode)}
          className="hidden md:block h-9 px-3 rounded-lg bg-[#111827] border border-slate-800 text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 whitespace-nowrap"
        >
          <option value="database">Base de datos (PostgreSQL)</option>
          <option value="sandbox">Sandbox (Datos de prueba)</option>
          <option value="csv">CSV temporal</option>
          <option value="none">Sin datos (Vacío)</option>
        </select>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-400"
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span>Importar CSV</span>
        </button>
      </div>
    </header>
  );
};
