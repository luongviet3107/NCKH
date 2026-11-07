import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bot,
  BookOpen,
  CheckCircle2,
  Cpu,
  Database,
  Eraser,
  ExternalLink,
  Gauge,
  HardDrive,
  KeyRound,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react'
import { api } from '../lib/api'
import { useTheme } from '../context/theme-context'
import { useI18n } from '../i18n/language-context'
import { cn, formatNumber, titleCase } from '../lib/utils'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  InlineNote,
  PageHeader,
  Progress,
  SkeletonRows,
} from '../components/ui'
import { Metric } from '../components/shared'

const DOCS_URL = import.meta.env.DEV ? 'http://127.0.0.1:8000/docs' : '/docs'

function SettingRow({
  icon,
  label,
  description,
  value,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0 dark:border-white/[0.06]">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-white/[0.06] dark:text-slate-500">
          {icon}
        </div>
        <div>
          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{label}</p>
          {description && <p className="mt-0.5 max-w-md text-[10px] leading-4 text-slate-400">{description}</p>}
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px] font-semibold text-slate-600 dark:text-slate-300">{value}</div>
    </div>
  )
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 60_000,
  })

  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    staleTime: 30_000,
    retry: 1,
  })

  const clearCache = useMutation({
    mutationFn: api.settings.clearCache,
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })

  const refreshing = settings.isFetching || health.isFetching
  const data = settings.data
  const models = data ? Object.entries(data.models.available) : []
  const runtimeReady = health.data?.status === 'ok' || health.data?.status === 'healthy'
  const llmConfigured = Boolean(data?.llm.configured)

  async function refreshAll() {
    await Promise.all([settings.refetch(), health.refetch()])
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('System')}
        title={t('Settings & runtime')}
        description={t(
          'Inspect the live runtime configuration, optional LLM connectivity, analysis limits and safety boundaries. Secrets are never exposed by the API.',
        )}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />}
              onClick={refreshAll}
              disabled={refreshing}
            >
              {t('Refresh')}
            </Button>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" icon={<BookOpen size={14} />}>
                {t('API docs')}
              </Button>
            </a>
          </>
        }
      />

      {settings.isLoading && <Card className="p-5"><SkeletonRows rows={8} /></Card>}
      {settings.isError && (
        <ErrorState
          error={settings.error as Error}
          retry={() => settings.refetch()}
          title={t('Settings unavailable')}
        />
      )}

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">{t('API service')}</p>
                  <h2 className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">{data.app.name}</h2>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {t('Version {version} · {environment}', {
                      version: data.app.version,
                      environment: t(titleCase(data.app.environment)),
                    })}
                  </p>
                </div>
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl',
                    runtimeReady
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                      : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
                  )}
                >
                  <Activity size={19} />
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Badge tone={runtimeReady ? 'green' : 'amber'} dot>
                  {runtimeReady ? t('Operational') : t('Checking connection')}
                </Badge>
                <span className="text-[10px] text-slate-400">{t('FastAPI backend')}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label={t('Datasets')} value={formatNumber(data.database.dataset_count)} />
                <Metric label={t('Database')} value={data.database.backend} />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">{t('Narrative engine')}</p>
                  <h2 className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">{t('Optional LLM')}</h2>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {t('Deterministic analytics never depend on an LLM.')}
                  </p>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <Sparkles size={19} />
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone={llmConfigured ? 'green' : 'slate'} dot>
                  {llmConfigured ? t('Configured') : t('Not configured')}
                </Badge>
                {data.llm.provider && <Badge tone="blue">{data.llm.provider}</Badge>}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-slate-400">
                {data.llm.model ? `${t('Model')}: ${data.llm.model}. ` : ''}
                {data.llm.message}
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">{t('Guardrails')}</p>
                  <h2 className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">{t('Execution safety')}</h2>
                  <p className="mt-1 text-[10px] text-slate-400">{t('Vetted analysis services only')}</p>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <ShieldCheck size={19} />
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="green">{t('No arbitrary code')}</Badge>
                <Badge tone="slate">{t(titleCase(data.sandbox.mode))}</Badge>
              </div>
              <p className="mt-3 text-[10px] leading-4 text-slate-400">{data.sandbox.description}</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="section-title flex items-center gap-2">
                <Gauge size={15} /> {t('Runtime limits')}
              </h3>
              <p className="mt-1 text-[10px] text-slate-400">{t('Server-enforced constraints for uploads and agents.')}</p>
              <div className="mt-2">
                <SettingRow
                  icon={<HardDrive size={13} />}
                  label={t('Maximum upload size')}
                  description={t('Checked before parsing any uploaded data file.')}
                  value={`${data.limits.max_upload_mb} MB`}
                />
                <SettingRow
                  icon={<Bot size={13} />}
                  label={t('Agent runtime budget')}
                  description={t('Upper bound for a single multi-agent run.')}
                  value={`${data.limits.max_agent_runtime_seconds}s`}
                />
                <SettingRow
                  icon={<KeyRound size={13} />}
                  label={t('API key protection')}
                  description={t('Optional X-API-Key enforcement for API access.')}
                  value={
                    data.limits.api_key_enabled ? (
                      <Badge tone="green">{t('Enabled')}</Badge>
                    ) : (
                      <Badge tone="slate">{t('Disabled')}</Badge>
                    )
                  }
                />
                <SettingRow
                  icon={<Database size={13} />}
                  label={t('Database backend')}
                  description={
                    data.database.configured
                      ? t('Configured external database.')
                      : t('Local SQLite store for metadata and saved artifacts.')
                  }
                  value={data.database.backend}
                />
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="section-title flex items-center gap-2">
                <Cpu size={15} /> {t('Model engines')}
              </h3>
              <p className="mt-1 text-[10px] text-slate-400">
                {t('Availability is checked from installed packages at request time.')}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'XGBoost', available: data.models.xgboost },
                  { label: 'LangGraph', available: data.models.langgraph },
                  { label: 'Prophet', available: data.models.prophet },
                ].map((engine) => (
                  <div
                    key={engine.label}
                    className={cn(
                      'rounded-xl border p-2.5 text-center',
                      engine.available
                        ? 'border-emerald-100 bg-emerald-50/60 dark:border-emerald-500/15 dark:bg-emerald-500/[0.05]'
                        : 'border-slate-100 bg-slate-50/60 dark:border-white/[0.06] dark:bg-white/[0.02]',
                    )}
                  >
                    <CheckCircle2
                      size={15}
                      className={cn(
                        'mx-auto',
                        engine.available ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600',
                      )}
                    />
                    <p className="mt-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">{engine.label}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">{engine.available ? t('Available') : t('Optional')}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <p className="label">{t('Registered forecasting models')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {models.map(([key, label]) => (
                    <span
                      key={key}
                      className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              {data.langsmith.configured && (
                <div className="mt-4 rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{t('LangSmith tracing')}</span>
                    <Badge tone={data.langsmith.tracing_enabled ? 'green' : 'amber'}>
                      {data.langsmith.tracing_enabled ? t('Enabled') : t('Configured, off')}
                    </Badge>
                  </div>
                  {data.langsmith.project && (
                    <p className="mt-1 font-mono text-[9px] text-slate-400">{t('Project')}: {data.langsmith.project}</p>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="section-title flex items-center gap-2">
                <Sun size={15} /> {t('Appearance')}
              </h3>
              <p className="mt-1 text-[10px] text-slate-400">
                {t('Stored locally in this browser. Follows your system preference by default.')}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition',
                    theme === 'light'
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                      : 'border-slate-100 hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.04]',
                  )}
                >
                  <Sun size={17} />
                  <div>
                    <p className="text-[11px] font-bold">{t('Light')}</p>
                    <p className="text-[9px] text-slate-400">{t('Bright workspace')}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition',
                    theme === 'dark'
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                      : 'border-slate-100 hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.04]',
                  )}
                >
                  <Moon size={17} />
                  <div>
                    <p className="text-[11px] font-bold">{t('Dark')}</p>
                    <p className="text-[9px] text-slate-400">{t('Low-light workspace')}</p>
                  </div>
                </button>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="section-title flex items-center gap-2">
                <Eraser size={15} /> {t('Maintenance')}
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                {t(
                  'Analysis responses are cached in memory per dataset. Clearing the cache forces the next request to recompute results from stored data.',
                )}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={clearCache.isPending}
                  onClick={() => clearCache.mutate()}
                  icon={<Eraser size={14} />}
                >
                  {t('Clear analysis cache')}
                </Button>
                <Link to="/data">
                  <Button variant="ghost" size="sm" icon={<Database size={14} />}>
                    {t('Manage datasets')}
                  </Button>
                </Link>
              </div>
              {clearCache.isSuccess && (
                <div className="mt-3">
                  <InlineNote tone="success">{t('Analysis caches cleared. The next analysis will recompute.')}</InlineNote>
                </div>
              )}
              {clearCache.isError && (
                <div className="mt-3">
                  <InlineNote tone="danger">{(clearCache.error as Error).message}</InlineNote>
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h3 className="section-title">{t('Documentation & diagnostics')}</h3>
                <p className="mt-1 max-w-2xl text-[10px] leading-4 text-slate-400">
                  {t(
                    'The interactive OpenAPI page documents every endpoint, request schema and response envelope. Health checks confirm the backend is reachable; this settings payload contains no API keys or secrets.',
                  )}
                </p>
              </div>
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />}>
                  {t('Open API documentation')}
                </Button>
              </a>
            </div>
            <div className="mt-4 h-px bg-slate-100 dark:bg-white/[0.06]" />
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Activity size={12} /> {t('Health API: {status}', { status: runtimeReady ? t('reachable') : t('unavailable') })}
              </span>
              <span className="flex items-center gap-1.5">
                <Database size={12} /> {t('{count} datasets registered', { count: formatNumber(data.database.dataset_count) })}
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={12} /> {t('Secrets are never returned by this endpoint')}
              </span>
            </div>
          </Card>
        </>
      )}

      {!settings.isLoading && !data && (
        <Card className="p-5">
          <Progress value={0} />
          <p className="mt-2 text-[11px] text-slate-400">
            {t('Runtime configuration is unavailable. Verify the backend is running on port 8000.')}
          </p>
        </Card>
      )}
    </div>
  )
}
