/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ENSEMBLE_WEIGHTS,
  DEFAULT_QUALITY_THRESHOLDS,
  SANDBOX_CALIBRATION_BINS,
  SANDBOX_HISTORY,
  SANDBOX_MATCHES,
  SANDBOX_TEAMS,
} from './data/sandboxDataset';
import {
  ActiveTrainedModelInfo,
  BacktestReproductionResult,
  BacktestRunSummary,
  CalibrationBin,
  DataAuditReport,
  DataSourceMode,
  DbStatusSummary,
  DetectedValueOpportunityRecord,
  EnsembleWeights,
  LeagueFilter,
  MatchRecord,
  MonitoringConfigState,
  MonitoringDashboardData,
  NavSectionId,
  OddsHistoryTimeline,
  PredictionHistoryItem,
  ProviderId,
  ProviderStatusInfo,
  QualityFilterThresholds,
  SyncExecutionSummary,
  SyncLogEntry,
  TeamStatisticalProfile,
  ValueOpportunity,
} from './types/football';
import {
  calculateValueMetrics,
  combineEnsembleProbabilities,
  computeBrierScoreBinary,
  computeDixonColesScoreMatrix,
  computeLogLossBinary,
  computePoissonScoreMatrix,
} from './utils/previewMath';
import {
  CSV_TEMPLATE_CONTENT,
  CsvParseResult,
  parseMatchesCsv,
} from './utils/csvImporter';
import { apiClient } from './services/apiClient';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DataSourceBanner } from './components/ui/DataSourceBanner';
import {
  MatchAnalyzerDrawer,
  PredictionSnapshotPayload,
} from './components/MatchAnalyzerDrawer';
import { CsvImportModal } from './components/CsvImportModal';
import { DashboardView } from './views/DashboardView';
import { MatchesTodayView } from './views/MatchesTodayView';
import { LeaguesView } from './views/LeaguesView';
import { AiAnalysisView } from './views/AiAnalysisView';
import { PredictionsView } from './views/PredictionsView';
import { ValueFinderView } from './views/ValueFinderView';
import { ModelComparatorView } from './views/ModelComparatorView';
import { HistoryView } from './views/HistoryView';
import { PerformanceView } from './views/PerformanceView';
import { MonitoringView } from './views/MonitoringView';
import { SettingsView } from './views/SettingsView';

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [selectedLeague, setSelectedLeague] = useState<LeagueFilter>('all');
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('sandbox');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Estado real de PostgreSQL / Supabase
  const [dbStatus, setDbStatus] = useState<DbStatusSummary | null>(null);
  const [dbMatches, setDbMatches] = useState<MatchRecord[]>([]);
  const [dbTeams, setDbTeams] = useState<TeamStatisticalProfile[]>([]);
  const [dbHistory, setDbHistory] = useState<PredictionHistoryItem[]>([]);
  const [dbCalibrationBins, setDbCalibrationBins] = useState<CalibrationBin[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);

  // Estado de proveedores deportivos reales (Fase 4)
  const [providers, setProviders] = useState<ProviderStatusInfo[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncExecutionSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Estado Fase 5: Auditoría, Backtesting Walk-Forward, Modelo Activo y Bitácora de Valor
  const [auditReport, setAuditReport] = useState<DataAuditReport | null>(null);
  const [backtestHistory, setBacktestHistory] = useState<BacktestRunSummary[]>([]);
  const [activeTrainedModel, setActiveTrainedModel] = useState<ActiveTrainedModelInfo | null>(null);
  const [savedValueOpps, setSavedValueOpps] = useState<DetectedValueOpportunityRecord[]>([]);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [isSavingOppId, setIsSavingOppId] = useState<string | null>(null);
  const [isSettlingOpps, setIsSettlingOpps] = useState(false);

  // Estado Fase 6: Reproducibilidad, Histórico Inmutable de Cuotas y Monitorización
  const [reproductionResult, setReproductionResult] = useState<BacktestReproductionResult | null>(null);
  const [isReproducing, setIsReproducing] = useState(false);
  const [monitoringData, setMonitoringData] = useState<MonitoringDashboardData | null>(null);
  const [oddsTimelines, setOddsTimelines] = useState<OddsHistoryTimeline[]>([]);
  const [isMonitoringLoading, setIsMonitoringLoading] = useState(false);
  const [monitoringActionMessage, setMonitoringActionMessage] = useState<string | null>(null);
  const [monitoringActionError, setMonitoringActionError] = useState<string | null>(null);

  // CSV temporal y modal de confirmación
  const [csvMatches, setCsvMatches] = useState<MatchRecord[]>([]);
  const [csvErrorsCount, setCsvErrorsCount] = useState<number>(0);
  const [pendingCsvFile, setPendingCsvFile] = useState<{
    filename: string;
    result: CsvParseResult;
  } | null>(null);
  const [isSavingCsvDb, setIsSavingCsvDb] = useState(false);
  const [csvSaveError, setCsvSaveError] = useState<string | null>(null);

  // Pesos y umbrales
  const [weights, setWeights] = useState<EnsembleWeights>(DEFAULT_ENSEMBLE_WEIGHTS);
  const [thresholds, setThresholds] = useState<QualityFilterThresholds>(
    DEFAULT_QUALITY_THRESHOLDS
  );

  // Analizador e historial sandbox aislado
  const [analyzedMatch, setAnalyzedMatch] = useState<MatchRecord | null>(null);
  const [sandboxHistory, setSandboxHistory] = useState<PredictionHistoryItem[]>(SANDBOX_HISTORY);

  const loadPersistedData = useCallback(async (league: LeagueFilter) => {
    const [
      matchesRes,
      teamsRes,
      historyRes,
      perfRes,
      configRes,
      auditRes,
      btHistoryRes,
      activeModelRes,
      valueOppsRes,
      monitoringRes,
      oddsHistoryRes,
    ] = await Promise.all([
      apiClient.getMatches(league),
      apiClient.getTeams(league),
      apiClient.getPredictionHistory(league),
      apiClient.getPerformance(league),
      apiClient.getModelConfig(),
      apiClient.getAuditReport().catch(() => null),
      apiClient.getBacktestHistory().catch(() => []),
      apiClient.getActiveTrainedModel().catch(() => null),
      apiClient.getValueOpportunities(league).catch(() => []),
      apiClient.getMonitoringDashboard(league).catch(() => null),
      apiClient.getOddsHistory(league).catch(() => []),
    ]);
    setDbMatches(matchesRes);
    setDbTeams(teamsRes);
    setDbHistory(historyRes);
    setDbCalibrationBins(perfRes.calibrationBins);
    if (configRes) {
      setWeights(configRes.weights);
      setThresholds(configRes.thresholds);
    }
    setAuditReport(auditRes);
    setBacktestHistory(btHistoryRes);
    setActiveTrainedModel(activeModelRes);
    setSavedValueOpps(valueOppsRes);
    setMonitoringData(monitoringRes);
    setOddsTimelines(oddsHistoryRes);
  }, []);

  const refreshDbHealth = useCallback(
    async (autoSwitchOnFirstReady = false) => {
      try {
        const status = await apiClient.getDbHealth();
        setDbStatus(status);
        if (status.connected && status.schemaReady) {
          await loadPersistedData(selectedLeague);
          if (autoSwitchOnFirstReady) {
            setDataSourceMode('database');
          }
        }
      } catch (err) {
        console.error('Error checking DB health:', err);
      }
    },
    [loadPersistedData, selectedLeague]
  );

  const refreshProvidersStatus = useCallback(async () => {
    try {
      const res = await apiClient.getProvidersStatus();
      setProviders(res.providers);
      setSyncLogs(res.recentLogs);
    } catch (err) {
      console.error('Error checking provider status:', err);
    }
  }, []);

  useEffect(() => {
    refreshDbHealth(true);
    refreshProvidersStatus();
    // Solo comprobación inicial al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dataSourceMode === 'database' && dbStatus?.connected && dbStatus?.schemaReady) {
      loadPersistedData(selectedLeague).catch((err) => {
        console.error('Error reloading DB data on league filter:', err);
      });
    }
  }, [selectedLeague, dataSourceMode, dbStatus?.connected, dbStatus?.schemaReady, loadPersistedData]);

  const handleRunMigrations = async () => {
    setIsMigrating(true);
    setMigrationMessage(null);
    try {
      const res = await apiClient.runMigrations();
      const msg =
        res.applied.length > 0
          ? `Migraciones aplicadas: ${res.applied.join(', ')}.`
          : 'Todas las migraciones ya estaban aplicadas.';
      setMigrationMessage(msg);
      await refreshDbHealth(true);
      await refreshProvidersStatus();
    } catch (err) {
      setMigrationMessage(err instanceof Error ? err.message : 'Error ejecutando migraciones.');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleRunProviderSync = async (params: {
    provider: ProviderId;
    leagueId: LeagueFilter;
    seasonYear?: number;
    includeOdds: boolean;
  }) => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const summary = await apiClient.runProviderSync(params);
      setSyncResult(summary);
      setDataSourceMode('database');
      await Promise.all([
        refreshDbHealth(false),
        refreshProvidersStatus(),
        loadPersistedData(selectedLeague),
      ]);
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : 'Error ejecutando sincronización deportiva.'
      );
      await refreshProvidersStatus();
    } finally {
      setIsSyncing(false);
    }
  };

  const activeMatches = useMemo(() => {
    const raw =
      dataSourceMode === 'database'
        ? dbMatches
        : dataSourceMode === 'sandbox'
        ? SANDBOX_MATCHES
        : dataSourceMode === 'csv'
        ? csvMatches
        : [];
    if (selectedLeague === 'all') return raw;
    return raw.filter((m) => m.leagueId === selectedLeague);
  }, [dataSourceMode, dbMatches, csvMatches, selectedLeague]);

  const activeTeams = useMemo(() => {
    const raw =
      dataSourceMode === 'database'
        ? dbTeams
        : dataSourceMode === 'sandbox'
        ? SANDBOX_TEAMS
        : [];
    if (selectedLeague === 'all') return raw;
    return raw.filter((t) => t.leagueId === selectedLeague);
  }, [dataSourceMode, dbTeams, selectedLeague]);

  const activeHistory = useMemo(() => {
    const raw =
      dataSourceMode === 'database'
        ? dbHistory
        : dataSourceMode === 'sandbox'
        ? sandboxHistory
        : [];
    if (selectedLeague === 'all') return raw;
    return raw.filter((h) => h.leagueId === selectedLeague);
  }, [dataSourceMode, dbHistory, sandboxHistory, selectedLeague]);

  const activeCalibrationBins = useMemo(() => {
    if (dataSourceMode === 'database') return dbCalibrationBins;
    if (dataSourceMode === 'sandbox') return SANDBOX_CALIBRATION_BINS;
    return [];
  }, [dataSourceMode, dbCalibrationBins]);

  const valueOpportunities = useMemo<ValueOpportunity[]>(() => {
    const list: ValueOpportunity[] = [];
    const nowMs = Date.now();
    for (const match of activeMatches) {
      if (!match.odds1X2) continue;

      const kickoffMs = match.kickoffUtc
        ? Date.parse(match.kickoffUtc)
        : Date.parse(`${match.date}T${match.kickoffTime}:00Z`);
      const isExpiredOdds =
        !match.isSynthetic &&
        (match.matchStatus === 'finished' ||
          (Number.isFinite(kickoffMs) && kickoffMs <= nowMs));

      const ensemble = combineEnsembleProbabilities(
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
        const scoreCalc =
          match.dixonColesRho !== undefined
            ? computeDixonColesScoreMatrix(
                match.expectedLambdaHome,
                match.expectedLambdaAway,
                match.dixonColesRho
              )
            : computePoissonScoreMatrix(
                match.expectedLambdaHome,
                match.expectedLambdaAway
              );
        candidates.push({
          suffix: 'o25',
          market: 'Goles',
          selection: 'Más de 2.5 goles',
          prob: scoreCalc.markets.goals.over25,
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
        if (isExpiredOdds) rejectionReason = 'Cuota caducada (partido iniciado/finalizado)';
        else if (!meetsTier) rejectionReason = `Nivel ${match.confidenceTier} insuficiente`;
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
            !isExpiredOdds &&
              !thresholds.strictModeNoForce &&
              meetsTier &&
              meetsCompleteness &&
              meetsSpread &&
              meetsEv
          ),
          rejectionReason,
          bookmaker: match.odds1X2.bookmaker,
          oddsCapturedAt: match.oddsCapturedAt ?? null,
          isExpiredOdds,
          kickoffUtc: match.kickoffUtc,
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
      setCsvSaveError(null);
      setPendingCsvFile({ filename: file.name, result });
    };
    reader.readAsText(file);
  };

  const handleConfirmSaveCsvDb = async () => {
    if (!pendingCsvFile) return;
    setIsSavingCsvDb(true);
    setCsvSaveError(null);
    try {
      await apiClient.importCsvToDb(
        pendingCsvFile.filename,
        pendingCsvFile.result.dbRows
      );
      setPendingCsvFile(null);
      setDataSourceMode('database');
      await refreshDbHealth(false);
      await loadPersistedData(selectedLeague);
      setActiveSection('matches_today');
    } catch (err) {
      setCsvSaveError(
        err instanceof Error ? err.message : 'Error guardando archivo CSV en PostgreSQL.'
      );
    } finally {
      setIsSavingCsvDb(false);
    }
  };

  const handleUseCsvPreviewOnly = () => {
    if (!pendingCsvFile) return;
    setCsvMatches(pendingCsvFile.result.matches);
    setCsvErrorsCount(pendingCsvFile.result.errors.length);
    setPendingCsvFile(null);
    setDataSourceMode('csv');
    setActiveSection('matches_today');
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

  const handleSavePrediction = async (
    item: PredictionHistoryItem,
    payload: PredictionSnapshotPayload
  ) => {
    if (dataSourceMode === 'database' && dbStatus?.connected && dbStatus?.schemaReady) {
      await apiClient.createPredictionSnapshot(payload);
      await refreshDbHealth(false);
      await loadPersistedData(selectedLeague);
      return;
    }

    if (dataSourceMode === 'sandbox') {
      setSandboxHistory((prev) => [item, ...prev]);
    }
  };

  const handleSettlePrediction = async (id: string, outcome: 0 | 1, actualScore: string) => {
    if (dataSourceMode === 'database' && dbStatus?.connected && dbStatus?.schemaReady) {
      await apiClient.settlePrediction(id, outcome, actualScore);
      await loadPersistedData(selectedLeague);
      return;
    }

    if (dataSourceMode === 'sandbox') {
      setSandboxHistory((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            status: outcome === 1 ? 'acertada' : 'fallada',
            actualResult: actualScore,
            brierScore: Number(computeBrierScoreBinary(item.predictedProb, outcome).toFixed(4)),
            logLoss: Number(computeLogLossBinary(item.predictedProb, outcome).toFixed(4)),
            simulatedRoiUnit: Number((outcome === 1 ? item.oddsAtPrediction - 1 : -1).toFixed(2)),
          };
        })
      );
    }
  };

  const handleUpdateWeights = (nextWeights: EnsembleWeights) => {
    setWeights(nextWeights);
    if (dataSourceMode === 'database' && dbStatus?.connected && dbStatus?.schemaReady) {
      apiClient.updateModelConfig(nextWeights, thresholds).catch((err) => {
        console.error('Failed to persist ensemble weights:', err);
      });
    }
  };

  const handleUpdateThresholds = (nextThresholds: QualityFilterThresholds) => {
    setThresholds(nextThresholds);
    if (dataSourceMode === 'database' && dbStatus?.connected && dbStatus?.schemaReady) {
      apiClient.updateModelConfig(weights, nextThresholds).catch((err) => {
        console.error('Failed to persist thresholds:', err);
      });
    }
  };

  const handleRunBacktest = async (params: {
    leagueId: LeagueFilter;
    calibrationMethod: 'platt' | 'isotonic' | 'none';
    trainAndActivate: boolean;
  }) => {
    setIsRunningBacktest(true);
    setBacktestError(null);
    try {
      await apiClient.runBacktest(params);
      await loadPersistedData(selectedLeague);
    } catch (err) {
      setBacktestError(
        err instanceof Error ? err.message : 'Error ejecutando backtesting walk-forward.'
      );
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const handleSaveValueOpportunity = async (opp: ValueOpportunity) => {
    setIsSavingOppId(opp.id);
    try {
      await apiClient.saveValueOpportunity({
        matchId: opp.matchId,
        modelVersionId: activeTrainedModel?.id ?? 'ensemble-v2-p5',
        market: opp.market,
        selection: opp.selection,
        bookmaker: opp.bookmaker ?? 'Market',
        modelProb: opp.modelProb,
        decimalOdds: opp.decimalOdds,
        impliedProbRaw: opp.impliedProbRaw,
        impliedProbDevig: opp.impliedProbNoMargin,
        fairOdds: opp.fairOdds,
        edgePp: Number((opp.edge * 100).toFixed(2)),
        expectedValue: opp.expectedValue,
        confidenceTier: opp.confidenceTier,
        oddsCapturedAt: opp.oddsCapturedAt ?? null,
      });
      const updated = await apiClient.getValueOpportunities(selectedLeague);
      setSavedValueOpps(updated);
    } catch (err) {
      console.error('Error saving value opportunity:', err);
    } finally {
      setIsSavingOppId(null);
    }
  };

  const handleSettleValueOpportunities = async () => {
    setIsSettlingOpps(true);
    try {
      await apiClient.settleValueOpportunities();
      const updated = await apiClient.getValueOpportunities(selectedLeague);
      setSavedValueOpps(updated);
    } catch (err) {
      console.error('Error settling value opportunities:', err);
    } finally {
      setIsSettlingOpps(false);
    }
  };

  const handleReproduceBacktest = async (runId: string) => {
    setIsReproducing(true);
    setBacktestError(null);
    try {
      const result = await apiClient.reproduceBacktest(runId);
      setReproductionResult(result);
    } catch (err) {
      setBacktestError(
        err instanceof Error ? err.message : 'Error reproduciendo ejecución de backtesting.'
      );
    } finally {
      setIsReproducing(false);
    }
  };

  const handleRefreshMonitoring = async () => {
    setIsMonitoringLoading(true);
    setMonitoringActionError(null);
    try {
      await loadPersistedData(selectedLeague);
    } catch (err) {
      setMonitoringActionError(
        err instanceof Error ? err.message : 'Error actualizando panel de monitorización.'
      );
    } finally {
      setIsMonitoringLoading(false);
    }
  };

  const handleUpdateMonitoringConfig = async (partial: Partial<MonitoringConfigState>) => {
    setMonitoringActionError(null);
    try {
      const updated = await apiClient.updateMonitoringConfig(partial);
      setMonitoringData((prev) => (prev ? { ...prev, config: updated } : prev));
      setMonitoringActionMessage('Configuración de monitorización guardada en PostgreSQL.');
    } catch (err) {
      setMonitoringActionError(
        err instanceof Error ? err.message : 'Error guardando configuración de monitorización.'
      );
    }
  };

  const handleCaptureOddsNow = async (league: LeagueFilter) => {
    setIsMonitoringLoading(true);
    setMonitoringActionMessage(null);
    setMonitoringActionError(null);
    try {
      const res = await apiClient.captureOddsNow(league);
      if (!res.executed) {
        setMonitoringActionError(res.skippedReason ?? 'Captura de cuotas omitida.');
      } else {
        setMonitoringActionMessage(
          `Snapshot de cuotas completado: ${res.oddsInserted} registros inmutables añadidos (${res.requestsUsed} peticiones, cuota: ${res.quotaRemaining ?? 'N/D'}).`
        );
      }
      await loadPersistedData(selectedLeague);
    } catch (err) {
      setMonitoringActionError(
        err instanceof Error ? err.message : 'Error capturando snapshot de cuotas.'
      );
    } finally {
      setIsMonitoringLoading(false);
    }
  };

  const handleCaptureUpcomingPredictions = async (league: LeagueFilter) => {
    setIsMonitoringLoading(true);
    setMonitoringActionMessage(null);
    setMonitoringActionError(null);
    try {
      const res = await apiClient.captureUpcomingPredictions(league);
      setMonitoringActionMessage(
        `Seguimiento pre-partido actualizado (${res.modelVersionId}): ${res.registeredCount} registradas (${res.withMarketOddsCount} con cuota real), ${res.skippedExisting} ya existentes, ${res.skippedDiscarded} descartadas.`
      );
      await Promise.all([refreshDbHealth(false), loadPersistedData(selectedLeague)]);
    } catch (err) {
      setMonitoringActionError(
        err instanceof Error ? err.message : 'Error registrando predicciones pre-partido.'
      );
    } finally {
      setIsMonitoringLoading(false);
    }
  };

  const handleAutoSettleMonitoring = async () => {
    setIsMonitoringLoading(true);
    setMonitoringActionMessage(null);
    setMonitoringActionError(null);
    try {
      const res = await apiClient.autoSettlePending();
      setMonitoringActionMessage(
        `Liquidación automática ejecutada: ${res.settledPredictions} predicciones y ${res.settledValueOpportunities} oportunidades Value Finder liquidadas.`
      );
      await loadPersistedData(selectedLeague);
    } catch (err) {
      setMonitoringActionError(
        err instanceof Error ? err.message : 'Error ejecutando auto-liquidación.'
      );
    } finally {
      setIsMonitoringLoading(false);
    }
  };

  const analyzedHomeTeam = analyzedMatch
    ? activeTeams.find((t) => t.id === analyzedMatch.homeTeamId)
    : undefined;
  const analyzedAwayTeam = analyzedMatch
    ? activeTeams.find((t) => t.id === analyzedMatch.awayTeamId)
    : undefined;

  const isDbReady = Boolean(dbStatus?.connected && dbStatus?.schemaReady);

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
          dbStatus={dbStatus}
          onImportCsvFile={handleImportCsvFile}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto space-y-6">
          <DataSourceBanner
            mode={dataSourceMode}
            dbStatus={dbStatus}
            csvCount={csvMatches.length}
            csvErrorsCount={csvErrorsCount}
            onSwitchMode={setDataSourceMode}
            onDownloadTemplate={handleDownloadCsvTemplate}
            onOpenSettings={() => setActiveSection('settings')}
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
                handleUpdateThresholds({
                  ...thresholds,
                  strictModeNoForce: !thresholds.strictModeNoForce,
                })
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
              dataSourceMode={dataSourceMode}
              savedOpportunities={savedValueOpps}
              isSavingOppId={isSavingOppId}
              isSettlingOpps={isSettlingOpps}
              onSaveOpportunity={handleSaveValueOpportunity}
              onSettleOpportunities={handleSettleValueOpportunities}
            />
          )}

          {activeSection === 'model_comparator' && (
            <ModelComparatorView
              matches={activeMatches}
              weights={weights}
              onUpdateWeights={handleUpdateWeights}
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
              dataSourceMode={dataSourceMode}
              auditReport={auditReport}
              backtestHistory={backtestHistory}
              activeTrainedModel={activeTrainedModel}
              isRunningBacktest={isRunningBacktest}
              backtestError={backtestError}
              onRunBacktest={handleRunBacktest}
              reproductionResult={reproductionResult}
              isReproducing={isReproducing}
              onReproduceBacktest={handleReproduceBacktest}
            />
          )}

          {activeSection === 'monitoring' && (
            <MonitoringView
              dataSourceMode={dataSourceMode}
              selectedLeague={selectedLeague}
              monitoring={monitoringData}
              oddsTimelines={oddsTimelines}
              auditReport={auditReport}
              isLoading={isMonitoringLoading}
              actionMessage={monitoringActionMessage}
              actionError={monitoringActionError}
              onRefresh={handleRefreshMonitoring}
              onUpdateConfig={handleUpdateMonitoringConfig}
              onCaptureOddsNow={handleCaptureOddsNow}
              onCaptureUpcomingPredictions={handleCaptureUpcomingPredictions}
              onAutoSettle={handleAutoSettleMonitoring}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              dataSourceMode={dataSourceMode}
              onChangeDataSource={setDataSourceMode}
              dbStatus={dbStatus}
              isMigrating={isMigrating}
              migrationMessage={migrationMessage}
              onRefreshDbStatus={() => refreshDbHealth(false)}
              onRunMigrations={handleRunMigrations}
              providers={providers}
              syncLogs={syncLogs}
              isSyncing={isSyncing}
              syncResult={syncResult}
              syncError={syncError}
              onRefreshProviders={refreshProvidersStatus}
              onRunSync={handleRunProviderSync}
              thresholds={thresholds}
              onUpdateThresholds={handleUpdateThresholds}
              onDownloadCsvTemplate={handleDownloadCsvTemplate}
              activeTrainedModel={activeTrainedModel}
              backtestCount={backtestHistory.length}
            />
          )}
        </main>
      </div>

      <MatchAnalyzerDrawer
        match={analyzedMatch}
        homeTeam={analyzedHomeTeam}
        awayTeam={analyzedAwayTeam}
        weights={weights}
        onClose={() => setAnalyzedMatch(null)}
        onSavePrediction={handleSavePrediction}
      />

      <CsvImportModal
        filename={pendingCsvFile?.filename ?? ''}
        parseResult={pendingCsvFile?.result ?? null}
        dbReady={isDbReady}
        isSaving={isSavingCsvDb}
        saveError={csvSaveError}
        onCancel={() => setPendingCsvFile(null)}
        onConfirmSaveDb={handleConfirmSaveCsvDb}
        onUseLocalPreviewOnly={handleUseCsvPreviewOnly}
      />
    </div>
  );
}
