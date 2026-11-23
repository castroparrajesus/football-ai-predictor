import React, { useMemo, useState } from 'react';
import { X, AlertTriangle, BookmarkPlus, CheckCircle2 } from 'lucide-react';
import {
  ConfidenceTier,
  EnsembleWeights,
  MatchRecord,
  PredictionHistoryItem,
  TeamStatisticalProfile,
} from '../types/football';
import { LEAGUES_CATALOG } from '../data/sandboxDataset';
import {
  calculateValueMetrics,
  combineEnsembleProbabilities,
  computeDixonColesScoreMatrix,
  computePoissonScoreMatrix,
  estimateAuxMarkets,
  formatPct,
} from '../utils/previewMath';
import { ScoreMatrixHeatmap } from './charts/SimpleCharts';
import { MissingDataNotice } from './ui/DataSourceBanner';

export interface PredictionSnapshotPayload {
  matchId: string;
  confidenceTier: ConfidenceTier;
  dataCompletenessScore: number;
  expectedScore: string;
  modelOutputs: unknown;
  markets: unknown;
  scoreMatrix: unknown;
  selectedMarket: string;
  selectedSelection: string;
  predictedProb: number;
  oddsAtPrediction: number;
}

interface MatchAnalyzerDrawerProps {
  match: MatchRecord | null;
  homeTeam?: TeamStatisticalProfile;
  awayTeam?: TeamStatisticalProfile;
  weights: EnsembleWeights;
  onClose: () => void;
  onSavePrediction: (item: PredictionHistoryItem, payload: PredictionSnapshotPayload) => void | Promise<void>;
}

export const CONFIDENCE_LABELS: Record<ConfidenceTier, { label: string; colorClass: string }> = {
  A: { label: 'Nivel A · Consenso sólido', colorClass: 'text-emerald-400' },
  B: { label: 'Nivel B · Señal moderada', colorClass: 'text-emerald-300' },
  C: { label: 'Nivel C · Incertidumbre alta', colorClass: 'text-amber-400' },
  DESCARTADO: { label: 'DESCARTADO · Sin calidad suficiente', colorClass: 'text-rose-400' },
};

export const MatchAnalyzerDrawer: React.FC<MatchAnalyzerDrawerProps> = ({
  match,
  homeTeam,
  awayTeam,
  weights,
  onClose,
  onSavePrediction,
}) => {
  const [activeTab, setActiveTab] = useState<'markets' | 'matrix' | 'teams'>('markets');
  const [showFullMatrix, setShowFullMatrix] = useState(false);
  const [matrixModel, setMatrixModel] = useState<'dixon_coles' | 'poisson'>('dixon_coles');
  const [savedNotice, setSavedNotice] = useState(false);

  const analysis = useMemo(() => {
    if (!match) return null;
    const useDc = matrixModel === 'dixon_coles' && match.dixonColesRho !== undefined;
    const scoreCalc = useDc
      ? computeDixonColesScoreMatrix(
          match.expectedLambdaHome,
          match.expectedLambdaAway,
          match.dixonColesRho,
          6
        )
      : computePoissonScoreMatrix(match.expectedLambdaHome, match.expectedLambdaAway, 6);
    const aux = estimateAuxMarkets(homeTeam, awayTeam);
    const dynamicEnsemble = combineEnsembleProbabilities(
      {
        poisson: match.models.poisson,
        dixonColes: match.models.dixonColes,
        elo: match.models.elo,
        machineLearning: match.models.machineLearning,
        recentForm: match.models.recentForm,
        homeAway: match.models.homeAway,
      },
      weights
    );

    const topScores = [...scoreCalc.matrix]
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 6);

    return {
      matrix: scoreCalc.matrix,
      topScores,
      markets: {
        ...scoreCalc.markets,
        corners: aux.corners,
        cards: aux.cards,
      },
      dynamicEnsemble,
      usingDixonColes: useDc,
    };
  }, [match, homeTeam, awayTeam, weights, matrixModel]);

  if (!match || !analysis) return null;

  const league = LEAGUES_CATALOG.find((l) => l.id === match.leagueId);
  const confMeta = CONFIDENCE_LABELS[match.confidenceTier];
  const topScore = analysis.topScores[0];

  const handleLogPreMatch = async () => {
    const isHomeTop = analysis.dynamicEnsemble.home >= analysis.dynamicEnsemble.away;
    const selection = isHomeTop
      ? `Local (${match.homeTeamName})`
      : `Visitante (${match.awayTeamName})`;
    const predictedProb = Math.max(analysis.dynamicEnsemble.home, analysis.dynamicEnsemble.away);
    const oddsUsed = isHomeTop
      ? (match.odds1X2?.home ?? 2.0)
      : (match.odds1X2?.away ?? 2.0);
    const expectedScore = topScore ? `${topScore.homeGoals}-${topScore.awayGoals}` : '1-1';

    const item: PredictionHistoryItem = {
      id: `pred_${Date.now()}`,
      recordedAtUtc: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      kickoffUtc: `${match.date} ${match.kickoffTime} UTC`,
      leagueId: match.leagueId,
      matchLabel: `${match.homeTeamName} vs ${match.awayTeamName}`,
      market: 'Resultado 1X2',
      selection,
      predictedProb,
      oddsAtPrediction: oddsUsed,
      expectedScore,
      modelVersion: match.isSynthetic ? 'ensemble-preview-p2' : 'ensemble-v1-phase3',
      confidenceTier: match.confidenceTier,
      status: 'pendiente',
      actualResult: null,
      brierScore: null,
      logLoss: null,
      simulatedRoiUnit: null,
      isSynthetic: match.isSynthetic,
    };

    const payload: PredictionSnapshotPayload = {
      matchId: match.id,
      confidenceTier: match.confidenceTier,
      dataCompletenessScore: match.dataCompleteness,
      expectedScore,
      modelOutputs: {
        ...match.models,
        dynamicEnsemble: analysis.dynamicEnsemble,
      },
      markets: analysis.markets,
      scoreMatrix: analysis.topScores,
      selectedMarket: 'Resultado 1X2',
      selectedSelection: selection,
      predictedProb,
      oddsAtPrediction: oddsUsed,
    };

    await onSavePrediction(item, payload);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`Análisis predictivo: ${match.homeTeamName} vs ${match.awayTeamName}`}
    >
      <div className="w-full max-w-4xl bg-[#0D131E] border-l border-slate-800 h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <span>{league?.name ?? match.leagueId}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{match.date} {match.kickoffTime}</span>
              <span aria-hidden="true">·</span>
              <span className={confMeta.colorClass}>{confMeta.label}</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-slate-100">
              {match.homeTeamName} vs {match.awayTeamName}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleLogPreMatch}
              disabled={match.confidenceTier === 'DESCARTADO'}
              className="px-3.5 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {savedNotice ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Registrado en historial</span>
                </>
              ) : (
                <>
                  <BookmarkPlus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Registrar snapshot</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar análisis"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-nav tabs */}
        <div className="px-6 py-3 border-b border-slate-800/80 flex items-center justify-between gap-4 bg-[#101724] shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0F17] border border-slate-800">
            {[
              { id: 'markets', label: 'Modelos y Mercados' },
              { id: 'matrix', label: 'Marcador Exacto (Poisson)' },
              { id: 'teams', label: 'Comparativa de Equipos' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as 'markets' | 'matrix' | 'teams')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === t.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-400 font-mono hidden sm:block">
            Completitud: <span className="text-slate-200">{match.dataCompleteness}%</span> · Discrepancia:{' '}
            <span className={match.models.modelSpread > 10 ? 'text-amber-400' : 'text-emerald-400'}>
              {match.models.modelSpread} pp
            </span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <MissingDataNotice notes={match.missingDataNotes} />

          {match.smallSampleWarning && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{match.smallSampleWarning}</span>
            </div>
          )}

          {match.confidenceTier === 'DESCARTADO' && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-300">Partido clasificado como DESCARTADO</p>
                <p className="text-xs text-rose-200/80 mt-1">
                  {match.confidenceReasons.join(' ')} Los cálculos mostrados son exclusivamente
                  informativos y no constituyen una recomendación operativa.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'markets' && (
            <div className="space-y-6">
              {/* Multi-model comparison table */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Desglose por modelo (1X2)
                  </h3>
                  <span className="text-xs text-slate-400">
                    xG esperado: <span className="font-mono text-slate-200">{match.expectedLambdaHome.toFixed(2)}</span> -{' '}
                    <span className="font-mono text-slate-200">{match.expectedLambdaAway.toFixed(2)}</span>
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-[#111827] text-xs text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">Modelo</th>
                        <th className="text-right px-4 py-2.5 font-medium">Local (1)</th>
                        <th className="text-right px-4 py-2.5 font-medium">Empate (X)</th>
                        <th className="text-right px-4 py-2.5 font-medium">Visitante (2)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums text-xs">
                      {[
                        { name: 'Poisson Independiente (λ)', data: match.models.poisson },
                        ...(match.models.dixonColes
                          ? [{ name: `Dixon-Coles (ρ=${match.dixonColesRho ?? -0.09})`, data: match.models.dixonColes }]
                          : []),
                        { name: 'Elo dinámico', data: match.models.elo },
                        { name: 'ML Regresión Logística L2', data: match.models.machineLearning },
                        { name: 'Estadísticas Of./Def. & Forma', data: match.models.recentForm },
                        ...(match.models.marketDeVigged
                          ? [{ name: 'Mercado sin margen (De-vigged)', data: match.models.marketDeVigged }]
                          : []),
                      ].map((row) => (
                        <tr key={row.name} className="hover:bg-slate-800/30">
                          <td className="px-4 py-2.5 font-sans text-slate-300">{row.name}</td>
                          <td className="px-4 py-2.5 text-right text-slate-200">{formatPct(row.data.home)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-200">{formatPct(row.data.draw)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-200">{formatPct(row.data.away)}</td>
                        </tr>
                      ))}
                      <tr className="bg-emerald-500/8 font-semibold">
                        <td className="px-4 py-3 font-sans text-emerald-300">Ensemble Calibrado Ponderado</td>
                        <td className="px-4 py-3 text-right text-emerald-300">{formatPct(analysis.dynamicEnsemble.home)}</td>
                        <td className="px-4 py-3 text-right text-emerald-300">{formatPct(analysis.dynamicEnsemble.draw)}</td>
                        <td className="px-4 py-3 text-right text-emerald-300">{formatPct(analysis.dynamicEnsemble.away)}</td>
                      </tr>
                      {match.confidenceInterval90 && (
                        <tr className="bg-[#0B0F17] text-[11px] text-slate-400">
                          <td className="px-4 py-2 font-sans">Intervalo de confianza 90% (Wilson)</td>
                          <td className="px-4 py-2 text-right">
                            {formatPct(match.confidenceInterval90.home[0], 0)}–{formatPct(match.confidenceInterval90.home[1], 0)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {formatPct(match.confidenceInterval90.draw[0], 0)}–{formatPct(match.confidenceInterval90.draw[1], 0)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {formatPct(match.confidenceInterval90.away[0], 0)}–{formatPct(match.confidenceInterval90.away[1], 0)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {match.keyFactors && match.keyFactors.length > 0 && (
                  <div className="mt-4 rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-2.5">
                    <h4 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Factores que explican el pronóstico
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {match.keyFactors.map((kf) => (
                        <div
                          key={kf.label}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-[#0B0F17] border border-slate-800/80"
                        >
                          <span className="text-slate-400">{kf.label}</span>
                          <span
                            className={`font-mono tabular-nums ${
                              kf.impact === 'home'
                                ? 'text-emerald-400'
                                : kf.impact === 'away'
                                ? 'text-sky-400'
                                : 'text-slate-200'
                            }`}
                          >
                            {kf.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Value check vs 1X2 odds */}
              {match.odds1X2 && (
                <section>
                  <h3 className="font-display text-sm font-semibold text-slate-100 mb-3">
                    Evaluación de Valor Matemático (EV) · {match.odds1X2.bookmaker}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        label: `Local (${match.homeTeamName})`,
                        prob: analysis.dynamicEnsemble.home,
                        odds: match.odds1X2.home,
                        deVig: match.models.marketDeVigged?.home ?? null,
                      },
                      {
                        label: 'Empate (X)',
                        prob: analysis.dynamicEnsemble.draw,
                        odds: match.odds1X2.draw,
                        deVig: match.models.marketDeVigged?.draw ?? null,
                      },
                      {
                        label: `Visitante (${match.awayTeamName})`,
                        prob: analysis.dynamicEnsemble.away,
                        odds: match.odds1X2.away,
                        deVig: match.models.marketDeVigged?.away ?? null,
                      },
                    ].map((item) => {
                      const val = calculateValueMetrics(item.prob, item.odds, item.deVig);
                      const positive = val.expectedValue > 0 && match.confidenceTier !== 'DESCARTADO';
                      return (
                        <div
                          key={item.label}
                          className="p-3.5 rounded-lg border border-slate-800 bg-[#111827] space-y-2"
                        >
                          <div className="text-xs font-medium text-slate-300 truncate">{item.label}</div>
                          <div className="flex items-baseline justify-between font-mono text-xs">
                            <span className="text-slate-400">Cuota: {item.odds.toFixed(2)}</span>
                            <span className="text-slate-200">Justa: {val.fairOdds.toFixed(2)}</span>
                          </div>
                          <div className="flex items-baseline justify-between font-mono text-xs">
                            <span className="text-slate-400">Modelo: {formatPct(item.prob)}</span>
                            <span className={positive ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>
                              EV: {(val.expectedValue * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Independent Markets Grid */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <h4 className="font-display text-sm font-semibold text-slate-100">
                    Doble Oportunidad y Ambos Marcan
                  </h4>
                  <div className="space-y-1.5 text-xs font-mono tabular-nums">
                    {[
                      ['Doble Oportunidad 1X', analysis.markets.result.dc1X],
                      ['Doble Oportunidad X2', analysis.markets.result.dcX2],
                      ['Doble Oportunidad 12', analysis.markets.result.dc12],
                      ['Ambos Marcan: Sí (BTTS)', analysis.markets.goals.bttsYes],
                      ['Ambos Marcan: No', analysis.markets.goals.bttsNo],
                    ].map(([label, prob]) => (
                      <div key={String(label)} className="flex justify-between py-1 border-b border-slate-800/60 last:border-0">
                        <span className="font-sans text-slate-300">{label}</span>
                        <span className="text-slate-100">{formatPct(Number(prob))}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <h4 className="font-display text-sm font-semibold text-slate-100">
                    Goles Totales (Over / Under)
                  </h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono tabular-nums">
                    {[
                      ['Más de 0.5', analysis.markets.goals.over05],
                      ['Menos de 1.5', analysis.markets.goals.under15],
                      ['Más de 1.5', analysis.markets.goals.over15],
                      ['Menos de 2.5', analysis.markets.goals.under25],
                      ['Más de 2.5', analysis.markets.goals.over25],
                      ['Menos de 3.5', analysis.markets.goals.under35],
                      ['Más de 3.5', analysis.markets.goals.over35],
                      ['Menos de 4.5', analysis.markets.goals.under45],
                      ['Más de 4.5', analysis.markets.goals.over45],
                    ].map(([label, prob]) => (
                      <div key={String(label)} className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="font-sans text-slate-300">{label}</span>
                        <span className="text-slate-100">{formatPct(Number(prob))}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <h4 className="font-display text-sm font-semibold text-slate-100">
                    Goles por Equipo
                  </h4>
                  <div className="space-y-1.5 text-xs font-mono tabular-nums">
                    {[
                      [`${match.homeTeamName} +0.5`, analysis.markets.teamGoals.homeOver05],
                      [`${match.homeTeamName} +1.5`, analysis.markets.teamGoals.homeOver15],
                      [`${match.homeTeamName} +2.5`, analysis.markets.teamGoals.homeOver25],
                      [`${match.awayTeamName} +0.5`, analysis.markets.teamGoals.awayOver05],
                      [`${match.awayTeamName} +1.5`, analysis.markets.teamGoals.awayOver15],
                      [`${match.awayTeamName} +2.5`, analysis.markets.teamGoals.awayOver25],
                    ].map(([label, prob]) => (
                      <div key={String(label)} className="flex justify-between py-1 border-b border-slate-800/60 last:border-0">
                        <span className="font-sans text-slate-300 truncate pr-2">{label}</span>
                        <span className="text-slate-100 shrink-0">{formatPct(Number(prob))}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <h4 className="font-display text-sm font-semibold text-slate-100">
                    Córners y Tarjetas (Cobertura Verificada)
                  </h4>
                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="text-slate-400 mb-1">Mercado de Córners</div>
                      {analysis.markets.corners.available ? (
                        <div className="font-mono text-slate-200 space-y-1">
                          <div className="flex justify-between">
                            <span className="font-sans text-slate-300">Total esperado</span>
                            <span>{analysis.markets.corners.expectedTotal}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-sans text-slate-300">Local / Visitante</span>
                            <span>
                              {analysis.markets.corners.expectedHome} / {analysis.markets.corners.expectedAway}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-sans text-slate-300">Over / Under 9.5</span>
                            <span>
                              {formatPct(analysis.markets.corners.over95Prob!)} /{' '}
                              {formatPct(analysis.markets.corners.under95Prob!)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-amber-300/90">{analysis.markets.corners.note}</p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-800">
                      <div className="text-slate-400 mb-1">Mercado de Tarjetas</div>
                      {analysis.markets.cards.available ? (
                        <div className="font-mono text-slate-200 space-y-1">
                          <div className="flex justify-between">
                            <span className="font-sans text-slate-300">Amarillas esperadas</span>
                            <span>{analysis.markets.cards.expectedTotal}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-sans text-slate-300">Riesgo disciplinario</span>
                            <span className="uppercase">{analysis.markets.cards.disciplinaryRisk}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-amber-300/90">{analysis.markets.cards.note}</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'matrix' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-400">
                    Goles esperados ({analysis.usingDixonColes ? `Dixon-Coles ρ=${match.dixonColesRho}` : 'Poisson independiente'})
                  </div>
                  <div className="font-mono text-base font-semibold text-slate-100 mt-0.5 tabular-nums">
                    {match.homeTeamName}: {match.expectedLambdaHome.toFixed(2)} · {match.awayTeamName}:{' '}
                    {match.expectedLambdaAway.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {match.dixonColesRho !== undefined && (
                    <button
                      type="button"
                      onClick={() =>
                        setMatrixModel((m) => (m === 'dixon_coles' ? 'poisson' : 'dixon_coles'))
                      }
                      className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                    >
                      {analysis.usingDixonColes ? 'Cambiar a Poisson' : 'Usar Dixon-Coles'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowFullMatrix((prev) => !prev)}
                    className="px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    {showFullMatrix ? 'Vista estándar (0–5)' : 'Ampliar distribución (0–6)'}
                  </button>
                </div>
              </div>

              <div>
                <h3 className="font-display text-sm font-semibold text-slate-100 mb-2">
                  Marcadores individuales más probables (ningún resultado es seguro)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {analysis.topScores.map((cell) => (
                    <div
                      key={`${cell.homeGoals}-${cell.awayGoals}`}
                      className="p-3 rounded-lg border border-slate-800 bg-[#111827] flex items-center justify-between"
                    >
                      <span className="font-mono text-base font-semibold text-slate-100">
                        {cell.homeGoals} - {cell.awayGoals}
                      </span>
                      <span className="font-mono text-xs text-emerald-400">
                        {(cell.probability * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
                <ScoreMatrixHeatmap
                  matrix={analysis.matrix}
                  homeName={match.homeTeamName}
                  awayName={match.awayTeamName}
                  maxDisplay={showFullMatrix ? 6 : 5}
                />
              </div>
            </div>
          )}

          {activeTab === 'teams' && (
            <div className="space-y-5">
              {!homeTeam || !awayTeam ? (
                <div className="rounded-lg border border-slate-800 bg-[#111827] p-6 text-sm text-slate-400">
                  Perfiles estadísticos completos no disponibles para registros importados vía CSV
                  básico. En Fase 3–4 se sincronizarán desde la base de datos y proveedores de API.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-xs">
                      <thead className="bg-[#111827] text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-medium">Métrica</th>
                          <th className="text-right px-4 py-2.5 font-medium">{homeTeam.name} (Local)</th>
                          <th className="text-right px-4 py-2.5 font-medium">{awayTeam.name} (Visitante)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                        {[
                          ['Posición / Puntos', `${homeTeam.position}º (${homeTeam.points} pts)`, `${awayTeam.position}º (${awayTeam.points} pts)`],
                          ['Rating Elo', String(homeTeam.eloRating), String(awayTeam.eloRating)],
                          ['Goles a favor / en contra', `${homeTeam.goalsFor} / ${homeTeam.goalsAgainst}`, `${awayTeam.goalsFor} / ${awayTeam.goalsAgainst}`],
                          ['xG / xGA acumulados', homeTeam.xg !== null ? `${homeTeam.xg} / ${homeTeam.xga}` : 'No disponible', awayTeam.xg !== null ? `${awayTeam.xg} / ${awayTeam.xga}` : 'No disponible'],
                          ['Tiros / A puerta', `${homeTeam.totalShots ?? 'N/D'} / ${homeTeam.shotsOnTarget ?? 'N/D'}`, `${awayTeam.totalShots ?? 'N/D'} / ${awayTeam.shotsOnTarget ?? 'N/D'}`],
                          ['Porterías a cero', String(homeTeam.cleanSheets), String(awayTeam.cleanSheets)],
                          ['BTTS % / Over 2.5 %', `${Math.round(homeTeam.bttsRate * 100)}% / ${Math.round(homeTeam.over25Rate * 100)}%`, `${Math.round(awayTeam.bttsRate * 100)}% / ${Math.round(awayTeam.over25Rate * 100)}%`],
                          ['Últimos 5 (Pts / GF:GC)', `${homeTeam.last5.points} pts (${homeTeam.last5.goalsFor}:${homeTeam.last5.goalsAgainst})`, `${awayTeam.last5.points} pts (${awayTeam.last5.goalsFor}:${awayTeam.last5.goalsAgainst})`],
                          ['Días de descanso', homeTeam.restDays !== null ? `${homeTeam.restDays} días` : 'N/D', awayTeam.restDays !== null ? `${awayTeam.restDays} días` : 'N/D'],
                          ['Rendimiento específico (Casa vs Fuera)', `${homeTeam.homePerformance.wins}G-${homeTeam.homePerformance.draws}E-${homeTeam.homePerformance.losses}P`, `${awayTeam.awayPerformance.wins}G-${awayTeam.awayPerformance.draws}E-${awayTeam.awayPerformance.losses}P`],
                        ].map(([metric, hv, av]) => (
                          <tr key={String(metric)}>
                            <td className="px-4 py-2.5 font-sans text-slate-300">{metric}</td>
                            <td className="px-4 py-2.5 text-right text-slate-100">{hv}</td>
                            <td className="px-4 py-2.5 text-right text-slate-100">{av}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {match.h2hSummary && (
                    <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Enfrentamientos directos (últimos {match.h2hSummary.matches}):{' '}
                        <strong className="text-slate-100">{match.h2hSummary.homeWins}</strong> victorias locales,{' '}
                        <strong className="text-slate-100">{match.h2hSummary.draws}</strong> empates,{' '}
                        <strong className="text-slate-100">{match.h2hSummary.awayWins}</strong> victorias visitantes.
                      </span>
                      <span className="font-mono text-slate-400">
                        Promedio H2H: {match.h2hSummary.avgGoals} goles
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
