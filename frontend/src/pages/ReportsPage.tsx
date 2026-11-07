import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Boxes,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Package,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useDataset } from '../context/dataset-context'
import { useI18n } from '../i18n/language-context'
import {
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
  longDate,
  priorityTone,
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
  IconButton,
  Input,
  Modal,
  PageHeader,
  Progress,
  SkeletonRows,
  Toggle,
} from '../components/ui'
import { DemoNotice, EvidenceNote, Metric } from '../components/shared'

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description?: string
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{title}</h3>
        {description && <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{description}</p>}
      </div>
    </div>
  )
}

export function ReportsPage() {
  const { activeDatasetId } = useDataset()
  return <ReportsPageContent key={activeDatasetId ?? 'no-dataset'} />
}

function ReportsPageContent() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [includeForecast, setIncludeForecast] = useState(true)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const list = useQuery({
    queryKey: ['reports', activeDatasetId],
    queryFn: () => api.reports.list(activeDatasetId ?? undefined, 50),
    enabled: Boolean(activeDatasetId),
    staleTime: 15_000,
  })

  const items = list.data?.items ?? []
  const activeReportId = selectedReportId ?? items[0]?.id ?? null

  const detail = useQuery({
    queryKey: ['report', activeReportId],
    queryFn: () => api.reports.get(activeReportId as string),
    enabled: Boolean(activeReportId),
    staleTime: 60_000,
  })

  const create = useMutation({
    mutationFn: () =>
      api.reports.create(activeDatasetId as string, title.trim() || undefined, includeForecast),
    onSuccess: async (report) => {
      setTitle('')
      setSelectedReportId(report.id)
      await queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const remove = useMutation({
    mutationFn: (reportId: string) => api.reports.delete(reportId),
    onSuccess: async (_, reportId) => {
      if (activeReportId === reportId) setSelectedReportId(null)
      setDeleteTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const exportReport = useMutation({
    mutationFn: (variables: { id: string; format: 'pdf' | 'xlsx'; title: string }) =>
      api.reports.export(variables.id, variables.format, variables.title),
  })

  const report = detail.data
  const content = (report?.content ?? {}) as Record<string, any>
  const overview = content.dataset_overview ?? {}
  const revenue = content.revenue_analysis ?? {}
  const products = content.product_forecast ?? {}
  const inventory = content.inventory_forecast ?? {}
  const customers = content.customer_intelligence ?? {}
  const models = content.model_evaluation ?? {}
  const recommendations = (content.recommendations ?? []) as Array<Record<string, any>>
  const revenueKpis = revenue.kpis ?? {}
  const inventorySummary = inventory.summary ?? {}
  const churnMetrics = customers.churn_metrics ?? {}
  const segmentationMetrics = customers.segmentation_metrics ?? {}

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Decision reporting')}
        title={t('Reports & export')}
        description={t(
          'Generate an evidence-based business report from the active dataset, review it inline and export to PDF or Excel. Every section is populated from computed analyses.',
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={list.isFetching ? 'animate-spin' : ''} />}
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            {t('Refresh')}
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
                <FileText size={18} />
              </div>
              <div>
                <h3 className="section-title">{t('Generate report')}</h3>
                <p className="text-[10px] text-slate-400">{t('Captures the current analysis snapshot')}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <Field label={t('Report title (optional)')}>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('AutoDS Business Decision Report — {dataset}', {
                    dataset: dataset?.name ?? t('Dataset'),
                  })}
                  maxLength={200}
                />
              </Field>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/[0.06]">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('Include revenue forecast')}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{t('Adds a 90-day validated forecast section.')}</p>
                </div>
                <Toggle checked={includeForecast} onChange={setIncludeForecast} label={t('Include forecast')} />
              </div>
            </div>
            <Button
              className="mt-3 w-full"
              loading={create.isPending}
              disabled={!activeDatasetId}
              onClick={() => create.mutate()}
              icon={<Sparkles size={14} />}
            >
              {create.isPending ? t('Generating report…') : t('Generate report')}
            </Button>
            {create.isError && (
              <p className="mt-2 text-[11px] leading-5 text-rose-600 dark:text-rose-400">
                {(create.error as Error).message}
              </p>
            )}
            <p className="mt-2 text-[10px] leading-4 text-slate-400">
              {t('Report generation reruns the selected analyses. It may take a few seconds on larger datasets.')}
            </p>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('Report library')}</h3>
                <p className="text-[10px] text-slate-400">{t('Saved for the active dataset')}</p>
              </div>
              <Badge tone="slate">{list.data?.total ?? 0}</Badge>
            </div>
            {list.isLoading && <div className="p-4"><SkeletonRows rows={3} /></div>}
            {list.isError && (
              <div className="p-4">
                <ErrorState error={list.error as Error} retry={() => list.refetch()} title={t('Reports unavailable')} />
              </div>
            )}
            <div className="max-h-[560px] overflow-y-auto p-2">
              {list.data?.items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'group flex items-start gap-1 rounded-xl border transition',
                    activeReportId === item.id
                      ? 'border-brand-200 bg-brand-50/70 dark:border-brand-500/25 dark:bg-brand-500/[0.08]'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/[0.04]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedReportId(item.id)}
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] text-slate-400">{shortDate(item.created_at)}</span>
                      {item.dataset_name && (
                        <span className="max-w-[130px] truncate text-[9px] text-slate-400">{item.dataset_name}</span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-4 text-slate-700 dark:text-slate-200">
                      {item.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-400">{item.summary}</p>
                  </button>
                  <IconButton
                    label={t('Delete {title}', { title: item.title })}
                    className="mr-1 mt-2 h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:text-rose-600 dark:hover:text-rose-400"
                    onClick={() => setDeleteTarget({ id: item.id, title: item.title })}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              ))}
              {list.data && !list.data.items.length && (
                <p className="px-3 py-8 text-center text-[11px] text-slate-400">
                  {t('No reports yet. Generate the first report above.')}
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="xl:col-span-8">
          {!activeReportId && (
            <Card className="flex min-h-[420px] items-center justify-center p-6">
              <EmptyState
                icon={<FileText size={24} />}
                title={t('No report selected')}
                description={t(
                  'Generate a report or choose one from the library to inspect the full decision narrative, metrics and recommendations.',
                )}
              />
            </Card>
          )}

          {activeReportId && detail.isLoading && (
            <Card className="p-5"><SkeletonRows rows={10} /></Card>
          )}
          {activeReportId && detail.isError && (
            <ErrorState
              error={detail.error as Error}
              retry={() => detail.refetch()}
              title={t('Report unavailable')}
            />
          )}

          {report && (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="blue">{t('Decision report')}</Badge>
                      {overview.is_demo && <Badge tone="amber">{t('Demo data')}</Badge>}
                      {overview.quality_score !== undefined && (
                        <Badge tone="green">{t('Quality {score}/100', { score: overview.quality_score })}</Badge>
                      )}
                    </div>
                    <h2 className="mt-2 text-xl font-extrabold leading-7 text-slate-950 dark:text-white">
                      {report.title}
                    </h2>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{report.summary}</p>
                    <p className="mt-2 text-[10px] text-slate-400">
                      {t('Generated {date}', { date: longDate(report.created_at) })}
                      {overview.rows ? ` · ${t('{count} rows', { count: formatNumber(overview.rows) })}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={exportReport.isPending && exportReport.variables?.format === 'pdf'}
                      onClick={() => exportReport.mutate({ id: report.id, format: 'pdf', title: report.title })}
                      icon={<Download size={13} />}
                    >
                      PDF
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={exportReport.isPending && exportReport.variables?.format === 'xlsx'}
                      onClick={() => exportReport.mutate({ id: report.id, format: 'xlsx', title: report.title })}
                      icon={<FileSpreadsheet size={13} />}
                    >
                      Excel
                    </Button>
                  </div>
                </div>
                {exportReport.isError && (
                  <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
                    {(exportReport.error as Error).message}
                  </p>
                )}
              </Card>

              <Card className="p-5">
                <SectionHeading
                  icon={<Database size={15} />}
                  title={t('Dataset overview')}
                  description={overview.data_source_label}
                />
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Metric label={t('Rows')} value={formatNumber(overview.rows)} />
                  <Metric label={t('Columns')} value={formatNumber(overview.columns)} />
                  <Metric
                    label={t('Date range')}
                    value={`${shortDate(overview.date_range?.start)} – ${shortDate(overview.date_range?.end)}`}
                  />
                  <Metric label={t('Quality score')} value={`${overview.quality_score ?? '—'}/100`} />
                </div>
                {overview.quality_report && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Metric label={t('Missing cells')} value={formatPercent(overview.quality_report.missing_pct)} />
                    <Metric label={t('Duplicate rows')} value={formatNumber(overview.quality_report.duplicate_rows)} />
                    <Metric label={t('Invalid dates')} value={formatNumber(overview.quality_report.invalid_dates)} />
                    <Metric
                      label={t('Revenue source')}
                      value={overview.revenue_derived ? t('Derived') : t('Mapped')}
                      hint={overview.revenue_derived ? t('Quantity × unit price') : t('Revenue column')}
                    />
                  </div>
                )}
                {overview.column_mapping?.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 dark:border-white/[0.06]">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('Business field')}</th>
                          <th>{t('Mapped column')}</th>
                          <th>{t('Method')}</th>
                          <th className="text-right">{t('Confidence')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.column_mapping.slice(0, 10).map((mapping: any) => (
                          <tr key={mapping.field}>
                            <td className="text-[11px] font-semibold">{t(mapping.label)}</td>
                            <td className="font-mono text-[10px]">{mapping.column ?? '—'}</td>
                            <td className="text-[10px] text-slate-400">
                              {mapping.derived ? t('Derived') : t(titleCase(mapping.method))}
                            </td>
                            <td className="text-right font-mono text-[10px]">
                              {formatPercent(mapping.confidence)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <SectionHeading
                  icon={<BarChart3 size={15} />}
                  title={t('Revenue analysis')}
                  description={revenue.period ? `${longDate(revenue.period.start)} – ${longDate(revenue.period.end)}` : undefined}
                />
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Metric label={t('Revenue')} value={formatCurrency(revenueKpis.total_revenue)} />
                  <Metric label={t('Orders')} value={formatNumber(revenueKpis.total_orders)} />
                  <Metric label={t('Average order value')} value={formatCurrency(revenueKpis.average_order_value, true)} />
                  <Metric
                    label={t('Latest-window growth')}
                    value={
                      revenueKpis.growth_pct !== null && revenueKpis.growth_pct !== undefined
                        ? formatPercent(revenueKpis.growth_pct, true)
                        : '—'
                    }
                  />
                </div>
                {revenue.forecast_summary && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Metric label={t('30-day forecast')} value={formatCurrency(revenue.forecast_summary.forecast_30d)} />
                    <Metric label={t('90-day forecast')} value={formatCurrency(revenue.forecast_summary.forecast_90d)} />
                    <Metric label={t('Forecast model')} value={revenue.forecast_summary.model_label} />
                    <Metric
                      label={t('MAPE')}
                      value={
                        revenue.forecast_summary.metrics?.mape !== null
                          ? formatPercent(revenue.forecast_summary.metrics?.mape)
                          : '—'
                      }
                    />
                  </div>
                )}
                {revenue.top_categories?.length > 0 && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="label">{t('Top categories')}</p>
                      <div className="space-y-1.5">
                        {revenue.top_categories.slice(0, 5).map((category: any) => (
                          <div key={category.category} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-slate-600 dark:text-slate-300">{category.category}</span>
                            <span className="shrink-0 font-mono text-slate-400">{formatCurrency(category.revenue)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="label">{t('Top products')}</p>
                      <div className="space-y-1.5">
                        {revenue.top_products?.slice(0, 5).map((product: any) => (
                          <div key={product.product} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-slate-600 dark:text-slate-300">{product.product}</span>
                            <span className="shrink-0 font-mono text-slate-400">{formatCurrency(product.revenue)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-5">
                  <SectionHeading
                    icon={<Package size={15} />}
                    title={t('Product demand forecast')}
                    description={t('{count} forecastable products', {
                      count: formatNumber(products.summary?.forecasted_products),
                    })}
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <Metric label={t('Rising')} value={formatNumber(products.summary?.rising_products)} />
                    <Metric label={t('Declining')} value={formatNumber(products.summary?.declining_products)} />
                    <Metric label={t('High potential')} value={formatNumber(products.summary?.high_potential_products)} />
                    <Metric
                      label={t('30-day demand')}
                      value={t('{count} units', { count: formatNumber(products.summary?.total_forecast_30d) })}
                    />
                  </div>
                  {products.top_products?.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {products.top_products.slice(0, 5).map((product: any) => (
                        <div key={product.product} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="truncate text-slate-600 dark:text-slate-300">{product.product}</span>
                          <span className="shrink-0 font-mono text-slate-400">
                            {t('{count} units forecast', { count: formatNumber(product.forecast_30d) })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="p-5">
                  <SectionHeading
                    icon={<Boxes size={15} />}
                    title={t('Inventory position')}
                    description={inventory.available ? t('Current stock snapshot') : inventory.reason}
                  />
                  {inventory.available && inventorySummary ? (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Metric label={t('Health score')} value={`${inventorySummary.health_score}/100`} />
                        <Metric label={t('Inventory value')} value={formatCurrency(inventorySummary.total_inventory_value)} />
                        <Metric label={t('Critical / low')} value={formatNumber(inventorySummary.critical_low_count)} />
                        <Metric label={t('Dead stock')} value={formatNumber(inventorySummary.dead_stock_count)} />
                      </div>
                      <div className="mt-3">
                        <Progress
                          value={inventorySummary.health_score}
                          indicatorClassName={inventorySummary.health_score >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}
                        />
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {inventory.recommendations?.slice(0, 3).map((rec: any) => (
                          <div key={rec.product} className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="truncate text-slate-600 dark:text-slate-300">{rec.product}</span>
                            <Badge tone={priorityTone(rec.priority)}>{t(rec.priority)}</Badge>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] leading-5 text-slate-400">
                      {inventory.reason ?? t('Inventory analysis is unavailable for this dataset.')}
                    </p>
                  )}
                </Card>
              </div>

              <Card className="p-5">
                <SectionHeading
                  icon={<Users size={15} />}
                  title={t('Customer intelligence')}
                  description={t('Segmentation and churn evidence at the report generation time')}
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <Metric
                        label={t('Customers segmented')}
                        value={formatNumber(segmentationMetrics?.customers)}
                      />
                      <Metric
                        label={t('Silhouette score')}
                        value={formatNumber(segmentationMetrics?.silhouette_score, 3)}
                      />
                    </div>
                    {customers.clusters?.length > 0 && (
                      <div className="mt-2.5 space-y-1.5">
                        {customers.clusters.map((cluster: any) => (
                          <div key={cluster.cluster} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-600 dark:text-slate-300">{t(cluster.segment)}</span>
                            <span className="font-mono text-slate-400">
                              {t('{count} customers · {value}', {
                                count: formatNumber(cluster.count),
                                value: formatCurrency(cluster.avg_monetary),
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!customers.segmentation_available && (
                      <p className="mt-2 text-[10px] text-slate-400">{customers.segmentation_reason}</p>
                    )}
                  </div>
                  <div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <Metric label={t('Churn model')} value={t(titleCase(churnMetrics.model))} />
                      <Metric
                        label={t('ROC-AUC')}
                        value={
                          churnMetrics.roc_auc !== null && churnMetrics.roc_auc !== undefined
                            ? formatNumber(churnMetrics.roc_auc, 3)
                            : '—'
                        }
                      />
                    </div>
                    {customers.risk_distribution?.length > 0 && (
                      <div className="mt-2.5 space-y-1.5">
                        {customers.risk_distribution.map((row: any) => (
                          <div key={row.risk} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-600 dark:text-slate-300">{t(row.risk)}</span>
                            <span className="font-mono text-slate-400">{formatNumber(row.count)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!customers.churn_available && (
                      <p className="mt-2 text-[10px] text-slate-400">{customers.churn_reason}</p>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <SectionHeading
                  icon={<FlaskConical size={15} />}
                  title={t('Model evaluation')}
                  description={t('Latest saved benchmark or deployed forecast validation')}
                />
                {models.status === 'benchmark_available' ? (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Metric label={t('Task')} value={t(titleCase(models.task))} />
                    <Metric label={t('Human model')} value={models.results?.human?.label ?? '—'} />
                    <Metric label={t('AI model')} value={models.results?.ai?.label ?? '—'} />
                    <Metric label={t('Benchmarked')} value={shortDate(models.created_at)} />
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">{models.message}</p>
                    {models.deployed_forecast_model && (
                      <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        <Metric label={t('Model')} value={models.deployed_forecast_model.model_label} />
                        <Metric
                          label={t('MAE')}
                          value={formatCurrency(models.deployed_forecast_model.metrics?.mae)}
                        />
                        <Metric
                          label={t('RMSE')}
                          value={formatCurrency(models.deployed_forecast_model.metrics?.rmse)}
                        />
                        <Metric
                          label={t('Validation')}
                          value={t(models.deployed_forecast_model.validation_quality)}
                        />
                      </div>
                    )}
                  </>
                )}
              </Card>

              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <SectionHeading icon={<Sparkles size={15} />} title={t('Prioritized recommendations')} />
                  <Badge tone="blue">{recommendations.length}</Badge>
                </div>
                <div className="space-y-2.5">
                  {recommendations.map((recommendation, index) => (
                    <div
                      key={`${recommendation.title}-${index}`}
                      className="rounded-xl border border-slate-100 p-3.5 dark:border-white/[0.06]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={priorityTone(recommendation.priority)} className="uppercase">
                          {t(recommendation.priority)}
                        </Badge>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          {t(recommendation.area)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                        {recommendation.title}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                        {recommendation.action}
                      </p>
                      {Array.isArray(recommendation.evidence) && recommendation.evidence.length > 0 && (
                        <p className="mt-1 font-mono text-[10px] leading-4 text-slate-400">
                          {recommendation.evidence[0]}
                        </p>
                      )}
                      {recommendation.expected_impact && (
                        <p className="mt-1 text-[10px] leading-4 text-cyan-700 dark:text-cyan-300">
                          {recommendation.expected_impact}
                        </p>
                      )}
                    </div>
                  ))}
                  {!recommendations.length && (
                    <p className="text-xs text-slate-400">{t('No prioritized recommendations were generated.')}</p>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <SectionHeading icon={<FileText size={15} />} title={t('Conclusion & limitations')} />
                <p className="text-xs leading-6 text-slate-600 dark:text-slate-300">{content.conclusion}</p>
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  {(content.limitations ?? []).map((limitation: string, index: number) => (
                    <p key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-400">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                      {limitation}
                    </p>
                  ))}
                </div>
              </Card>

              <EvidenceNote>
                {t(
                  'This report is a snapshot of the analysis at generation time. Export files are generated from the saved report content, not from placeholder or precomputed marketing values.',
                )}
              </EvidenceNote>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('Delete report?')}
        subtitle={t('This removes the saved report and its generated content.')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('Cancel')}</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              icon={<Trash2 size={14} />}
            >
              {t('Delete report')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t('{title} will be permanently deleted. Existing downloaded files are not affected.', {
            title: deleteTarget?.title ?? '',
          })}
        </p>
        {remove.isError && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{(remove.error as Error).message}</p>
        )}
      </Modal>
    </div>
  )
}
