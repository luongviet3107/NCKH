import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarRange,
  CircleDollarSign,
  Percent,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Target,
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
  Progress,
  SkeletonRows,
  Tabs,
} from '../components/ui'
import { ChartCard, DemoNotice, EvidenceNote, InsightList, Metric } from '../components/shared'
import {
  ComparisonBarChart,
  DonutChart,
  ForecastChart,
  RevenueTrendChart,
  ValidationChart,
} from '../components/charts'

type Granularity = 'day' | 'week' | 'month'

export function RevenuePage() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [granularity, setGranularity] = useState<Granularity>('month')

  const invalidRange = Boolean(startDate && endDate && startDate > endDate)

  const analysis = useQuery({
    queryKey: ['revenue', activeDatasetId, startDate, endDate, granularity],
    queryFn: () =>
      api.revenue.analyze(activeDatasetId as string, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        granularity,
      }),
    enabled: Boolean(activeDatasetId) && !invalidRange,
    staleTime: 60_000,
  })

  const forecast = useQuery({
    queryKey: ['revenue-forecast', activeDatasetId],
    queryFn: () => api.revenue.forecast(activeDatasetId as string, 90),
    enabled: Boolean(activeDatasetId),
    staleTime: 120_000,
  })

  const data = analysis.data
  const forecastData = forecast.data
  const monthly = data?.monthly_comparison.slice(-12) ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Revenue intelligence')}
        title={t('Revenue performance & forecast')}
        description={t(
          'Analyze momentum, category and product contribution, customer concentration and a validated revenue forecast — all from transaction-level data.',
        )}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={analysis.isFetching ? 'animate-spin' : ''} />}
              onClick={() => analysis.refetch()}
              disabled={analysis.isFetching}
            >
              {t('Refresh')}
            </Button>
            <Link to="/reports">
              <Button size="sm" icon={<ArrowRight size={14} />}>{t('Build a report')}</Button>
            </Link>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
          <Field label={t('From')} className="w-full sm:w-40">
            <Input
              type="date"
              value={startDate}
              min={dataset?.date_min ?? undefined}
              max={dataset?.date_max ?? undefined}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field label={t('To')} className="w-full sm:w-40">
            <Input
              type="date"
              value={endDate}
              min={dataset?.date_min ?? undefined}
              max={dataset?.date_max ?? undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
          <div>
            <span className="label">{t('Granularity')}</span>
            <Tabs
              tabs={[
                { value: 'day', label: t('Daily') },
                { value: 'week', label: t('Weekly') },
                { value: 'month', label: t('Monthly') },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
          </div>
          {(startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-0.5"
              onClick={() => {
                setStartDate('')
                setEndDate('')
              }}
            >
              {t('Reset dates')}
            </Button>
          )}
          <div className="mb-1 ml-auto hidden items-center gap-1.5 text-[10px] text-slate-400 lg:flex">
            <CalendarRange size={12} />
            {t('Available')}: {longDate(dataset?.date_min)} — {longDate(dataset?.date_max)}
          </div>
        </div>
        {invalidRange && (
          <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
            {t('The start date must be before the end date.')}
          </p>
        )}
        <div className="mt-3">
          <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
        </div>
      </PageHeader>

      {analysis.isLoading && <SkeletonRows rows={8} />}
      {analysis.isError && (
        <ErrorState error={analysis.error as Error} retry={() => analysis.refetch()} title={t('Revenue analysis unavailable')} />
      )}

      {data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t('Total revenue')}
              value={formatCurrency(data.kpis.total_revenue)}
              trend={data.kpis.growth_pct}
              helper={data.kpis.growth_basis}
              icon={<CircleDollarSign size={20} />}
            />
            <KpiCard
              label={t('Orders')}
              value={formatNumber(data.kpis.total_orders)}
              helper={data.kpis.order_count_basis}
              icon={<ShoppingCart size={20} />}
              tone="cyan"
            />
            <KpiCard
              label={t('Average order value')}
              value={formatCurrency(data.kpis.average_order_value, true)}
              trend={data.kpis.period_growth_pct}
              helper={t('Selected-period revenue ÷ orders')}
              icon={<ReceiptText size={20} />}
              tone="green"
            />
            <KpiCard
              label={t('Active customers')}
              value={formatNumber(data.kpis.customers)}
              helper={t('{count} units sold', { count: formatNumber(data.kpis.units_sold) })}
              icon={<UsersRound size={20} />}
              tone="violet"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <ChartCard
              className="lg:col-span-8"
              title={t('Revenue trend')}
              subtitle={t('{view} view · {start} to {end}', {
                view: t(titleCase(data.period.granularity)),
                start: longDate(data.period.start),
                end: longDate(data.period.end),
              })}
              actions={<Badge tone="blue">{t('{days} days', { days: data.period.days })}</Badge>}
            >
              {data.trend.length ? (
                <RevenueTrendChart data={data.trend} height={310} />
              ) : (
                <EmptyState title={t('No revenue in period')} description={t('Adjust the date filters to find transactions.')} />
              )}
            </ChartCard>

            <Card className="p-5 lg:col-span-4">
              <h3 className="section-title">{t('Commercial efficiency')}</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">{t('Only computed when the supporting fields exist')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <Metric
                  label={t('Units sold')}
                  value={formatNumber(data.kpis.units_sold)}
                  hint={t('Selected period')}
                />
                <Metric
                  label={t('Gross margin')}
                  value={
                    data.kpis.gross_margin_pct !== null
                      ? formatPercent(data.kpis.gross_margin_pct)
                      : t('Unavailable')
                  }
                  hint={data.kpis.profit_available ? t('From mapped cost data') : t('No cost column detected')}
                />
                <Metric
                  label={t('Profit')}
                  value={data.kpis.profit !== null ? formatCurrency(data.kpis.profit) : t('Unavailable')}
                  hint={t('Transactions with cost data only')}
                />
                <Metric
                  label={t('Inventory value')}
                  value={
                    data.kpis.inventory_value !== null
                      ? formatCurrency(data.kpis.inventory_value)
                      : t('Unavailable')
                  }
                  hint={data.kpis.inventory_value_basis ?? t('Point-in-time stock')}
                />
              </div>
              <div className="mt-3.5 space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                    <span>{t('Bestseller rate')}</span>
                    <span>
                      {data.kpis.bestseller_rate_pct !== null
                        ? formatPercent(data.kpis.bestseller_rate_pct)
                        : t('Unavailable')}
                    </span>
                  </div>
                  <Progress value={data.kpis.bestseller_rate_pct ?? 0} />
                  <p className="mt-1.5 text-[10px] leading-4 text-slate-400">{data.kpis.bestseller_definition}</p>
                </div>
                {data.peak_period && (
                  <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-3 py-2.5 dark:border-brand-500/15 dark:bg-brand-500/[0.06]">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-brand-500">{t('Peak period')}</p>
                    <p className="mt-1 flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 dark:text-slate-100">{data.peak_period.label}</span>
                      <span className="font-mono font-semibold text-brand-700 dark:text-brand-300">
                        {formatCurrency(data.peak_period.revenue)}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <ChartCard
              className="lg:col-span-7"
              title={t('Year-over-year months')}
              subtitle={t('Latest 12 months, compared with the same month last year')}
            >
              {monthly.length ? (
                <ComparisonBarChart
                  data={monthly}
                  xKey="label"
                  series={[
                    { key: 'revenue', label: t('This period'), color: '#3b66ff' },
                    { key: 'previous_year_revenue', label: t('Prior year'), color: '#cbd5e1' },
                  ]}
                  height={300}
                />
              ) : (
                <EmptyState title={t('No monthly comparison')} />
              )}
            </ChartCard>
            <ChartCard className="lg:col-span-5" title={t('Category contribution')} subtitle={t('Share of selected-period revenue')}>
              {data.categories.length ? (
                <DonutChart
                  data={data.categories}
                  nameKey="category"
                  valueKey="revenue"
                  currency
                  height={300}
                  centerLabel={{ label: t('Top category'), value: data.categories[0]?.category ?? '—' }}
                />
              ) : (
                <EmptyState title={t('No category field')} />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="p-5 lg:col-span-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="section-title">{t('Product revenue table')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Top 20 products by period revenue')}</p>
                </div>
                <Link to="/products" className="text-[10px] font-bold text-brand-600 dark:text-brand-300">
                  {t('Product intelligence')}
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('Product')}</th>
                      <th className="text-right">{t('Units')}</th>
                      <th className="text-right">{t('Revenue')}</th>
                      <th className="text-right">{t('Share')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.slice(0, 10).map((product) => (
                      <tr key={product.product}>
                        <td className="max-w-[280px] truncate font-semibold text-slate-800 dark:text-slate-100">
                          {product.product}
                        </td>
                        <td className="text-right font-mono">{formatNumber(product.units)}</td>
                        <td className="text-right font-mono font-semibold">{formatCurrency(product.revenue)}</td>
                        <td className="text-right">
                          <Badge tone="slate">{formatPercent(product.share_pct)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="space-y-4 lg:col-span-4">
              <Card className="p-5">
                <h3 className="section-title">{t('Top customers')}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">{t('Revenue contribution in selected period')}</p>
                <div className="mt-3.5 space-y-2">
                  {data.top_customers.slice(0, 6).map((customer, index) => (
                    <div key={customer.customer_id} className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                            {customer.customer_id}
                          </p>
                          <p className="text-[10px] text-slate-400">{t('{count} orders', { count: customer.orders })}</p>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {formatCurrency(customer.revenue)}
                      </span>
                    </div>
                  ))}
                  {!data.top_customers.length && (
                    <p className="py-4 text-center text-xs text-slate-400">{t('No customer identifier mapped.')}</p>
                  )}
                </div>
              </Card>
              <Card className="p-5">
                <h3 className="section-title">{t('Declining months')}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">{t('Months with negative month-over-month growth')}</p>
                <div className="mt-3 space-y-2">
                  {data.declining_months.slice(-5).map((month) => (
                    <div key={month.label} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600 dark:text-slate-300">{month.label}</span>
                      <Badge tone="red">{formatPercent(month.growth_pct, true)}</Badge>
                    </div>
                  ))}
                  {!data.declining_months.length && (
                    <p className="py-3 text-center text-xs text-slate-400">{t('No declining month detected.')}</p>
                  )}
                </div>
              </Card>
            </div>
          </div>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="section-title">{t('Revenue insights')}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">{t('Signals supported by the selected-period metrics')}</p>
              </div>
              <Badge tone="blue">{data.insights.length}</Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <InsightList insights={data.insights.slice(0, Math.ceil(data.insights.length / 2))} compact />
              <InsightList insights={data.insights.slice(Math.ceil(data.insights.length / 2))} compact />
            </div>
          </Card>
        </div>
      )}

      <div className="mt-2 border-t border-slate-200/70 pt-6 dark:border-white/10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">{t('Validated forecast')}</p>
            <h2 className="mt-1 text-xl font-extrabold text-slate-950 dark:text-white">{t('Where revenue is heading')}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t(
                'The deployed model is selected on a chronological validation window, then evaluated on an untouched holdout.',
              )}
            </p>
          </div>
          {forecastData && (
            <Badge tone="green" dot>
              {forecastData.summary.model_label}
            </Badge>
          )}
        </div>

        {forecast.isLoading && <SkeletonRows rows={5} />}
        {forecast.isError && (
          <ErrorState error={forecast.error as Error} retry={() => forecast.refetch()} title={t('Forecast unavailable')} />
        )}
        {forecastData && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label={t('7-day forecast')}
                value={formatCurrency(forecastData.summary.forecast_7d)}
                icon={<Target size={20} />}
                tone="cyan"
              />
              <KpiCard
                label={t('30-day forecast')}
                value={formatCurrency(forecastData.summary.forecast_30d)}
                trend={forecastData.summary.growth_30_pct}
                helper={t('Versus recent 30-day actual')}
                icon={<CircleDollarSign size={20} />}
              />
              <KpiCard
                label={t('90-day forecast')}
                value={formatCurrency(forecastData.summary.forecast_90d)}
                helper={t('{trend} trend', { trend: t(forecastData.summary.trend) })}
                icon={<ArrowRight size={20} />}
                tone="violet"
              />
              <KpiCard
                label={t('Validation MAPE')}
                value={
                  forecastData.summary.metrics.mape !== null
                    ? formatPercent(forecastData.summary.metrics.mape)
                    : t('N/A')
                }
                helper={`${t(forecastData.summary.validation_quality)} · RMSE ${formatCurrency(
                  forecastData.summary.metrics.rmse,
                )}`}
                icon={<Percent size={20} />}
                tone="green"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <ChartCard
                className="lg:col-span-8"
                title={t('Revenue forecast path')}
                subtitle={t('Actual history and the forward forecast')}
              >
                <ForecastChart data={forecastData.series} height={318} />
              </ChartCard>
              <Card className="p-5 lg:col-span-4">
                <h3 className="section-title">{t('Holdout validation')}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {t('{count} observations compared with actuals', { count: forecastData.summary.metrics.n })}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <Metric label="MAE" value={formatCurrency(forecastData.summary.metrics.mae)} />
                  <Metric label="RMSE" value={formatCurrency(forecastData.summary.metrics.rmse)} />
                  <Metric
                    label="R²"
                    value={
                      forecastData.summary.metrics.r2 !== null
                        ? formatNumber(forecastData.summary.metrics.r2, 3)
                        : t('N/A')
                    }
                  />
                  <Metric
                    label="MAPE"
                    value={
                      forecastData.summary.metrics.mape !== null
                        ? formatPercent(forecastData.summary.metrics.mape)
                        : t('N/A')
                    }
                  />
                </div>
                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('Candidate models')}</p>
                  <div className="mt-2 space-y-1.5">
                    {forecastData.summary.candidates.slice(0, 5).map((candidate) => (
                      <div
                        key={candidate.model}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-[10px] dark:border-white/[0.06]"
                      >
                        <span className="truncate font-semibold text-slate-600 dark:text-slate-300">
                          {candidate.label}
                        </span>
                        <span className="shrink-0 font-mono text-slate-400">
                          {candidate.metrics.mae !== null ? formatCurrency(candidate.metrics.mae) : t(candidate.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <ChartCard
                className="lg:col-span-7"
                title={t('Forecast vs actual holdout')}
                subtitle={t('Weekly validation points generated by the selected model')}
              >
                {forecastData.validation.length ? (
                  <ValidationChart data={forecastData.validation} height={270} />
                ) : (
                  <EmptyState title={t('Validation series unavailable')} />
                )}
              </ChartCard>
              <Card className="p-5 lg:col-span-5">
                <h3 className="section-title">{t('Forecast notes')}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">{t('Model selection and limitations')}</p>
                <div className="mt-3 space-y-2">
                  {forecastData.notes.map((note, index) => (
                    <div key={index} className="flex items-start gap-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                      {note}
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <InsightList insights={forecastData.insights.slice(0, 2)} compact />
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>

      {data && (
        <EvidenceNote>
          {data.data_context.notes?.join(' ') ??
            t(
              'Revenue is calculated from mapped transaction values or derived quantity × unit price. All forecast metrics come from a chronological holdout.',
            )}{' '}
          {data.data_context.revenue_derived
            ? t('Revenue is derived from quantity × price because no revenue column was mapped.')
            : t('Revenue comes from a mapped revenue field.')}
        </EvidenceNote>
      )}

      {!data && !analysis.isLoading && !analysis.isError && (
        <EmptyState title={t('Choose a valid date range')} description={t('Set a start date before the end date to load revenue analytics.')} />
      )}
    </div>
  )
}
