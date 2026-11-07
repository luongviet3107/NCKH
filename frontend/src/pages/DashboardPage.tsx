import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import { api } from '../lib/api'
import { useDataset } from '../context/dataset-context'
import { useI18n } from '../i18n/language-context'
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  longDate,
  priorityTone,
  riskTone,
} from '../lib/utils'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  Progress,
  SkeletonCard,
  Tabs,
} from '../components/ui'
import { ChartCard, DemoNotice, EvidenceNote, InsightList } from '../components/shared'
import {
  DonutChart,
  ForecastChart,
  HorizontalBarChart,
  RevenueTrendChart,
} from '../components/charts'
import { CHART_COLORS } from '../lib/chart-colors'

type PeriodKey = '30d' | '90d' | '180d' | '365d' | 'all'

const PERIODS: Array<{ value: PeriodKey; label: string; days: number | null }> = [
  { value: '30d', label: '30D', days: 30 },
  { value: '90d', label: '90D', days: 90 },
  { value: '180d', label: '180D', days: 180 },
  { value: '365d', label: '1Y', days: 365 },
  { value: 'all', label: 'All time', days: null },
]

function daysBefore(dateValue: string | null, days: number | null) {
  if (!dateValue || days === null) return undefined
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export function DashboardPage() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const [period, setPeriod] = useState<PeriodKey>('180d')
  const selected = PERIODS.find((item) => item.value === period)
  const startDate = daysBefore(dataset?.date_max ?? null, selected?.days ?? null)

  const query = useQuery({
    queryKey: ['dashboard', activeDatasetId, startDate ?? 'all'],
    queryFn: () => api.dashboard.overview(activeDatasetId as string, startDate),
    enabled: Boolean(activeDatasetId),
    staleTime: 60_000,
  })

  const data = query.data

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Decision intelligence')}
        title={t('Business overview')}
        description={t(
          'A live, evidence-based view of revenue, demand, inventory and customers. Every number below is computed from the active dataset.',
        )}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />}
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              {t('Refresh')}
            </Button>
            <Link to="/reports">
              <Button size="sm" icon={<ArrowRight size={14} />}>{t('View reports')}</Button>
            </Link>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              tabs={PERIODS.map((item) => ({ value: item.value, label: t(item.label) }))}
              value={period}
              onChange={setPeriod}
            />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              <CalendarDays size={13} />
              {data ? `${longDate(data.period.start)} — ${longDate(data.period.end)}` : t('Selected analysis period')}
            </span>
          </div>
          {dataset && (
            <span className="text-[11px] text-slate-400">
              {t('Data through')} <strong className="text-slate-600 dark:text-slate-300">{longDate(dataset.date_max)}</strong>
            </span>
          )}
        </div>
        <div className="mt-3">
          <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
        </div>
      </PageHeader>

      {query.isLoading && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="skeleton h-[360px] lg:col-span-2" />
            <div className="skeleton h-[360px]" />
          </div>
        </div>
      )}

      {query.isError && (
        <ErrorState error={query.error as Error} retry={() => query.refetch()} title={t('Dashboard unavailable')} />
      )}

      {data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t('Analyzed revenue')}
              value={formatCurrency(data.kpis.total_revenue)}
              helper={t(data.kpis.growth_basis)}
              trend={data.kpis.revenue_growth_pct}
              icon={<CircleDollarSign size={20} />}
              tone="blue"
            />
            <KpiCard
              label={t('Orders')}
              value={formatNumber(data.kpis.total_orders)}
              helper={data.kpis.revenue_derived ? t('Revenue derived from quantity × price') : t('From mapped order records')}
              icon={<ShoppingCart size={20} />}
              tone="cyan"
            />
            <KpiCard
              label={t('Customers')}
              value={formatNumber(data.kpis.total_customers)}
              helper={t('Distinct customers in selected period')}
              icon={<UsersRound size={20} />}
              tone="violet"
            />
            <KpiCard
              label={t('Average order value')}
              value={formatCurrency(data.kpis.average_order_value, true)}
              helper={
                data.kpis.gross_margin_pct !== null
                  ? t('Gross margin {value}', { value: formatPercent(data.kpis.gross_margin_pct) })
                  : data.kpis.profit_available
                    ? t('Cost data available')
                    : t('Cost data not available')
              }
              trend={data.kpis.period_growth_pct}
              icon={<ReceiptText size={20} />}
              tone="green"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              className="lg:col-span-2"
              title={t('Revenue momentum')}
              subtitle={t('{granularity} revenue for the selected period', {
                granularity: data.period.granularity === 'month' ? t('Monthly') : t(data.period.granularity),
              })}
              actions={<Badge tone="blue">{t('{days} days', { days: data.period.days })}</Badge>}
            >
              {data.charts.revenue_trend.length ? (
                <RevenueTrendChart data={data.charts.revenue_trend} />
              ) : (
                <EmptyState title={t('No revenue trend')} description={t('The selected period has no revenue points.')} />
              )}
            </ChartCard>

            <Card className="relative overflow-hidden bg-gradient-to-br from-[#12265c] via-[#122251] to-[#0a1838] p-5 text-white">
              <div className="pointer-events-none absolute -right-16 -top-20 h-60 w-60 rounded-full bg-brand-500/25 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-200">
                    <TrendingUp size={14} />
                    {t('Revenue forecast')}
                  </div>
                  <Badge tone="blue" className="border-white/10 bg-white/10 text-[9px] text-cyan-100">
                    {t(data.forecast.summary.trend)}
                  </Badge>
                </div>
                <p className="mt-5 text-[11px] font-medium text-slate-300">{t('Next 30 days')}</p>
                <p className="mt-1 text-3xl font-extrabold tracking-tight">
                  {formatCurrency(data.forecast.summary.forecast_30d)}
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  {data.forecast.summary.growth_30_pct !== null ? (
                    <span className={data.forecast.summary.growth_30_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                      {formatPercent(data.forecast.summary.growth_30_pct, true)}
                    </span>
                  ) : (
                    t('No growth baseline')
                  )}{' '}
                  {t('versus recent 30 days')}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('7 days')}</p>
                    <p className="mt-1 text-sm font-bold">{formatCurrency(data.forecast.summary.forecast_7d)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('90 days')}</p>
                    <p className="mt-1 text-sm font-bold">{formatCurrency(data.forecast.summary.forecast_90d)}</p>
                  </div>
                </div>
                <div className="mt-auto space-y-1.5 pt-5 text-[10px] text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>{t('Model')}</span>
                    <span className="font-mono text-slate-200">{data.forecast.summary.model_label}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('Validation MAPE')}</span>
                    <span className="font-mono text-slate-200">
                      {data.forecast.summary.metrics.mape !== null
                        ? formatPercent(data.forecast.summary.metrics.mape)
                        : t('Unavailable')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('Validation quality')}</span>
                    <span className="font-semibold text-cyan-200">{t(data.forecast.summary.validation_quality)}</span>
                  </div>
                </div>
                <Link
                  to="/revenue"
                  className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-cyan-200 hover:text-white"
                >
                  {t('Open revenue forecast')} <ArrowRight size={12} />
                </Link>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <ChartCard
              className="lg:col-span-7"
              title={t('Actual vs forecast')}
              subtitle={t("Actual history followed by the deployed model's forward path")}
            >
              {data.charts.actual_vs_forecast.length ? (
                <ForecastChart data={data.charts.actual_vs_forecast} height={286} />
              ) : (
                <EmptyState title={t('Forecast path unavailable')} />
              )}
            </ChartCard>

            <Card className="p-5 lg:col-span-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="section-title">{t('Priority actions')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Ranked from the computed signals below')}</p>
                </div>
                <Badge tone="slate">{data.priority_actions.length}</Badge>
              </div>
              <div className="mt-4 space-y-2.5">
                {data.priority_actions.map((action, index) => (
                  <div
                    key={`${action.area}-${index}`}
                    className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-white/[0.06] dark:bg-white/[0.025]"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={priorityTone(action.priority)} className="px-1.5 py-0.5 text-[9px] uppercase">
                        {t(action.priority)}
                      </Badge>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {t(action.area)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs font-bold leading-5 text-slate-800 dark:text-slate-100">
                      {action.action}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{action.reason}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <ChartCard
              className="lg:col-span-5"
              title={t('Top products by units')}
              subtitle={t('Highest unit volume in the selected period')}
            >
              {data.charts.top_products.length ? (
                <HorizontalBarChart
                  data={data.charts.top_products}
                  categoryKey="product"
                  valueKey="units"
                  height={286}
                />
              ) : (
                <EmptyState title={t('No product revenue')} />
              )}
            </ChartCard>

            <ChartCard className="lg:col-span-4" title={t('Revenue by category')} subtitle={t('Share of period revenue')}>
              {data.charts.category_revenue.length ? (
                <DonutChart
                  data={data.charts.category_revenue}
                  nameKey="category"
                  valueKey="revenue"
                  currency
                  height={286}
                  colors={CHART_COLORS}
                  centerLabel={{
                    label: t('Categories'),
                    value: String(data.charts.category_revenue.length),
                  }}
                />
              ) : (
                <EmptyState title={t('No category data')} />
              )}
            </ChartCard>

            <Card className="p-5 lg:col-span-3">
              <div className="flex items-center justify-between">
                <h3 className="section-title">{t('Inventory health')}</h3>
                {data.inventory.summary && (
                  <Badge tone={data.inventory.summary.health_score >= 70 ? 'green' : 'amber'}>
                    {data.inventory.summary.health_score}/100
                  </Badge>
                )}
              </div>
              {data.inventory.summary ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                      <span>{t('Health score')}</span>
                      <span>{data.inventory.summary.health_score}/100</span>
                    </div>
                    <Progress
                      value={data.inventory.summary.health_score}
                      indicatorClassName={
                        data.inventory.summary.health_score >= 70 ? 'bg-emerald-500' : 'bg-amber-500'
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.03]">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('Critical / low')}</p>
                      <p className="mt-1 text-lg font-extrabold text-rose-600 dark:text-rose-400">
                        {data.inventory.summary.critical_low_count}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.03]">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{t('Dead stock')}</p>
                      <p className="mt-1 text-lg font-extrabold text-amber-600 dark:text-amber-400">
                        {data.inventory.summary.dead_stock_count}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-400">
                      <span>{t('Inventory value')}</span>
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {formatCurrency(data.inventory.summary.total_inventory_value)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>{t('Dead stock value')}</span>
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {formatCurrency(data.inventory.summary.dead_stock_value)}
                      </span>
                    </div>
                  </div>
                  <Link
                    to="/inventory"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700 dark:text-brand-300"
                  >
                    {t('Review stock actions')} <ArrowRight size={12} />
                  </Link>
                </div>
              ) : (
                <div className="mt-4">
                  <EmptyState
                    icon={<Sparkles size={18} />}
                    title={t('Inventory unavailable')}
                    description={data.inventory.reason ?? t('Current stock columns were not detected.')}
                  />
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="p-5 lg:col-span-7">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="section-title">{t('What the data is saying')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Evidence-linked observations from the analysis')}</p>
                </div>
                <Badge tone="blue">{t('{count} insights', { count: data.insights.length })}</Badge>
              </div>
              <InsightList insights={data.insights} compact />
            </Card>

            <Card className="p-5 lg:col-span-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="section-title">{t('Inventory watchlist')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Highest-priority stock positions')}</p>
                </div>
                <Link
                  to="/inventory"
                  className="text-[10px] font-bold text-brand-600 hover:text-brand-700 dark:text-brand-300"
                >
                  {t('View all')}
                </Link>
              </div>
              {data.inventory.top_risks.length ? (
                <div className="space-y-2">
                  {data.inventory.top_risks.slice(0, 4).map((item) => (
                    <div
                      key={item.product}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/[0.06]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{item.product}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {t('{count} units', { count: formatNumber(item.stock) })} ·{' '}
                          {item.coverage_days !== null
                            ? t('{days} days cover', { days: formatNumber(item.coverage_days, 1) })
                            : t('cover unavailable')}
                        </p>
                      </div>
                      <Badge tone={riskTone(item.status)}>{t(item.status)}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title={t('No priority stock risks')} description={t('No critical, low or dead-stock position was detected.')} />
              )}
            </Card>
          </div>

          <EvidenceNote>
            {data.data_context.notes.join(' ')}{' '}
            {t(
              'Forecasts use chronological holdout validation. KPI trends follow the selected period; current inventory is a point-in-time snapshot.',
            )}{' '}
            {t('Inventory value basis')}: {data.data_context.inventory_point_in_time}
          </EvidenceNote>
        </div>
      )}
    </div>
  )
}
