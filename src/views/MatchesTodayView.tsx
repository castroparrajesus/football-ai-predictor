import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { LeagueFilter, MatchRecord } from '../types/football';
import { LEAGUES_CATALOG } from '../data/sandboxDataset';
import { formatPct } from '../utils/previewMath';

interface MatchesTodayViewProps {
  matches: MatchRecord[];
  selectedLeague: LeagueFilter;
  onChangeLeague: (league: LeagueFilter) => void;
  onAnalyzeMatch: (match: MatchRecord) => void;
}

export const MatchesTodayView: React.FC<MatchesTodayViewProps> = ({
  matches,
  selectedLeague,
  onChangeLeague,
  onAnalyzeMatch,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const availableDates = useMemo(() => {
    const set = new Set(matches.map((m) => m.date));
    return Array.from(set).sort();
  }, [matches]);

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (selectedDate !== 'all' && m.date !== selectedDate) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !m.homeTeamName.toLowerCase().includes(q) &&
          !m.awayTeamName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [matches, selectedDate, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            PARTIDOS DE HOY
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Filtra por fecha, liga o equipo y pulsa ANALIZAR PARTIDO para ejecutar el desglose
            multi-modelo y la matriz de marcadores.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar equipo..."
              aria-label="Buscar equipo"
              className="h-9 pl-9 pr-3 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Seleccionar fecha"
            className="h-9 px-3 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Todas las fechas</option>
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <select
            value={selectedLeague}
            onChange={(e) => onChangeLeague(e.target.value as LeagueFilter)}
            aria-label="Filtrar liga"
            className="h-9 px-3 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">5 Grandes Ligas</option>
            {LEAGUES_CATALOG.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filteredMatches.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-200">
            No se encontraron partidos con los filtros seleccionados.
          </p>
          <p className="text-xs text-slate-400">
            Prueba cambiando la fecha, la liga o importando un archivo CSV con partidos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredMatches.map((match) => {
            const league = LEAGUES_CATALOG.find((l) => l.id === match.leagueId);
            return (
              <article
                key={match.id}
                className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {league?.name} · Jornada {match.matchday || '—'}
                    </span>
                    <span className="font-mono text-slate-300">
                      {match.date} · {match.kickoffTime}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-slate-100 truncate">
                        {match.homeTeamName} vs {match.awayTeamName}
                      </h3>
                      <div className="text-xs text-slate-400 mt-1 font-mono">
                        λ Esperado: {match.expectedLambdaHome.toFixed(2)} -{' '}
                        {match.expectedLambdaAway.toFixed(2)} · Completitud:{' '}
                        {match.dataCompleteness}%
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-slate-400">Calidad</div>
                      <div
                        className={`font-mono text-sm font-semibold ${
                          match.confidenceTier === 'A'
                            ? 'text-emerald-400'
                            : match.confidenceTier === 'B'
                            ? 'text-emerald-300'
                            : match.confidenceTier === 'C'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {match.confidenceTier}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono tabular-nums">
                    <div>
                      <div className="font-sans text-[11px] text-slate-400">Local (1)</div>
                      <div className="text-slate-100 mt-0.5">
                        {formatPct(match.models.ensemble.home)}
                        {match.odds1X2 ? (
                          <span className="text-slate-500 ml-1.5">@{match.odds1X2.home.toFixed(2)}</span>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <div className="font-sans text-[11px] text-slate-400">Empate (X)</div>
                      <div className="text-slate-100 mt-0.5">
                        {formatPct(match.models.ensemble.draw)}
                        {match.odds1X2 ? (
                          <span className="text-slate-500 ml-1.5">@{match.odds1X2.draw.toFixed(2)}</span>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <div className="font-sans text-[11px] text-slate-400">Visitante (2)</div>
                      <div className="text-slate-100 mt-0.5">
                        {formatPct(match.models.ensemble.away)}
                        {match.odds1X2 ? (
                          <span className="text-slate-500 ml-1.5">@{match.odds1X2.away.toFixed(2)}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
                  <span className="text-xs text-slate-400 truncate">
                    {match.missingDataNotes.length > 0
                      ? match.missingDataNotes[0]
                      : 'Cobertura estadística completa'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAnalyzeMatch(match)}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold tracking-wide transition-colors whitespace-nowrap shrink-0"
                  >
                    ANALIZAR PARTIDO
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
