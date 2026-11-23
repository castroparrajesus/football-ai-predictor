import React from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Trophy,
  BrainCircuit,
  Target,
  TrendingUp,
  GitCompare,
  History,
  BarChart3,
  Activity,
  Settings,
  X,
} from 'lucide-react';
import { NavSectionId } from '../../types/football';

export interface NavItem {
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'matches_today', label: 'Partidos de hoy', icon: CalendarDays },
  { id: 'all_leagues', label: 'Todas las ligas', icon: Trophy },
  { id: 'ai_analysis', label: 'Análisis IA', icon: BrainCircuit },
  { id: 'predictions', label: 'Pronósticos', icon: Target },
  { id: 'value_finder', label: 'Value Finder', icon: TrendingUp },
  { id: 'model_comparator', label: 'Comparador de modelos', icon: GitCompare },
  { id: 'history', label: 'Historial', icon: History },
  { id: 'performance', label: 'Rendimiento', icon: BarChart3 },
  { id: 'monitoring', label: 'Monitorización y Cuotas', icon: Activity },
  { id: 'settings', label: 'Configuración', icon: Settings },
];

interface SidebarProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  mobileOpen,
  onCloseMobile,
}) => {
  const handleSelect = (id: NavSectionId) => {
    onSelectSection(id);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex h-full flex-col bg-[#0F1520] border-r border-slate-800/80">
      <div className="flex items-center justify-between px-5 h-16 border-b border-slate-800/80 shrink-0">
        <span className="font-display text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap">
          Football AI Predictor
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Cerrar menú lateral"
          className="lg:hidden p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 focus-visible:outline-2 focus-visible:outline-emerald-500"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                isActive
                  ? 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/25'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3.5 border-t border-slate-800/80 text-xs text-slate-500">
        <div className="flex items-center justify-between">
          <span>5 Grandes Ligas</span>
          <span className="font-mono text-slate-400">Fase 1–6</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-64 max-w-[82vw] h-full z-10">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};
