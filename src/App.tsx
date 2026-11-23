/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import {
  DEFAULT_ENSEMBLE_WEIGHTS,
  DEFAULT_QUALITY_THRESHOLDS,
  SANDBOX_CALIBRATION_BINS,
  SANDBOX_HISTORY,
  SANDBOX_MATCHES,
  SANDBOX_TEAMS,
} from './data/sandboxDataset';
import {
  DataSourceMode,
  EnsembleWeights,
  LeagueFilter,
  MatchRecord,
  NavSectionId,
  PredictionHistoryItem,
  QualityFilterThresholds,
  ValueOpportunity,
} from './types/football';
import {
  calculateValueMetrics,
  combineEnsembleProbabilities,
  computeBrierScoreBinary,
  computeLogLossBinary,
  computePoissonScoreMatrix,
} from './utils/previewMath';
import { CSV_TEMPLATE_CONTENT, parseMatchesCsv } from './utils/csvImporter';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DataSourceBanner } from './components/ui/DataSourceBanner';
import { MatchAnalyzerDrawer } from './components/MatchAnalyzerDrawer';
import { DashboardView } from './views/DashboardView';
import { MatchesTodayView } from './views/MatchesTodayView';
import { LeaguesView } from './views/LeaguesView';
import { AiAnalysisView } from './views/AiAnalysisView';
import { PredictionsView } from './views/PredictionsView';
import { ValueFinderView } from './views/ValueFinderView';
import { ModelComparatorView } from './views/ModelComparatorView';
import { HistoryView } from './views/HistoryView';
import { PerformanceView } from './views/PerformanceView';
import { SettingsView } from './views/SettingsView';

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [selectedLeague, setSelectedLeague] = useState<LeagueFilter>('all');
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('sandbox');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [csvMatches, setCsvMatches] = useState<MatchRecord[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);

  const [weights, setWeights] = useState<EnsembleWeights>(DEFAULT_ENSEMBLE_WEIGHTS);
  const [thresholds, setThresholds] = useState<QualityFilterThresholds>(
    DEFAULT_QUALITY_THRESHOLDS
  );

  const [analyzedMatch, setAnalyzedMatch] = useState<MatchRecord | null>(null);
  const [sandboxHistory, setSandboxHistory] = useState<PredictionHistoryItem[]>(SANDBOX_HISTORY);
  const [customHistory, setCustomHistory] = useState<PredictionHistoryItem[]>([]);

  const activeMatches = useMemo(() => {
    const raw =
      dataSourceMode === 'sandbox'
        ? SANDBOX_MATCHES
        : dataSourceMode === 'csv'
        ? csvMatches
        : [];
    if (selectedLeague === 'all') return raw;
    return raw.filter((m) => m.leagueId === selectedLeague);
  }, [dataSourceMode, csvMatches, selectedLeague]);

  const activeTeams = useMemo(() => {
    if (dataSourceMode !== 'sandbox') return [];
    if (selectedLeague === 'all') return SANDBOX_TEAMS;
    return SANDBOX_TEAMS.filter((t) => t.leagueId === selectedLeague);
  }, [dataSourceMode, selectedLeague]);

  const activeHistory = useMemo(() => {
    const base = dataSourceMode === 'sandbox' ? sandboxHistory : customHistory;
    if (selectedLeague === 'all') return base;
    return base.filter((h) => h.leagueId === selectedLeague);
  }, [dataSourceMode, sandboxHistory, customHistory, selectedLeague]);

  const activeCalibrationBins = useMemo(() => {
    return dataSourceMode === 'sandbox' ? SANDBOX_CALIBRATION_BINS : [];
  }, [dataSourceMode]);

  const valueOpportunities = useMemo<ValueOpportunity[]>(() => {
    const list: ValueOpportunity[] = [];
    for (const match of activeMatches) {
      if (!match.odds1X2) continue;

      const ensemble = combineEnsembleProbabilities(
        {
          poisson: match.models.poisson,
          elo: match.models.elo,
          machineLearning: match.models.machineLearning,
          recentForm: match.models.recentForm,
          homeAway: match.models.homeAway,
        },
        weights
      );

      const candidates = [
        {
          suffix: 'home',
          market: 'Resultado 1X2',
          selection: `${match.homeTeamName} (1)`,
          prob: ensemble.home,
          odds: match.odds1X2.home,
          deVig: match.models.marketDeVigged?.home ?? null,
        },
        {
          suffix: 'draw',
          market: 'Resultado 1X2',
          selection: 'Empate (X)',
          prob: ensemble.draw,
          odds: match.odds1X2.draw,
          deVig: match.models.marketDeVigged?.draw ?? null,
        },
        {
          suffix: 'away',
          market: 'Resultado 1X2',
          selection: `${match.awayTeamName} (2)`,
          prob: ensemble.away,
          odds: match.odds1X2.away,
          deVig: match.models.marketDeVigged?.away ?? null,
        },
      ];

      if (match.extraOdds?.over25) {
        const poisson = computePoissonScoreMatrix(
          match.expectedLambdaHome,
          match.expectedLambdaAway
        );
        candidates.push({
          suffix: 'o25',
          market: 'Goles',
          selection: 'Más de 2.5 goles',
          prob: poisson.markets.goals.over25,
          odds: match.extraOdds.over25,
          deVig: null,
        });
      }

      for (const c of candidates) {
        const metrics = calculateValueMetrics(c.prob, c.odds, c.deVig);
        const evPct = metrics.expectedValue * 100;
        const meetsCompleteness = match.dataCompleteness >= thresholds.minCompletenessPct;
        const meetsSpread = match.models.modelSpread <= thresholds.maxModelSpreadPct;
        const meetsTier = match.confidenceTier === 'A' || match.confidenceTier === 'B';
        const meetsEv = evPct >= thresholds.minExpectedValuePct;

        let rejectionReason: string | undefined;
        if (!meetsTier) rejectionReason = `Nivel ${match.confidenceTier} insuficiente`;
        else if (!meetsCompleteness) rejectionReason = `Completitud < ${thresholds.minCompletenessPct}%`;
        else if (!meetsSpread) rejectionReason = `Discrepancia > ${thresholds.maxModelSpreadPct} pp`;
        else if (!meetsEv) rejectionReason = `EV < ${thresholds.minExpectedValuePct}%`;

        list.push({
          id: `${match.id}_${c.suffix}`,
          matchId: match.id,
          matchLabel: `${match.homeTeamName} vs ${match.awayTeamName}`,
          leagueId: match.leagueId,
          market: c.market,
          selection: c.selection,
          modelProb: c.prob,
          decimalOdds: c.odds,
          impliedProbRaw: metrics.impliedProb,
          impliedProbNoMargin: c.deVig,
          fairOdds: metrics.fairOdds,
          edge: metrics.edge,
          expectedValue: metrics.expectedValue,
          confidenceTier: match.confidenceTier,
          hasStatisticalValue: Boolean(
            !thresholds.strictModeNoForce &&
              meetsTier &&
              meetsCompleteness &&
              meetsSpread &&
              meetsEv
          ),
          rejectionReason,
        });
      }
    }
    return list.sort((a, b) => b.expectedValue - a.expectedValue);
  }, [activeMatches, weights, thresholds]);

  const handleImportCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      const result = parseMatchesCsv(content);
      setCsvMatches(result.matches);
      setCsvErrors(result.errors);
      setDataSourceMode('csv');
      setActiveSection('matches_today');
    };
    reader.readAsText(file);
  };

  const handleDownloadCsvTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE_CONTENT], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'football_ai_predictor_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSavePrediction = (item: PredictionHistoryItem) => {
    if (dataSourceMode === 'sandbox') {
      setSandboxHistory((prev) => [item, ...prev]);
    } else {
      setCustomHistory((prev) => [item, ...prev]);
    }
  };

  const handleSettlePrediction = (id: string, outcome: 0 | 1, actualScore: string) => {
    const updater = (prev: PredictionHistoryItem[]) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          status: outcome === 1 ? ('acertada' as const) : ('fallada' as const),
          actualResult: actualScore,
          brierScore: Number(computeBrierScoreBinary(item.predictedProb, outcome).toFixed(4)),
          logLoss: Number(computeLogLossBinary(item.predictedProb, outcome).toFixed(4)),
          simulatedRoiUnit: Number((outcome === 1 ? item.oddsAtPrediction - 1 : -1).toFixed(2)),
        };
      });

    if (dataSourceMode === 'sandbox') {
      setSandboxHistory(updater);
    } else {
      setCustomHistory(updater);
    }
  };

  const analyzedHomeTeam = analyzedMatch
    ? SANDBOX_TEAMS.find((t) => t.id === analyzedMatch.homeTeamId)
    : undefined;
  const analyzedAwayTeam = analyzedMatch
    ? SANDBOX_TEAMS.find((t) => t.id === analyzedMatch.awayTeamId)
    : undefined;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeSection={activeSection}
          selectedLeague={selectedLeague}
          onChangeLeague={setSelectedLeague}
          dataSourceMode={dataSourceMode}
          onChangeDataSource={setDataSourceMode}
          onImportCsvFile={handleImportCsvFile}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto space-y-6">
          <DataSourceBanner
            mode={dataSourceMode}
            csvCount={csvMatches.length}
            csvErrors={csvErrors}
            onSwitchMode={setDataSourceMode}
            onDownloadTemplate={handleDownloadCsvTemplate}
          />

          {activeSection === 'dashboard' && (
            <DashboardView
              matches={activeMatches}
              selectedLeague={selectedLeague}
              history={activeHistory}
              calibrationBins={activeCalibrationBins}
              valueOpportunities={valueOpportunities}
              thresholds={thresholds}
              onToggleStrictNoForce={() =>
                setThresholds((prev) => ({
                  ...prev,
                  strictModeNoForce: !prev.strictModeNoForce,
                }))
              }
              onAnalyzeMatch={setAnalyzedMatch}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'matches_today' && (
            <MatchesTodayView
              matches={activeMatches}
              selectedLeague={selectedLeague}
              onChangeLeague={setSelectedLeague}
              onAnalyzeMatch={setAnalyzedMatch}
            />
          )}

          {activeSection === 'all_leagues' && (
            <LeaguesView
              teams={activeTeams}
              selectedLeague={selectedLeague}
              onChangeLeague={setSelectedLeague}
            />
          )}

          {activeSection === 'ai_analysis' && (
            <AiAnalysisView
              matches={activeMatches}
              teams={activeTeams}
              onAnalyzeMatch={setAnalyzedMatch}
            />
          )}

          {activeSection === 'predictions' && (
            <PredictionsView
              matches={activeMatches}
              thresholds={thresholds}
              onAnalyzeMatch={setAnalyzedMatch}
            />
          )}

          {activeSection === 'value_finder' && (
            <ValueFinderView
              opportunities={valueOpportunities}
              thresholds={thresholds}
            />
          )}

          {activeSection === 'model_comparator' && (
            <ModelComparatorView
              matches={activeMatches}
              weights={weights}
              onUpdateWeights={setWeights}
            />
          )}

          {activeSection === 'history' && (
            <HistoryView
              history={activeHistory}
              onSettlePrediction={handleSettlePrediction}
            />
          )}

          {activeSection === 'performance' && (
            <PerformanceView
              history={activeHistory}
              calibrationBins={activeCalibrationBins}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              dataSourceMode={dataSourceMode}
              onChangeDataSource={setDataSourceMode}
              thresholds={thresholds}
              onUpdateThresholds={setThresholds}
              onDownloadCsvTemplate={handleDownloadCsvTemplate}
            />
          )}
        </main>
      </div>

      <MatchAnalyzerDrawer
        match={analyzedMatch}
        homeTeam={analyzedMatch?.isSynthetic ? analyzedHomeTeam : undefined}
        awayTeam={analyzedMatch?.isSynthetic ? analyzedAwayTeam : undefined}
        weights={weights}
        onClose={() => setAnalyzedMatch(null)}
        onSavePrediction={handleSavePrediction}
      />
    </div>
  );
}
