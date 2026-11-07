import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  Sparkles,
  Timer,
  Trophy,
} from 'lucide-react'
import { api } from '../lib/api'
import { useDataset } from '../context/dataset-context'
import { useI18n } from '../i18n/language-context'
import {
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSeconds,
  formatUnits,
  shortDate,
  titleCase,
} from '../lib/utils'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KpiCard,
  PageHeader,
  Select,
  SkeletonRows,
} from '../components/ui'
import { ChartCard, DemoNotice, EvidenceNote, Metric } from '../components/shared'
import { BenchmarkForecastChart, MetricBars, RocCurve } from '../components/charts'
import type { BenchmarkData } from '../lib/types'

const TASKS = [
  {
    value: 'revenue_forecast',
    label: 'Revenue forecast',
    models: [
      ['linear_regression', 'Linear Regression'],
      ['moving_average', 'Moving Average'],
      ['holt', 'Exponential Smoothing (Holt)'],
      ['random_forest', 'Random Forest'],
      ['xgboost', 'XGBoost'],
      ['arima', 'ARIMA'],
    ],
  },
  {
    value: 'demand_forecast',
    label: 'Demand forecast',
    models: [
      ['linear_regression', 'Linear Regression'],
      ['moving_average', 'Moving Average'],
      ['holt', 'Exponential Smoothing (Holt)'],
      ['random_forest', 'Random Forest'],
      ['xgboost', 'XGBoost'],
      ['arima', 'ARIMA'],
    ],
  },
  {
    value: 'churn_classification',
    label: 'Churn classification',
    models: [
      ['logistic_regression', 'Logistic Regression'],
      ['random_forest', 'Random Forest'],
    ],
  },
  {
    value: 'customer_clustering',
    label: 'Customer clustering',
    models: [
      ['kmeans_2', 'K-Means (k=2)'],
      ['kmeans_3', 'K-Means (k=3)'],
      ['kmeans_4', 'K-Means (k=4)'],
      ['kmeans_5', 'K-Means (k=5)'],
      ['kmeans_6', 'K-Means (k=6)'],
    ],
  },
]

interface PrimaryMetric {
  key: string
  label: string
  lowerIsBetter: boolean
}

function primaryMetric(result: BenchmarkData): PrimaryMetric {
  if (result.task === 'churn_classification') {
    return { key: 'roc_auc', label: 'ROC-AUC', lowerIsBetter: false }
  }
  if (result.task === 'customer_clustering') {
    return { key: 'silhouette_score', label: 'Silhouette score', lowerIsBetter: false }
  }
  return { key: 'mae', label: 'MAE', lowerIsBetter: true }
}

function formatPrimaryValue(
  result: BenchmarkData,
  value: number | null | undefined,
  units: (count: string) => string,
) {
  if (value === null || value === undefined) return '—'
  if (result.task === 'churn_classification') return formatNumber(value, 3)
  if (result.task === 'customer_clustering') return formatNumber(value, 3)
  return result.unit === 'currency' ? formatCurrency(value) : units(formatNumber(value, 1))
}

function formatCriterion(result: BenchmarkData, criterion: string, value: string | number | null) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  const lower = criterion.toLowerCase()
  if (lower.includes('runtime') || lower.includes('thời gian chạy')) return formatSeconds(value)
  if (lower.includes('mae') || lower.includes('rmse')) {
    return result.unit === 'currency' ? formatCurrency(value) : formatUnits(value)
  }
  if (lower.includes('mape')) return formatPercent(value)
  if (
    lower.includes('accuracy') ||
    lower.includes('precision') ||
    lower.includes('recall') ||
    lower.includes('độ chính xác') ||
    lower.includes('độ phủ dương') ||
    lower.includes('f1')
  ) {
    return formatPercent(value * 100)
  }
  if (lower.includes('inertia')) return formatNumber(value, 2)
  if (
    lower.includes('roc') ||
    lower.includes('r²') ||
    lower.includes('silhouette') ||
    lower.includes('davies')
  ) {
    return formatNumber(value, 4)
  }
  return formatNumber(value, 4)
}

function betterSide(
  criterion: string,
  human: string | number | null,
  ai: string | number | null,
  better?: string,
): 'human' | 'ai' | null {
  if (typeof human !== 'number' || typeof ai !== 'number' || human === ai) return null
  if (!better && !['mae', 'rmse', 'mape', 'r²', 'accuracy', 'precision', 'recall', 'f1', 'roc', 'silhouette', 'davies', 'inertia'].some((term) => criterion.toLowerCase().includes(term))) {
    return null
  }
  const lowerBetter = better === 'lower'
  if (better === 'higher') return ai > human ? 'ai' : 'human'
  if (lowerBetter) return ai < human ? 'ai' : 'human'
  return null
}

function benchmarkWinner(result: BenchmarkData) {
  const metric = primaryMetric(result)
  const human = result.human.metrics[metric.key]
  const ai = result.ai.metrics[metric.key]
  if (human === null || human === undefined || ai === null || ai === undefined) return null
  if (human === ai) return 'tie'
  if (metric.lowerIsBetter) return ai < human ? 'ai' : 'human'
  return ai > human ? 'ai' : 'human'
}

function candidateMetric(result: BenchmarkData, candidate: Record<string, any>) {
  const source = candidate.metrics && typeof candidate.metrics === 'object' ? candidate.metrics : candidate
  const keys =
    result.task === 'churn_classification'
      ? ['validation_roc_auc', 'roc_auc']
      : result.task === 'customer_clustering'
        ? ['silhouette_score']
        : ['validation_mae', 'mae']
  const key = keys.find((item) => source[item] !== undefined && source[item] !== null)
  if (!key) return null
  const value = Number(source[key])
  return {
    label: titleCase(key.replace('validation_', '')),
    value:
      result.task === 'revenue_forecast'
        ? formatCurrency(value)
        : result.task === 'demand_forecast'
          ? formatUnits(value)
          : formatNumber(value, 4),
  }
}

export function ModelsPage() {
  const { activeDatasetId } = useDataset()
  return <ModelsPageContent key={activeDatasetId ?? 'no-dataset'} />
}

function ModelsPageContent() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [task, setTask] = useState('revenue_forecast')
  const [humanModel, setHumanModel] = useState('linear_regression')
  const [testRatio, setTestRatio] = useState(20)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const activeTask = TASKS.find((item) => item.value === task)
  const modelOptions = activeTask?.models ?? []
  const resolvedHumanModel = modelOptions.some(([value]) => value === humanModel)
    ? humanModel
    : modelOptions[0]?.[0] ?? 'linear_regression'

  const list = useQuery({
    queryKey: ['benchmarks', activeDatasetId],
    queryFn: () => api.models.list(activeDatasetId ?? undefined, 30),
    enabled: Boolean(activeDatasetId),
    staleTime: 30_000,
  })

  const run = useMutation({
    mutationFn: () =>
      api.models.run(
        activeDatasetId as string,
        task,
        resolvedHumanModel,
        Math.min(0.4, Math.max(0.1, testRatio / 100)),
      ),
    onSuccess: async (result) => {
      setSelectedId(result.benchmark_id ?? null)
      await queryClient.invalidateQueries({ queryKey: ['benchmarks'] })
    },
  })

  const items = list.data?.items ?? []
  const activeItem = selectedId ? items.find((item) => item.id === selectedId) : items[0]
  const result =
    run.data && (!selectedId || run.data.benchmark_id === selectedId)
      ? run.data
      : activeItem?.results ?? null

  const winner = result ? benchmarkWinner(result) : null
  const metric = result ? primaryMetric(result) : null
  const humanPrimary = result && metric ? result.human.metrics[metric.key] : null
  const aiPrimary = result && metric ? result.ai.metrics[metric.key] : null
  const forecastChart = result?.task === 'revenue_forecast' || result?.task === 'demand_forecast'
    ? (result.chart_data as Array<Record<string, any>>)
    : []
  const churnChart = result?.task === 'churn_classification' ? (result.chart_data as Record<string, any>) : null
  const clusteringChart = result?.task === 'customer_clustering' ? (result.chart_data as Record<string, any>) : null

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Model evaluation')}
        title={t('Model Arena')}
        description={t(
          'Benchmark a human-selected model against the AI-selected model on the same untouched holdout. Metrics, runtime and validation are computed live — no hard-coded scores.',
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={list.isFetching ? 'animate-spin' : ''} />}
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            {t('Refresh history')}
          </Button>
        }
      >
        <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-12">
        <Card className="p-5 xl:col-span-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300">
              <FlaskConical size={18} />
            </div>
            <div>
              <h3 className="section-title">{t('Configure benchmark')}</h3>
              <p className="text-[10px] text-slate-400">{t('Chronological/stratified holdout')}</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <Field label={t('Prediction task')}>
              <Select value={task} onChange={(event) => setTask(event.target.value)}>
                {TASKS.map((item) => (
                  <option key={item.value} value={item.value}>{t(item.label)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('Human-selected model')}>
              <Select value={resolvedHumanModel} onChange={(event) => setHumanModel(event.target.value)}>
                {activeTask?.models.map(([value, label]) => (
                  <option key={value} value={value}>{t(label)}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('Holdout size (%)')}
              hint={t('The test window is never used for model selection.')}
            >
              <Input
                type="number"
                min={10}
                max={40}
                value={testRatio}
                onChange={(event) => setTestRatio(Number(event.target.value))}
              />
            </Field>
          </div>
          <Button
            className="mt-4 w-full"
            loading={run.isPending}
            disabled={!activeDatasetId}
            onClick={() => run.mutate()}
            icon={<Sparkles size={14} />}
          >
            {t('Run benchmark')}
          </Button>
          {run.isError && (
            <p className="mt-2 text-[11px] leading-5 text-rose-600 dark:text-rose-400">
              {(run.error as Error).message}
            </p>
          )}
          <div className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-400 dark:bg-white/[0.03]">
            {t(
              'Benchmarking trains multiple candidate models and can take several seconds. The AI selection uses only validation data inside the training split.',
            )}
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-8">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-white/[0.06]">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('Benchmark history')}</h3>
              <p className="text-[10px] text-slate-400">{t('Saved runs for this dataset')}</p>
            </div>
            <Badge tone="slate">{list.data?.total ?? 0}</Badge>
          </div>
          {list.isLoading && <div className="p-5"><SkeletonRows rows={3} /></div>}
          {list.isError && (
            <div className="p-5">
              <ErrorState error={list.error as Error} retry={() => list.refetch()} title={t('History unavailable')} />
            </div>
          )}
          <div className="grid max-h-[330px] gap-2 overflow-y-auto p-3 sm:grid-cols-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition',
                  activeItem?.id === item.id
                    ? 'border-brand-200 bg-brand-50/70 dark:border-brand-500/25 dark:bg-brand-500/[0.08]'
                    : 'border-slate-100 hover:border-slate-200 dark:border-white/[0.06] dark:hover:border-white/10',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="blue" className="px-1.5 py-0.5 text-[9px]">
                    {t(item.results.task_label)}
                  </Badge>
                  <span className="text-[9px] text-slate-400">{shortDate(item.created_at)}</span>
                </div>
                <p className="mt-1.5 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  {item.results.human.label}
                </p>
                <p className="truncate text-[10px] text-slate-400">{t('vs')} {item.results.ai.label}</p>
              </button>
            ))}
            {list.data && !items.length && (
              <div className="col-span-full px-4 py-10 text-center text-xs text-slate-400">
                {t('No benchmark has been run for this dataset yet.')}
              </div>
            )}
          </div>
        </Card>
      </div>

      {run.isPending && (
        <Card className="flex items-center gap-3 p-5">
          <FlaskConical size={20} className="animate-pulse text-brand-500" />
          <div>
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{t('Benchmark is running')}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{t('Training candidates, selecting the AI model and computing holdout metrics…')}</p>
          </div>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="blue">{t(result.task_label)}</Badge>
                  <Badge tone="slate">{result.target}</Badge>
                  {result.frequency && <Badge tone="slate">{result.frequency}</Badge>}
                </div>
                <h2 className="mt-2 text-xl font-extrabold text-slate-950 dark:text-white">
                  {result.human.label} <span className="text-slate-300 dark:text-slate-600">{t('vs')}</span> {result.ai.label}
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  {t('{method} · completed in {duration}', {
                    method: result.split.method,
                    duration: formatSeconds(result.duration_seconds),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="green" dot>{t('Actual holdout')}</Badge>
                {result.created_at && <span className="text-[10px] text-slate-400">{shortDate(result.created_at)}</span>}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t('Human-selected')}
              value={t(result.human.label)}
              helper={`${metric ? t(metric.label) : ''}: ${formatPrimaryValue(result, humanPrimary, (count) =>
                t('{count} units', { count }),
              )}`}
              icon={<FlaskConical size={20} />}
              tone="violet"
            />
            <KpiCard
              label={t('AI-selected')}
              value={t(result.ai.label)}
              helper={`${metric ? t(metric.label) : ''}: ${formatPrimaryValue(result, aiPrimary, (count) =>
                t('{count} units', { count }),
              )}`}
              icon={<Sparkles size={20} />}
              tone="blue"
            />
            <KpiCard
              label={t('Holdout winner')}
              value={
                winner === 'ai'
                  ? t('AI-selected')
                  : winner === 'human'
                    ? t('Human-selected')
                    : winner === 'tie'
                      ? t('Tie')
                      : '—'
              }
              helper={t('{metric} on untouched test data', {
                metric: metric ? t(metric.label) : t('Primary metric'),
              })}
              icon={<Trophy size={20} />}
              tone={winner === 'ai' ? 'green' : winner === 'human' ? 'amber' : 'cyan'}
            />
            <KpiCard
              label={t('Evaluation runtime')}
              value={formatSeconds(result.duration_seconds)}
              helper={result.split.method}
              icon={<Timer size={20} />}
              tone="cyan"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <ChartCard
              className="lg:col-span-7"
              title={
                result.task.includes('forecast')
                  ? t('Holdout predictions')
                  : result.task === 'churn_classification'
                    ? t('ROC curves')
                    : t('Clustering diagnostics')
              }
              subtitle={
                result.task.includes('forecast')
                  ? t('Actual values versus each model on the final test window')
                  : result.task === 'churn_classification'
                    ? t('False-positive rate versus true-positive rate on the holdout')
                    : t('Silhouette and Davies-Bouldin comparison')
              }
            >
              {result.task.includes('forecast') && forecastChart.length > 0 && (
                <BenchmarkForecastChart
                  data={forecastChart as Array<{ week_ending: string; actual: number; human_prediction: number; ai_prediction: number }>}
                  height={310}
                  currency={result.unit === 'currency'}
                />
              )}
              {churnChart?.roc_human && churnChart?.roc_ai && (
                <RocCurve human={churnChart.roc_human} ai={churnChart.roc_ai} height={310} />
              )}
              {clusteringChart?.metric_comparison && (
                <MetricBars data={clusteringChart.metric_comparison} height={310} mode="raw" />
              )}
              {!forecastChart.length && !churnChart?.roc_human && !clusteringChart?.metric_comparison && (
                <EmptyState title={t('Chart data unavailable')} description={t('The comparison table below contains the computed metrics.')} />
              )}
            </ChartCard>

            <Card className="overflow-hidden lg:col-span-5">
              <div className="border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
                <h3 className="section-title">{t('Metric comparison')}</h3>
                <p className="text-[10px] text-slate-400">{t('Computed on identical test rows')}</p>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="data-table">
                  <thead className="sticky top-0">
                    <tr>
                      <th>{t('Criterion')}</th>
                      <th className="text-right">{t('Human')}</th>
                      <th className="text-right">{t('AI')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.comparison_table.map((row) => {
                      const better = betterSide(row.criterion, row.human, row.ai, row.better)
                      return (
                        <tr key={row.criterion}>
                          <td className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            {t(row.criterion)}
                          </td>
                          <td className={cn('text-right font-mono text-[11px]', better === 'human' && 'font-bold text-emerald-600 dark:text-emerald-400')}>
                            {t(formatCriterion(result, row.criterion, row.human))}
                            {better === 'human' && <CheckCircle2 size={11} className="ml-1 inline-block" />}
                          </td>
                          <td className={cn('text-right font-mono text-[11px]', better === 'ai' && 'font-bold text-brand-600 dark:text-brand-300')}>
                            {t(formatCriterion(result, row.criterion, row.ai))}
                            {better === 'ai' && <CheckCircle2 size={11} className="ml-1 inline-block" />}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="p-5 lg:col-span-5">
              <h3 className="section-title">{t('AI selection integrity')}</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">{t('How the AI-selected model was chosen')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <Metric label={t('Test observations')} value={formatNumber(result.split.test_observations)} />
                <Metric label={t('Train observations')} value={formatNumber(result.split.train_observations)} />
                {result.split.test_ratio !== undefined && (
                  <Metric label={t('Test ratio')} value={formatPercent(Number(result.split.test_ratio) * 100)} />
                )}
                {result.ai_validation_metrics && (
                  <Metric
                    label={t('AI validation MAE')}
                    value={
                      result.ai_validation_metrics.validation_mae !== null
                        ? result.unit === 'currency'
                          ? formatCurrency(result.ai_validation_metrics.validation_mae)
                          : formatNumber(result.ai_validation_metrics.validation_mae, 1)
                        : '—'
                    }
                  />
                )}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-slate-400">
                {result.ai_validation_metrics?.method ??
                  t('AI selection uses only training-split validation. The holdout test window is never used for model selection.')}
              </p>
              {result.split.test_start && (
                <p className="mt-2 font-mono text-[10px] text-slate-400">
                  {t('Test')}: {result.split.test_start} → {result.split.test_end}
                </p>
              )}
            </Card>

            <Card className="p-5 lg:col-span-7">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="section-title">{t('Candidate selection')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Validation evidence considered before the holdout')}</p>
                </div>
                <Badge tone="slate">{result.candidates.length}</Badge>
              </div>
              {(result.candidates as Array<Record<string, any>>).length ? (
                <div className="mt-3 space-y-1.5">
                  {(result.candidates as Array<Record<string, any>>).slice(0, 8).map((candidate, index) => {
                    const candidateScore = candidateMetric(result, candidate)
                    return (
                      <div
                        key={`${candidate.model ?? candidate.label ?? index}`}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[10px]',
                          candidate.model === result.ai_model
                            ? 'border-brand-200 bg-brand-50/50 dark:border-brand-500/20 dark:bg-brand-500/[0.06]'
                            : 'border-slate-100 dark:border-white/[0.06]',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                            {t(candidate.label ?? titleCase(candidate.model))}
                          </span>
                          {candidate.model === result.ai_model && <Badge tone="blue" className="px-1.5 py-0 text-[8px]">{t('Selected')}</Badge>}
                        </div>
                        <span className="shrink-0 font-mono text-slate-400">
                          {candidateScore
                            ? `${t(candidateScore.label)}: ${candidateScore.value}`
                            : candidate.status
                              ? t(candidate.status)
                              : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-4 text-xs text-slate-400">{t('Candidate-level validation is not available for this task.')}</p>
              )}
            </Card>
          </div>

          <EvidenceNote>{result.metric_notes.join(' ')}</EvidenceNote>
        </div>
      )}

      {!result && !run.isPending && (
        <Card className="p-6">
          <EmptyState
            icon={<FlaskConical size={24} />}
            title={t('No benchmark selected')}
            description={t(
              'Configure a task and run a benchmark to compare a human-selected model against the AI-selected model on actual holdout data.',
            )}
          />
        </Card>
      )}
    </div>
  )
}
