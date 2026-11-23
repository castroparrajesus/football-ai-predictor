import React, { useMemo, useState } from 'react';
import { LeagueFilter, TeamStatisticalProfile } from '../types/football';
import { LEAGUES_CATALOG } from '../data/sandboxDataset';

interface LeaguesViewProps {
  teams: TeamStatisticalProfile[];
  selectedLeague: LeagueFilter;
  onChangeLeague: (league: LeagueFilter) => void;
}

export const LeaguesView: React.FC<LeaguesViewProps> = ({
  teams,
  selectedLeague,
  onChangeLeague,
}) => {
  const filteredTeams = useMemo(() => {
    if (selectedLeague === 'all') return teams;
    return teams.filter((t) => t.leagueId === selectedLeague);
  }, [teams, selectedLeague]);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const activeTeam =
    filteredTeams.find((t) => t.id === selectedTeamId) ?? filteredTeams[0] ?? null;

  const valOrMissing = (val: string | number | null | undefined, suffix = '') =>
    val === null || val === undefined ? (
      <span className="text-amber-400/90 font-sans">No disponible</span>
    ) : (
      `${val}${suffix}`
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Cobertura de las 5 Grandes Ligas y Perfiles de Equipos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Visualización simultánea o por liga individual. Los campos sin respaldo estadístico se
            marcan explícitamente como No disponible.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#111827] border border-slate-800">
          <button
            type="button"
            onClick={() => onChangeLeague('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              selectedLeague === 'all'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Todas (5)
          </button>
          {LEAGUES_CATALOG.map((lg) => (
            <button
              key={lg.id}
              type="button"
              onClick={() => onChangeLeague(lg.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                selectedLeague === lg.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lg.name}
            </button>
          ))}
        </div>
      </div>

      {/* 5 League summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {LEAGUES_CATALOG.map((lg) => {
          const count = teams.filter((t) => t.leagueId === lg.id).length;
          const isSelected = selectedLeague === lg.id;
          return (
            <button
              key={lg.id}
              type="button"
              onClick={() => onChangeLeague(lg.id)}
              className={`p-4 rounded-lg border text-left transition-colors ${
                isSelected
                  ? 'border-emerald-500/40 bg-emerald-500/8'
                  : 'border-slate-800/80 bg-[#111827] hover:bg-slate-800/40'
              }`}
            >
              <div className="text-xs text-slate-400">{lg.country}</div>
              <div className="font-display text-sm font-semibold text-slate-100 mt-1">
                {lg.name}
              </div>
              <div className="text-xs font-mono text-slate-400 mt-2">
                {count} perfiles activos
              </div>
            </button>
          );
        })}
      </div>

      {filteredTeams.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">
          Sin perfiles de equipos cargados. Activa el Sandbox de prueba o conecta la base de datos en Fase 3.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Teams Table */}
          <div className="xl:col-span-1 rounded-lg border border-slate-800/80 bg-[#111827] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 text-xs font-semibold text-slate-200">
              Equipos registrados ({filteredTeams.length})
            </div>
            <div className="divide-y divide-slate-800/70">
              {filteredTeams.map((team) => {
                const isSelected = activeTeam?.id === team.id;
                const lg = LEAGUES_CATALOG.find((l) => l.id === team.leagueId);
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${
                      isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-100">{team.name}</div>
                      <div className="text-xs text-slate-400">
                        {lg?.name} · Pos. {team.position}º · Elo {team.eloRating}
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs">
                      <div className="text-slate-200">{team.points} pts</div>
                      {team.missingFields.length > 0 && (
                        <div className="text-amber-400 text-[11px]">
                          -{team.missingFields.length} campos
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 27-metric Team Statistical Profile */}
          {activeTeam && (
            <div className="xl:col-span-2 rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-100">
                    {activeTeam.name} ({activeTeam.shortName})
                  </h3>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Tendencia reciente: <span className="text-slate-200">{activeTeam.recentTrend}</span> ·
                    Cambio de entrenador reciente:{' '}
                    <span className="text-slate-200">
                      {activeTeam.recentCoachChange ? 'Sí' : 'No'}
                    </span>
                  </div>
                </div>
                <div className="font-mono text-xs text-slate-300">
                  Elo: <span className="text-emerald-400 font-semibold">{activeTeam.eloRating}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono tabular-nums">
                {[
                  ['Posición / Puntos', `${activeTeam.position}º / ${activeTeam.points} pts`],
                  ['PJ / G / E / P', `${activeTeam.played} / ${activeTeam.won} / ${activeTeam.drawn} / ${activeTeam.lost}`],
                  ['Goles a favor / en contra', `${activeTeam.goalsFor} / ${activeTeam.goalsAgainst}`],
                  ['Promedio goles (GF / GC)', `${activeTeam.avgGoalsFor} / ${activeTeam.avgGoalsAgainst}`],
                  ['xG / xGA', activeTeam.xg !== null ? `${activeTeam.xg} / ${activeTeam.xga}` : null],
                  ['Tiros totales / a puerta', activeTeam.totalShots !== null ? `${activeTeam.totalShots} / ${activeTeam.shotsOnTarget}` : null],
                  ['Efectividad ofensiva / defensiva', activeTeam.offensiveEfficiency !== null && activeTeam.defensiveEfficiency !== null ? `${activeTeam.offensiveEfficiency}% / ${activeTeam.defensiveEfficiency}%` : null],
                  ['Porterías a cero', `${activeTeam.cleanSheets}`],
                  ['BTTS % / Over 1.5 %', `${Math.round(activeTeam.bttsRate * 100)}% / ${Math.round(activeTeam.over15Rate * 100)}%`],
                  ['Over 2.5 / 3.5 / 4.5 %', `${Math.round(activeTeam.over25Rate * 100)}% / ${Math.round(activeTeam.over35Rate * 100)}% / ${Math.round(activeTeam.over45Rate * 100)}%`],
                  ['Córners favor / contra prom.', activeTeam.cornersForAvg !== null ? `${activeTeam.cornersForAvg} / ${activeTeam.cornersAgainstAvg}` : null],
                  ['Tarjetas amarillas / rojas', activeTeam.yellowCardsAvg !== null ? `${activeTeam.yellowCardsAvg} prom. / ${activeTeam.redCardsTotal} rojas` : null],
                  ['Rendimiento Local', `${activeTeam.homePerformance.wins}G-${activeTeam.homePerformance.draws}E-${activeTeam.homePerformance.losses}P (${activeTeam.homePerformance.goalsFor}:${activeTeam.homePerformance.goalsAgainst})`],
                  ['Rendimiento Visitante', `${activeTeam.awayPerformance.wins}G-${activeTeam.awayPerformance.draws}E-${activeTeam.awayPerformance.losses}P (${activeTeam.awayPerformance.goalsFor}:${activeTeam.awayPerformance.goalsAgainst})`],
                  ['Últimos 5 / 10 / 15 pts', `${activeTeam.last5.points} / ${activeTeam.last10?.points ?? 'N/D'} / ${activeTeam.last15?.points ?? 'N/D'}`],
                  ['PPG vs rivales nivel similar', activeTeam.vsSimilarLevelPPG],
                  ['Días de descanso / Congestión', activeTeam.restDays !== null ? `${activeTeam.restDays} días (${activeTeam.scheduleCongestion})` : null],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="flex items-center justify-between py-1.5 border-b border-slate-800/60"
                  >
                    <span className="font-sans text-slate-400">{label}</span>
                    <span className="text-slate-100">{valOrMissing(value)}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] text-xs space-y-1.5">
                  <div className="font-semibold text-slate-200">Lesiones y sanciones</div>
                  {activeTeam.absences && activeTeam.absences.length > 0 ? (
                    <ul className="space-y-1 text-slate-300">
                      {activeTeam.absences.map((ab) => (
                        <li key={ab.player}>
                          {ab.player} — <span className="text-slate-400">{ab.reason}</span> (impacto {ab.impact})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">Sin bajas registradas o dato pendiente.</p>
                  )}
                </div>

                <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] text-xs space-y-1.5">
                  <div className="font-semibold text-slate-200">Posible alineación titular</div>
                  {activeTeam.probableLineup ? (
                    <p className="text-slate-300 leading-relaxed">
                      {activeTeam.probableLineup.join(' · ')}
                    </p>
                  ) : (
                    <p className="text-amber-400/90">
                      Alineación probable no disponible (penaliza la confianza del partido).
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
