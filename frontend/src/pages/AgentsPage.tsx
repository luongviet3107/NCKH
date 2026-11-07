import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
  Zap,
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
  priorityTone,
  shortDate,
  statusTone,
} from '../lib/utils'
import type { AgentRun } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
} from '../components/ui'
import { DemoNotice, Metric } from '../components/shared'

const DEFAULT_OBJECTIVE = 'Identify the highest-impact business decisions from this dataset.'

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 size={16} className="text-emerald-500" />
  if (status === 'running') return <Loader2 size={16} className="animate-spin text-brand-500" />
  if (status === 'failed') return <XCircle size={16} className="text-rose-500" />
  return <Clock3 size={16} className="text-slate-400" />
}

function RunResult({ run }: { run: AgentRun }) {
  const { t } = useI18n()
  const result = (run.result ?? {}) as Record<string, any>
  const decisions = (result.decisions ?? []) as Array<Record<string, any>>
  const revenue = result.revenue ?? {}
  const forecast = revenue.forecast?.summary ?? {}
  const product = result.product_forecast?.summary ?? {}
  const inventory = result.inventory?.summary ?? {}
  const customers = result.customers ?? {}
  const audit = result.data_audit ?? {}
  const churn = customers.churn ?? {}
  const segmentation = customers.segmentation ?? {}
  const highRisk = (churn.risk_distribution ?? []).find((row: any) => row.risk === 'High Risk')?.count ?? 0

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/80 to-cyan-50/50 p-4 dark:border-brand-500/15 dark:from-brand-500/[0.07] dark:to-cyan-500/[0.04]">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-brand-600 dark:text-brand-300" />
          <p className="text-xs font-extrabold text-brand-800 dark:text-brand-200">{t('Executive synthesis')}</p>
          {run.llm_used && <Badge tone="blue">{t('LLM narrative')}</Badge>}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {result.executive_summary ?? t('No executive summary was produced.')}
        </p>
        {result.llm_narrative && result.llm_narrative !== result.executive_summary && (
          <p className="mt-2 border-t border-brand-200/50 pt-2 text-xs leading-5 text-slate-500 dark:border-brand-500/20 dark:text-slate-400">
            {result.llm_narrative}
          </p>
        )}
        <p className="mt-2 text-[10px] leading-4 text-slate-400">{result.decision_basis}</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label={t('Data quality')} value={audit.quality_score !== undefined ? `${audit.quality_score}/100` : '—'} />
        <Metric label={t('Revenue')} value={formatCurrency(revenue.kpis?.total_revenue)} />
        <Metric
          label={t('Revenue growth')}
          value={
            revenue.kpis?.growth_pct !== null && revenue.kpis?.growth_pct !== undefined
              ? formatPercent(revenue.kpis.growth_pct, true)
              : '—'
          }
        />
        <Metric label={t('30d forecast')} value={formatCurrency(forecast.forecast_30d)} />
        <Metric label={t('Forecasted products')} value={formatNumber(product.forecasted_products)} />
        <Metric label={t('High-risk customers')} value={formatNumber(highRisk)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-3.5 dark:border-white/[0.06]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('Inventory signal')}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
            {result.inventory?.available && inventory
              ? t(
                  '{critical} critical/low-stock products and {dead} dead-stock products; health score {score}/100.',
                  {
                    critical: formatNumber(inventory.critical_low_count),
                    dead: formatNumber(inventory.dead_stock_count),
                    score: inventory.health_score,
                  },
                )
              : result.inventory?.reason ?? t('Inventory analysis was not selected or is unavailable.')}
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 p-3.5 dark:border-white/[0.06]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('Customer signal')}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
            {segmentation.available
              ? `${t('{customers} customers segmented into {groups} groups', {
                  customers: formatNumber(segmentation.metrics?.customers),
                  groups: formatNumber(segmentation.clusters?.length),
                })}${
                  churn.available
                    ? t('; churn ROC-AUC {value}.', { value: churn.metrics?.roc_auc ?? t('N/A') })
                    : '.'
                }`
              : churn.reason ?? segmentation.reason ?? t('Customer analysis was not selected or is unavailable.')}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t('Decision recommendations')}</h4>
          <Badge tone="blue">{decisions.length}</Badge>
        </div>
        <div className="space-y-2.5">
          {decisions.map((decision, index) => (
            <div
              key={`${decision.title}-${index}`}
              className="rounded-xl border border-slate-100 bg-white/50 p-3.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={priorityTone(String(decision.priority ?? 'medium'))} className="uppercase">
                  {t(decision.priority ?? 'medium')}
                </Badge>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {t(decision.area)} · {t(decision.source)}
                </span>
              </div>
              <p className="mt-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">{decision.title}</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{decision.action}</p>
              {Array.isArray(decision.evidence) && decision.evidence.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {decision.evidence.slice(0, 3).map((evidence: string, evidenceIndex: number) => (
                    <li key={evidenceIndex} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-400">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                      {evidence}
                    </li>
                  ))}
                </ul>
              )}
              {decision.expected_impact && (
                <p className="mt-1.5 text-[10px] font-medium leading-4 text-cyan-700 dark:text-cyan-300">
                  {decision.expected_impact}
                </p>
              )}
            </div>
          ))}
          {!decisions.length && <EmptyState title={t('No decision recommendation')} />}
        </div>
      </div>
    </div>
  )
}

export function AgentsPage() {
  const { activeDatasetId } = useDataset()
  return <AgentsPageContent key={activeDatasetId ?? 'no-dataset'} />
}

function AgentsPageContent() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [objective, setObjective] = useState(() => t(DEFAULT_OBJECTIVE))
  const [mode, setMode] = useState<'auto' | 'hitl'>('hitl')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [taskSelection, setTaskSelection] = useState<{ key: string; ids: string[] } | null>(null)
  const [notesOverride, setNotesOverride] = useState<{ key: string; value: string } | null>(null)

  const runs = useQuery({
    queryKey: ['agent-runs', activeDatasetId],
    queryFn: () => api.agents.list(activeDatasetId ?? undefined, 30),
    enabled: Boolean(activeDatasetId),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === 'running') ? 2500 : false,
  })

  const runItems = runs.data?.items ?? []
  const activeRunId = selectedRunId ?? runItems[0]?.id ?? null

  const detail = useQuery({
    queryKey: ['agent-run', activeRunId],
    queryFn: () => api.agents.get(activeRunId as string),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  })

  const run = detail.data
  const proposedTasks = run?.proposal?.proposed_tasks ?? []
  const taskKey = `${run?.id ?? 'none'}:${proposedTasks
    .map((task) => `${task.id}:${task.available}:${task.selected}`)
    .join('|')}`
  const defaultSelectedTasks = proposedTasks
    .filter((task) => task.available && task.selected)
    .map((task) => task.id)
  const selectedTasks = taskSelection?.key === taskKey ? taskSelection.ids : defaultSelectedTasks
  const notesKey = `${run?.id ?? 'none'}:${run?.status ?? 'none'}`
  const notes = notesOverride?.key === notesKey ? notesOverride.value : run?.notes ?? ''

  const startRun = useMutation({
    mutationFn: () =>
      api.agents.start({
        dataset_id: activeDatasetId as string,
        mode,
        objective: objective.trim() || t(DEFAULT_OBJECTIVE),
      }),
    onSuccess: async (run) => {
      setSelectedRunId(run.id)
      await queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
    },
  })

  const approve = useMutation({
    mutationFn: () =>
      api.agents.approve({
        run_id: activeRunId as string,
        approved: true,
        selected_tasks: selectedTasks,
        notes,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
      await queryClient.invalidateQueries({ queryKey: ['agent-run', activeRunId] })
    },
  })

  const reject = useMutation({
    mutationFn: () =>
      api.agents.reject({ run_id: activeRunId as string, notes }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
      await queryClient.invalidateQueries({ queryKey: ['agent-run', activeRunId] })
    },
  })

  const cancel = useMutation({
    mutationFn: () => api.agents.cancel(activeRunId as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-runs'] })
      await queryClient.invalidateQueries({ queryKey: ['agent-run', activeRunId] })
    },
  })

  const awaiting = run?.status === 'awaiting_approval'
  const actionError = (startRun.error ?? approve.error ?? reject.error ?? cancel.error) as Error | null

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('AI Agent Center')}
        title={t('Multi-agent decision workflow')}
        description={t(
          'Six specialist agents run grounded analyses through a LangGraph workflow. Choose full autonomy or require a human checkpoint before any analysis task starts.',
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={runs.isFetching ? 'animate-spin' : ''} />}
            onClick={() => runs.refetch()}
            disabled={runs.isFetching}
          >
            {t('Refresh runs')}
          </Button>
        }
      >
        <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-4">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                <Bot size={18} />
              </div>
              <div>
                <h3 className="section-title">{t('Launch analysis')}</h3>
                <p className="text-[10px] text-slate-400">{t('Uses the active dataset only')}</p>
              </div>
            </div>
            <label className="label mt-4">{t('Objective')}</label>
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              rows={3}
              maxLength={2000}
              className="input h-auto min-h-[84px] resize-none py-2.5 leading-5"
              placeholder={t('What decision should the agents support?')}
            />
            <span className="label mt-3">{t('Execution mode')}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('auto')}
                className={cn(
                  'rounded-xl border p-3 text-left transition',
                  mode === 'auto'
                    ? 'border-brand-300 bg-brand-50/70 ring-2 ring-brand-500/15 dark:border-brand-500/30 dark:bg-brand-500/[0.08]'
                    : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
                )}
              >
                <div className="flex items-center gap-2">
                  <Zap size={15} className="text-brand-500" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{t('Autonomous')}</span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">{t('Run all available analyses immediately.')}</p>
              </button>
              <button
                type="button"
                onClick={() => setMode('hitl')}
                className={cn(
                  'rounded-xl border p-3 text-left transition',
                  mode === 'hitl'
                    ? 'border-brand-300 bg-brand-50/70 ring-2 ring-brand-500/15 dark:border-brand-500/30 dark:bg-brand-500/[0.08]'
                    : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
                )}
              >
                <div className="flex items-center gap-2">
                  <UserCheck size={15} className="text-emerald-500" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{t('Human checkpoint')}</span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">{t('Approve the task plan before execution.')}</p>
              </button>
            </div>
            <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-400 dark:bg-white/[0.03]">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />
              {t('Agents call vetted analytics services. Source data and business records are never modified.')}
            </div>
            <Button
              className="mt-3 w-full"
              loading={startRun.isPending}
              disabled={!activeDatasetId}
              onClick={() => startRun.mutate()}
              icon={<Play size={14} />}
            >
              {t('Start agent run')}
            </Button>
            {startRun.isError && (
              <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
                {(startRun.error as Error).message}
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('Run history')}</h3>
              <Badge tone="slate">{runs.data?.total ?? 0}</Badge>
            </div>
            {runs.isLoading && <div className="p-4"><SkeletonRows rows={3} /></div>}
            {runs.isError && (
              <div className="p-4">
                <ErrorState error={runs.error as Error} retry={() => runs.refetch()} title={t('Run history unavailable')} />
              </div>
            )}
            <div className="max-h-[500px] overflow-y-auto p-2">
              {runItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedRunId(item.id)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition',
                    activeRunId === item.id
                      ? 'border-brand-200 bg-brand-50/70 dark:border-brand-500/25 dark:bg-brand-500/[0.08]'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/[0.04]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={statusTone(item.status)} dot>{t(item.status.replace(/_/g, ' '))}</Badge>
                    <span className="text-[9px] text-slate-400">{shortDate(item.created_at)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-4 text-slate-700 dark:text-slate-200">
                    {item.objective}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400">
                    <span>{item.mode === 'auto' ? t('Autonomous') : t('Human checkpoint')}</span>
                    {item.duration_seconds !== null && <span>· {formatSeconds(item.duration_seconds)}</span>}
                    {item.llm_used && <span>· {t('LLM narrative')}</span>}
                  </div>
                </button>
              ))}
              {runs.data && !runs.data.items.length && (
                <p className="px-3 py-8 text-center text-[11px] text-slate-400">
                  {t('No agent run yet. Launch the first analysis above.')}
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-8">
          {actionError && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {actionError.message}
            </div>
          )}

          {!activeRunId && (
            <Card className="flex min-h-[420px] items-center justify-center p-6">
              <EmptyState
                icon={<Bot size={24} />}
                title={t('Select or launch an agent run')}
                description={t(
                  'A run will show its task plan, human checkpoint, live agent steps and grounded decision output here.',
                )}
              />
            </Card>
          )}

          {activeRunId && detail.isLoading && (
            <Card className="p-5"><SkeletonRows rows={8} /></Card>
          )}
          {activeRunId && detail.isError && (
            <ErrorState
              error={detail.error as Error}
              retry={() => detail.refetch()}
              title={t('Agent run unavailable')}
            />
          )}

          {run && (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(run.status)} dot>{t(run.status.replace(/_/g, ' '))}</Badge>
                      <Badge tone="slate">{run.mode === 'auto' ? t('Autonomous') : t('Human checkpoint')}</Badge>
                      {run.llm_used && <Badge tone="blue">{t('LLM narrative')}</Badge>}
                    </div>
                    <h3 className="mt-2 text-base font-extrabold leading-6 text-slate-950 dark:text-white">
                      {run.objective}
                    </h3>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {shortDate(run.created_at)} ·{' '}
                      {t('{count} analysis tasks', { count: run.selected_tasks.length })} ·{' '}
                      {run.duration_seconds !== null ? formatSeconds(run.duration_seconds) : t('in progress')}
                    </p>
                  </div>
                  {(run.status === 'running' || run.status === 'awaiting_approval') && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={cancel.isPending}
                      onClick={() => cancel.mutate()}
                    >
                      {t('Cancel run')}
                    </Button>
                  )}
                </div>

                {run.error && (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[11px] text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                    {run.error}
                  </div>
                )}

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {run.steps.map((step, index) => (
                    <div
                      key={step.key}
                      className={cn(
                        'rounded-xl border px-3 py-2.5',
                        step.status === 'running'
                          ? 'border-brand-200 bg-brand-50/50 dark:border-brand-500/20 dark:bg-brand-500/[0.05]'
                          : 'border-slate-100 dark:border-white/[0.06]',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <StepIcon status={step.status} />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t('Step {number}', { number: index + 1 })}
                        </span>
                        <span className="ml-auto text-[9px] text-slate-400">{t(step.status)}</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-100">{t(step.label)}</p>
                      {step.summary && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-400">{step.summary}</p>
                      )}
                      {step.error && (
                        <p className="mt-0.5 text-[10px] leading-4 text-rose-500">{step.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>

              {awaiting && (
                <Card className="border-amber-200 p-5 dark:border-amber-500/20">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                      <ListChecks size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                        {t('Human approval checkpoint')}
                      </h3>
                      <p className="mt-0.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                        {run.proposal?.human_checkpoint ??
                          t('Review the proposed analysis tasks. No source data or business records are modified.')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {proposedTasks.map((task) => (
                      <label
                        key={task.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                          task.available
                            ? 'border-slate-100 hover:border-slate-200 dark:border-white/[0.06] dark:hover:border-white/10'
                            : 'cursor-not-allowed border-slate-100 opacity-50 dark:border-white/[0.04]',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTasks.includes(task.id)}
                          disabled={!task.available}
                          onChange={(event) => {
                            const checked = event.target.checked
                            setTaskSelection({
                              key: taskKey,
                              ids: checked
                                ? [...selectedTasks, task.id]
                                : selectedTasks.filter((id) => id !== task.id),
                            })
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600"
                        />
                        <span>
                          <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">
                            {t(task.label)}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{t(task.description)}</span>
                          {!task.available && (
                            <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-300">
                              {task.reason ? t(task.reason) : ''}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="label mt-3">{t('Approval notes (optional)')}</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotesOverride({ key: notesKey, value: event.target.value })}
                    rows={2}
                    className="input h-auto resize-none py-2 text-xs"
                    placeholder={t('Add context for the agents…')}
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={reject.isPending}
                      onClick={() => reject.mutate()}
                    >
                      {t('Reject plan')}
                    </Button>
                    <Button
                      size="sm"
                      loading={approve.isPending}
                      disabled={!selectedTasks.length}
                      onClick={() => approve.mutate()}
                      icon={<CheckCircle2 size={14} />}
                    >
                      {t('Approve {count} tasks', { count: selectedTasks.length })}
                    </Button>
                  </div>
                  {!selectedTasks.length && (
                    <p className="mt-1 text-right text-[10px] text-rose-500">{t('Select at least one supported task.')}</p>
                  )}
                </Card>
              )}

              {run.status === 'running' && (
                <Card className="flex items-center gap-3 p-5">
                  <Loader2 size={20} className="animate-spin text-brand-500" />
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{t('Agents are analyzing the dataset')}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {t('This page refreshes automatically until the run completes.')}
                    </p>
                  </div>
                </Card>
              )}

              {run.status === 'completed' && <RunResult run={run} />}

              {['rejected', 'cancelled', 'failed'].includes(run.status) && (
                <Card className="p-5">
                  <EmptyState
                    icon={<XCircle size={22} />}
                    title={t('Run {status}', { status: t(run.status) })}
                    description={
                      run.error ??
                      (run.status === 'rejected'
                        ? t('The proposed plan was rejected. No analysis tasks were executed.')
                        : run.status === 'cancelled'
                          ? t('The run was cancelled before completion.')
                          : t('The workflow failed. Review the step errors above.'))
                    }
                  />
                </Card>
              )}

              {run.proposal && run.status === 'awaiting_approval' && run.proposal.data_quality_findings && (
                <Card className="p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('Pre-flight data findings')}
                  </p>
                  <div className="mt-2 space-y-1">
                    {run.proposal.data_quality_findings.map((finding, index) => (
                      <p key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                        {finding}
                      </p>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
