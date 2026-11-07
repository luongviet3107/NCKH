import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Boxes,
  CircleGauge,
  Flame,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react'
import { api } from '../lib/api'
import { useDataset } from '../context/dataset-context'
import { useI18n } from '../i18n/language-context'
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  titleCase,
} from '../lib/utils'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  Select,
  SkeletonRows,
  Tabs,
} from '../components/ui'
import { ChartCard, DemoNotice, EvidenceNote, Metric } from '../components/shared'
import {
  DonutChart,
  ForecastChart,
  ForecastGrowthBars,
  ValidationChart,
} from '../components/charts'
import { CHART_COLORS } from '../lib/chart-colors'

type ProductTab = 'forecast' | 'catalog'

function trendTone(trend: string | null | undefined) {
  if (trend === 'Rising') return 'green' as const
  if (trend === 'Declining') return 'red' as const
  return 'slate' as const
}

function potentialTone(potential: string | null | undefined) {
  if (potential === 'High') return 'green' as const
  if (potential === 'Medium') return 'amber' as const
  return 'slate' as const
}

function qualityTone(quality: string | null | undefined) {
  if (quality === 'High') return 'green' as const
  if (quality === 'Medium') return 'amber' as const
  return 'slate' as const
}

export function ProductsPage() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const [tab, setTab] = useState<ProductTab>('forecast')
  const [search, setSearch] = useState('')
  const [catalogSort, setCatalogSort] = useState('recent_revenue')
  const [detailProduct, setDetailProduct] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  const forecast = useQuery({
    queryKey: ['product-forecast', activeDatasetId],
    queryFn: () => api.products.forecast(activeDatasetId as string, 90, 100),
    enabled: Boolean(activeDatasetId),
    staleTime: 120_000,
  })

  const catalog = useQuery({
    queryKey: ['product-catalog', activeDatasetId, deferredSearch, catalogSort],
    queryFn: () =>
      api.products.catalog(activeDatasetId as string, {
        search: deferredSearch || undefined,
        sortBy: catalogSort,
        limit: 200,
      }),
    enabled: Boolean(activeDatasetId) && tab === 'catalog',
    staleTime: 60_000,
  })

  const detail = useQuery({
    queryKey: ['product-detail', activeDatasetId, detailProduct],
    queryFn: () => api.products.detail(activeDatasetId as string, detailProduct as string, 90),
    enabled: Boolean(activeDatasetId && detailProduct),
    staleTime: 120_000,
  })

  const data = forecast.data
  const searchValue = deferredSearch.trim().toLowerCase()
  const filteredProducts =
    data?.products.filter(
      (product) =>
        !searchValue ||
        product.product.toLowerCase().includes(searchValue) ||
        product.category?.toLowerCase().includes(searchValue),
    ) ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Product intelligence')}
        title={t('Demand forecasting & product performance')}
        description={t(
          "Rank future best sellers, identify rising and declining products, and inspect each product's forecast model with validation evidence.",
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={forecast.isFetching ? 'animate-spin' : ''} />}
            onClick={() => (tab === 'forecast' ? forecast.refetch() : catalog.refetch())}
            disabled={tab === 'forecast' ? forecast.isFetching : catalog.isFetching}
          >
            {t('Refresh')}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { value: 'forecast', label: t('Forecast intelligence'), count: data?.products.length },
              { value: 'catalog', label: t('Product catalog'), count: catalog.data?.total },
            ]}
            value={tab}
            onChange={setTab}
          />
          <span className="text-[11px] text-slate-400">
            {dataset ? t('{count} transactions · {name}', { count: formatNumber(dataset.rows), name: dataset.name }) : ''}
          </span>
        </div>
        <div className="mt-3">
          <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
        </div>
      </PageHeader>

      {tab === 'forecast' && (
        <>
          {forecast.isLoading && <SkeletonRows rows={8} />}
          {forecast.isError && (
            <ErrorState
              error={forecast.error as Error}
              retry={() => forecast.refetch()}
              title={t('Product forecast unavailable')}
            />
          )}
          {data && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label={t('Forecastable products')}
                  value={formatNumber(data.summary.forecasted_products)}
                  helper={t('{count} products in full history', { count: formatNumber(data.summary.total_products) })}
                  icon={<Package size={20} />}
                />
                <KpiCard
                  label={t('Forecast 30-day demand')}
                  value={t('{count} units', { count: formatNumber(data.summary.total_forecast_30d) })}
                  helper={t('Sum of listed product forecasts')}
                  icon={<Boxes size={20} />}
                  tone="cyan"
                />
                <KpiCard
                  label={t('Rising products')}
                  value={formatNumber(data.summary.rising_products)}
                  helper={t('{count} declining products', { count: formatNumber(data.summary.declining_products) })}
                  icon={<TrendingUp size={20} />}
                  tone="green"
                />
                <KpiCard
                  label={t('High potential')}
                  value={formatNumber(data.summary.high_potential_products)}
                  helper={t('Relative potential score based on forecast growth')}
                  icon={<Flame size={20} />}
                  tone="amber"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-12">
                <ChartCard
                  className="lg:col-span-8"
                  title={t('Future best sellers')}
                  subtitle={t('Recent 30-day units versus forecast units for the next 30 days')}
                >
                  {data.chart_data.top_future_best_sellers.length ? (
                    <ForecastGrowthBars
                      data={data.chart_data.top_future_best_sellers.slice(0, 8)}
                      height={300}
                    />
                  ) : (
                    <EmptyState title={t('No product chart data')} />
                  )}
                </ChartCard>
                <Card className="p-5 lg:col-span-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="section-title">{t('Model mix')}</h3>
                      <p className="mt-0.5 text-[11px] text-slate-400">{t('Models selected per product')}</p>
                    </div>
                    <CircleGauge size={18} className="text-brand-500" />
                  </div>
                  {data.summary.model_mix.length ? (
                    <DonutChart
                      data={data.summary.model_mix.map((item) => ({ ...item, model: titleCase(item.model) }))}
                      nameKey="model"
                      valueKey="count"
                      colors={CHART_COLORS}
                      height={216}
                      centerLabel={{ label: t('Products'), value: String(data.summary.forecasted_products) }}
                    />
                  ) : (
                    <EmptyState title={t('No model selected')} />
                  )}
                  <p className="text-[10px] leading-4 text-slate-400">
                    {t('Training window: {start} to {end}.', {
                      start: data.summary.training_window.start,
                      end: data.summary.training_window.end,
                    })}
                  </p>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
                  <div>
                    <h3 className="section-title">{t('Product demand ranking')}</h3>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {t('{count} products shown · click a product to inspect its forecast', {
                        count: filteredProducts.length,
                      })}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t('Search product or category…')}
                      className="pl-9"
                      aria-label={t('Search product forecasts')}
                    />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('Product')}</th>
                        <th className="text-right">{t('Recent 30d')}</th>
                        <th className="text-right">{t('Forecast 30d')}</th>
                        <th className="text-right">{t('Growth')}</th>
                        <th>{t('Trend')}</th>
                        <th>{t('Potential')}</th>
                        <th>{t('Validation')}</th>
                        <th className="text-right">{t('Action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => (
                        <tr key={product.product}>
                          <td className="max-w-[300px]">
                            <button
                              type="button"
                              onClick={() => setDetailProduct(product.product)}
                              className="text-left"
                            >
                              <span className="block truncate font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-300">
                                {product.product}
                              </span>
                              <span className="block text-[10px] text-slate-400">
                                {t('{category} · {days} days since last sale', {
                                  category: product.category ?? '',
                                  days: formatNumber(product.days_since_last_sale),
                                })}
                              </span>
                            </button>
                          </td>
                          <td className="text-right font-mono">{formatNumber(product.recent_30_units)}</td>
                          <td className="text-right font-mono font-semibold">
                            {product.forecast_30d !== null ? formatNumber(product.forecast_30d) : '—'}
                          </td>
                          <td className="text-right">
                            <span
                              className={
                                product.forecast_30_growth_pct === null
                                  ? 'text-slate-400'
                                  : product.forecast_30_growth_pct >= 0
                                    ? 'font-mono font-semibold text-emerald-600 dark:text-emerald-400'
                                    : 'font-mono font-semibold text-rose-600 dark:text-rose-400'
                              }
                            >
                              {formatPercent(product.forecast_30_growth_pct, true)}
                            </span>
                          </td>
                          <td>
                            <Badge tone={trendTone(product.trend)}>{product.trend ? t(product.trend) : '—'}</Badge>
                          </td>
                          <td>
                            <Badge tone={potentialTone(product.potential)}>{product.potential ? t(product.potential) : '—'}</Badge>
                          </td>
                          <td>
                            <Badge tone={qualityTone(product.validation_quality)}>
                              {product.validation_quality ? t(product.validation_quality) : '—'}
                            </Badge>
                          </td>
                          <td className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDetailProduct(product.product)}
                              icon={<ArrowUpRight size={13} />}
                            >
                              {t('Inspect')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredProducts.length && (
                    <div className="px-6 py-10 text-center text-xs text-slate-400">
                      {t('No product matches the current search.')}
                    </div>
                  )}
                </div>
              </Card>

              <EvidenceNote>
                {data.notes.join(' ')}{' '}
                {t(
                  'Current stock is shown only when a stock quantity field is mapped. Potential ratings and rising/declining labels are relative to this dataset, not external benchmarks.',
                )}
              </EvidenceNote>
            </div>
          )}
        </>
      )}

      {tab === 'catalog' && (
        <>
          {catalog.isLoading && <SkeletonRows rows={8} />}
          {catalog.isError && (
            <ErrorState
              error={catalog.error as Error}
              retry={() => catalog.refetch()}
              title={t('Product catalog unavailable')}
            />
          )}
          {catalog.data && (
            <Card className="overflow-hidden">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06] sm:flex-row sm:items-center">
                <div>
                  <h3 className="section-title">{t('Product catalog')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {t('{total} products · showing {shown}', {
                      total: formatNumber(catalog.data.total),
                      shown: catalog.data.items.length,
                    })}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative w-full sm:w-72">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t('Search product or category…')}
                      className="pl-9"
                      aria-label={t('Search product catalog')}
                    />
                  </div>
                  <Select
                    value={catalogSort}
                    onChange={(event) => setCatalogSort(event.target.value)}
                    className="sm:w-52"
                    aria-label={t('Sort products')}
                  >
                    <option value="recent_revenue">{t('Recent revenue')}</option>
                    <option value="revenue">{t('Total revenue')}</option>
                    <option value="units">{t('Units sold')}</option>
                    <option value="recent_units">{t('Recent units')}</option>
                    <option value="growth">{t('Recent growth')}</option>
                    <option value="name">{t('Product name')}</option>
                  </Select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('Product')}</th>
                      <th>{t('Category')}</th>
                      <th className="text-right">{t('Units sold')}</th>
                      <th className="text-right">{t('Revenue')}</th>
                      <th className="text-right">{t('Orders')}</th>
                      <th className="text-right">{t('Recent 30d')}</th>
                      <th className="text-right">{t('Growth')}</th>
                      <th className="text-right">{t('Stock')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.data.items.map((item) => (
                      <tr key={item.product}>
                        <td className="max-w-[260px]">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(item.product)}
                            className="max-w-full truncate text-left font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-300"
                          >
                            {item.product}
                          </button>
                        </td>
                        <td>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{item.category}</span>
                        </td>
                        <td className="text-right font-mono">{formatNumber(item.units_sold)}</td>
                        <td className="text-right font-mono font-semibold">{formatCurrency(item.revenue)}</td>
                        <td className="text-right font-mono">{formatNumber(item.orders)}</td>
                        <td className="text-right font-mono">{formatNumber(item.recent_30_units)}</td>
                        <td className="text-right">
                          <span
                            className={
                              item.growth_pct === null
                                ? 'text-slate-400'
                                : item.growth_pct >= 0
                                  ? 'font-mono font-semibold text-emerald-600 dark:text-emerald-400'
                                  : 'font-mono font-semibold text-rose-600 dark:text-rose-400'
                            }
                          >
                            {formatPercent(item.growth_pct, true)}
                          </span>
                        </td>
                        <td className="text-right">
                          {item.current_stock !== null ? (
                            <span className="font-mono text-xs">{formatNumber(item.current_stock)}</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">{t('N/A')}</span>
                          )}
                        </td>
                        <td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetailProduct(item.product)}
                            icon={<TrendingUp size={13} />}
                          >
                            {t('Forecast')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!catalog.data.items.length && (
                  <div className="px-6 py-10 text-center text-xs text-slate-400">{t('No product matches the search.')}</div>
                )}
              </div>
            </Card>
          )}
          {!catalog.isLoading && !catalog.data && !catalog.isError && (
            <EmptyState title={t('Catalog is empty')} description={t('No product rows could be built from this dataset.')} />
          )}
        </>
      )}

      <Modal
        open={Boolean(detailProduct)}
        onClose={() => setDetailProduct(null)}
        title={detailProduct ?? t('Product forecast')}
        subtitle={t('90-day demand forecast with model validation and evidence')}
        size="xl"
      >
        {detail.isLoading && <SkeletonRows rows={7} />}
        {detail.isError && (
          <ErrorState error={detail.error as Error} retry={() => detail.refetch()} title={t('Product forecast unavailable')} />
        )}
        {detail.data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{detail.data.product.category}</Badge>
              <Badge tone="blue">{detail.data.forecast.model_label}</Badge>
              <Badge tone={qualityTone(detail.data.forecast.validation_quality)}>
                {t('{quality} validation', { quality: t(detail.data.forecast.validation_quality) })}
              </Badge>
              {detail.data.product.current_stock !== null && (
                <Badge tone="slate">{t('Stock: {count}', { count: formatNumber(detail.data.product.current_stock) })}</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Metric label={t('7-day forecast')} value={formatNumber(detail.data.forecast.forecast_7d)} />
              <Metric label={t('30-day forecast')} value={formatNumber(detail.data.forecast.forecast_30d)} />
              <Metric label={t('90-day forecast')} value={formatNumber(detail.data.forecast.forecast_90d)} />
              <Metric
                label={t('30-day growth')}
                value={formatPercent(detail.data.forecast.growth_30_pct, true)}
                hint={t('Versus recent actuals')}
              />
            </div>

            <ChartCard title={t('Demand path')} subtitle={t('Actual history and 90-day forecast')} contentClassName="mt-1">
              <ForecastChart data={detail.data.series} height={286} />
            </ChartCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t('Validation')}</h4>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="MAE" value={formatNumber(detail.data.forecast.metrics.mae, 2)} />
                  <Metric label="RMSE" value={formatNumber(detail.data.forecast.metrics.rmse, 2)} />
                  <Metric
                    label="MAPE"
                    value={
                      detail.data.forecast.metrics.mape !== null
                        ? formatPercent(detail.data.forecast.metrics.mape)
                        : t('N/A')
                    }
                  />
                  <Metric
                    label="R²"
                    value={
                      detail.data.forecast.metrics.r2 !== null
                        ? formatNumber(detail.data.forecast.metrics.r2, 3)
                        : t('N/A')
                    }
                  />
                </div>
                {detail.data.validation.length > 0 && (
                  <div className="mt-3">
                    <ValidationChart data={detail.data.validation} height={170} />
                  </div>
                )}
              </Card>
              <Card className="p-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t('Forecast factors')}</h4>
                <div className="mt-3 space-y-2">
                  {detail.data.factors.map((factor, index) => (
                    <div key={index} className="flex items-start gap-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                      {factor}
                    </div>
                  ))}
                  {!detail.data.factors.length && (
                    <p className="text-xs text-slate-400">{t('No factor explanation was produced.')}</p>
                  )}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3 text-[10px] leading-4 text-slate-400 dark:border-white/[0.06]">
                  {detail.data.forecast.notes.join(' ')}
                </div>
              </Card>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
