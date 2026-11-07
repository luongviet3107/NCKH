import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Warehouse,
} from 'lucide-react'
import { api } from '../lib/api'
import { useDataset } from '../context/dataset-context'
import { useI18n } from '../i18n/language-context'
import {
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
  priorityTone,
  riskTone,
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
  Select,
  SkeletonRows,
} from '../components/ui'
import { ChartCard, DemoNotice, EvidenceNote } from '../components/shared'
import { DonutChart, HorizontalBarChart } from '../components/charts'
import { CHART_COLORS } from '../lib/chart-colors'

interface InventoryConfig {
  leadTime: number
  serviceLevel: number
  orderingCost: number
  holdingRate: number
}

const DEFAULT_CONFIG: InventoryConfig = {
  leadTime: 7,
  serviceLevel: 95,
  orderingCost: 500,
  holdingRate: 20,
}

type PriorityFilter = 'all' | 'urgent' | 'high' | 'medium' | 'low'

export function InventoryPage() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const [draft, setDraft] = useState<InventoryConfig>(DEFAULT_CONFIG)
  const [config, setConfig] = useState<InventoryConfig>(DEFAULT_CONFIG)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const deferredSearch = useDeferredValue(search)

  const query = useQuery({
    queryKey: ['inventory', activeDatasetId, config],
    queryFn: () =>
      api.inventory.forecast(activeDatasetId as string, {
        leadTimeDays: config.leadTime,
        serviceLevel: config.serviceLevel / 100,
        orderingCost: config.orderingCost,
        holdingRate: config.holdingRate / 100,
        limit: 300,
      }),
    enabled: Boolean(activeDatasetId),
    staleTime: 120_000,
  })

  const data = query.data
  const statuses = Array.from(new Set((data?.items ?? []).map((item) => item.status)))
  const searchValue = deferredSearch.trim().toLowerCase()
  const filteredItems =
    data?.items.filter((item) => {
      const matchesSearch =
        !searchValue ||
        item.product.toLowerCase().includes(searchValue) ||
        item.category?.toLowerCase().includes(searchValue)
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      return matchesSearch && matchesStatus
    }) ?? []

  const filteredRecommendations =
    data?.recommendations.filter((rec) => priorityFilter === 'all' || rec.priority === priorityFilter) ?? []

  const topCoverage = (data?.chart_data?.coverage_vs_stock ?? []).slice(0, 8)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Inventory optimization')}
        title={t('Stock health & replenishment')}
        description={t(
          'Forecast demand, identify stockout and overstock exposure, and calculate reorder points, safety stock and economic order quantities from your own data.',
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />}
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            {t('Refresh')}
          </Button>
        }
      >
        <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Settings2 size={16} className="text-brand-500" />
              {t('Planning assumptions')}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setDraft(DEFAULT_CONFIG); setConfig(DEFAULT_CONFIG) }}>
              {t('Reset defaults')}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('Lead time (days)')}>
              <Input
                type="number"
                min={1}
                max={180}
                value={draft.leadTime}
                onChange={(event) => setDraft({ ...draft, leadTime: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('Service level (%)')}>
              <Input
                type="number"
                min={50}
                max={99.9}
                step={0.5}
                value={draft.serviceLevel}
                onChange={(event) => setDraft({ ...draft, serviceLevel: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('Ordering cost ($)')}>
              <Input
                type="number"
                min={0}
                step={10}
                value={draft.orderingCost}
                onChange={(event) => setDraft({ ...draft, orderingCost: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('Annual holding rate (%)')}>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                value={draft.holdingRate}
                onChange={(event) => setDraft({ ...draft, holdingRate: Number(event.target.value) })}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400">
              {t(
                'Formula: safety stock = z × demand σ × √lead time; reorder point = average daily demand × lead time + safety stock.',
              )}
            </p>
            <Button
              size="sm"
              icon={<ClipboardCheck size={14} />}
              loading={query.isFetching}
              onClick={() =>
                setConfig({
                  leadTime: Math.min(180, Math.max(1, Math.round(draft.leadTime) || 7)),
                  serviceLevel: Math.min(99.9, Math.max(50, draft.serviceLevel || 95)),
                  orderingCost: Math.max(0, draft.orderingCost || 0),
                  holdingRate: Math.min(100, Math.max(1, draft.holdingRate || 20)),
                })
              }
            >
              {t('Run analysis')}
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
        </div>
      </PageHeader>

      {query.isLoading && <SkeletonRows rows={8} />}
      {query.isError && (
        <ErrorState error={query.error as Error} retry={() => query.refetch()} title={t('Inventory analysis unavailable')} />
      )}

      {data && !data.available && (
        <div className="space-y-4">
          <EmptyState
            icon={<Warehouse size={22} />}
            title={t('Inventory analysis needs a stock snapshot')}
            description={data.reason ?? t('Required current-stock or demand fields are missing from this dataset.')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {data.missing_fields.map((field) => (
                  <Badge key={field} tone="amber">{t(field.replace(/_/g, ' '))}</Badge>
                ))}
              </div>
            }
          />
          {data.guidance.length > 0 && (
            <Card className="p-5">
              <h3 className="section-title">{t('How to enable inventory intelligence')}</h3>
              <div className="mt-3 space-y-2.5">
                {data.guidance.map((item) => (
                  <div key={item.field} className="rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{item.label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.description}</p>
                    <p className="mt-1 text-[10px] text-brand-600 dark:text-brand-300">{item.suggestion}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {data?.available && data.summary && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t('Inventory value')}
              value={formatCurrency(data.summary.total_inventory_value)}
              helper={t('{count} products analyzed', { count: formatNumber(data.summary.products_analyzed) })}
              icon={<CircleDollarSign size={20} />}
            />
            <KpiCard
              label={t('Critical + low stock')}
              value={formatNumber(data.summary.critical_low_count)}
              helper={t('{value} recent revenue exposed', {
                value: formatCurrency(data.summary.critical_low_recent_revenue),
              })}
              icon={<ShieldAlert size={20} />}
              tone="rose"
            />
            <KpiCard
              label={t('Dead stock value')}
              value={formatCurrency(data.summary.dead_stock_value)}
              helper={t('{count} dead-stock products', { count: formatNumber(data.summary.dead_stock_count) })}
              icon={<AlertTriangle size={20} />}
              tone="amber"
            />
            <KpiCard
              label={t('Inventory health')}
              value={`${data.summary.health_score}/100`}
              helper={t('{overstock} overstock · {optimal} optimal', {
                overstock: formatNumber(data.summary.overstock_count),
                optimal: formatNumber(data.summary.optimal_count),
              })}
              icon={<Boxes size={20} />}
              tone="green"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <ChartCard className="lg:col-span-4" title={t('Stock status mix')} subtitle={t('Products by operational status')}>
              {data.chart_data?.status_distribution.length ? (
                <DonutChart
                  data={data.chart_data.status_distribution.map((row) => ({ ...row, status: t(row.status) }))}
                  nameKey="status"
                  valueKey="count"
                  height={264}
                  colors={CHART_COLORS}
                  centerLabel={{ label: t('Products'), value: String(data.summary.products_analyzed) }}
                />
              ) : (
                <EmptyState title={t('No status data')} />
              )}
            </ChartCard>
            <ChartCard className="lg:col-span-4" title={t('ABC classification')} subtitle={t('Revenue concentration classes')}>
              {data.chart_data?.abc_distribution.length ? (
                <DonutChart
                  data={data.chart_data.abc_distribution.map((row) => ({
                    ...row,
                    label: t('Class {class}', { class: row.class }),
                  }))}
                  nameKey="label"
                  valueKey="count"
                  height={264}
                  colors={['#3b66ff', '#06b6d4', '#94a3b8']}
                  centerLabel={{ label: t('Classes'), value: String(data.chart_data.abc_distribution.length) }}
                />
              ) : (
                <EmptyState title={t('No ABC data')} />
              )}
            </ChartCard>
            <ChartCard className="lg:col-span-4" title={t('Largest stock positions')} subtitle={t('Units on hand for priority products')}>
              {topCoverage.length ? (
                <HorizontalBarChart
                  data={topCoverage.map((row) => ({ ...row, label: row.product.length > 18 ? `${row.product.slice(0, 17)}…` : row.product }))}
                  categoryKey="label"
                  valueKey="stock"
                  height={264}
                  color="#3b66ff"
                />
              ) : (
                <EmptyState title={t('No coverage data')} />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="p-5 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="section-title">{t('Replenishment recommendations')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {t('Ranked by forecast demand and revenue exposure')}
                  </p>
                </div>
                <Select
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
                  className="h-8 w-auto text-xs"
                  aria-label={t('Filter recommendation priority')}
                >
                  <option value="all">{t('All priorities')}</option>
                  <option value="urgent">{t('Urgent')}</option>
                  <option value="high">{t('High')}</option>
                  <option value="medium">{t('Medium')}</option>
                  <option value="low">{t('Low')}</option>
                </Select>
              </div>
              <div className="mt-4 space-y-2.5">
                {filteredRecommendations.slice(0, 5).map((rec) => (
                  <div
                    key={rec.product}
                    className="rounded-xl border border-slate-100 bg-slate-50/40 p-3.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{rec.product}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {t('{count} units', { count: formatNumber(rec.current_stock) })} ·{' '}
                          {rec.coverage_days !== null
                            ? t('{days} days cover', { days: formatNumber(rec.coverage_days, 1) })
                            : t('cover unavailable')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={priorityTone(rec.priority)} className="uppercase">{t(rec.priority)}</Badge>
                        <Badge tone={riskTone(rec.status)}>{t(rec.status)}</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold leading-5 text-slate-700 dark:text-slate-200">{rec.issue}</p>
                    <p className="mt-1 text-[10px] leading-4 text-slate-400">{rec.cause}</p>
                    <div className="mt-2 space-y-1">
                      {rec.actions.slice(0, 2).map((action, index) => (
                        <p key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-brand-600 dark:text-brand-300">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                          {action}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
                {!filteredRecommendations.length && (
                  <EmptyState title={t('No recommendations at this priority')} />
                )}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-5">
              <h3 className="section-title">{t('Health & assumptions')}</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">{t('Explainable inputs used in this calculation')}</p>
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                  <span>{t('Portfolio health score')}</span>
                  <span>{data.summary.health_score}/100</span>
                </div>
                <Progress
                  value={data.summary.health_score}
                  indicatorClassName={data.summary.health_score >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}
                />
                <p className="mt-1.5 text-[10px] text-slate-400">
                  {t('Average coverage: {coverage} · {count} products need manual review.', {
                    coverage:
                      data.summary.average_coverage_days !== null
                        ? t('{days} days', { days: formatNumber(data.summary.average_coverage_days, 1) })
                        : t('unavailable'),
                    count: formatNumber(data.summary.review_required_count),
                  })}
                </p>
              </div>
              {data.assumptions && (
                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      [t('Lead time'), t('{days} days', { days: data.assumptions.lead_time_days })],
                      [t('Service level'), formatPercent(data.assumptions.service_level * 100)],
                      [t('z-value'), formatNumber(data.assumptions.z_value, 3)],
                      [t('Ordering cost'), formatCurrency(data.assumptions.ordering_cost_per_order)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-slate-100 px-2.5 py-2 dark:border-white/[0.06]">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5 pt-1">
                    {data.assumptions.notes.slice(0, 4).map((note, index) => (
                      <p key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-400">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                        {note}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06] sm:flex-row sm:items-center">
              <div>
                <h3 className="section-title">{t('Stock item detail')}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {t('{shown} of {total} products', { shown: filteredItems.length, total: data.items.length })}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('Search product or category…')}
                    className="pl-9"
                    aria-label={t('Search inventory')}
                  />
                </div>
                <Select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="sm:w-48"
                  aria-label={t('Filter inventory status')}
                >
                  <option value="all">{t('All statuses')}</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>{t(status)}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('Product')}</th>
                    <th>{t('ABC')}</th>
                    <th className="text-right">{t('Stock')}</th>
                    <th className="text-right">{t('Coverage')}</th>
                    <th>{t('Status')}</th>
                    <th className="text-right">{t('Reorder point')}</th>
                    <th className="text-right">{t('EOQ')}</th>
                    <th className="text-right">{t('Suggested order')}</th>
                    <th className="text-right">{t('Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.slice(0, 100).map((item) => (
                    <tr key={item.product}>
                      <td className="max-w-[260px]">
                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.product}</p>
                        <p className="text-[10px] text-slate-400">{item.category}</p>
                      </td>
                      <td><Badge tone="slate">{item.abc_class}</Badge></td>
                      <td className="text-right font-mono">{formatNumber(item.current_stock)}</td>
                      <td className="text-right font-mono">
                        {item.coverage_days !== null ? t('{days}d', { days: formatNumber(item.coverage_days, 1) }) : '—'}
                      </td>
                      <td><Badge tone={riskTone(item.status)}>{t(item.status)}</Badge></td>
                      <td className="text-right font-mono">{formatNumber(item.reorder_point, 1)}</td>
                      <td className="text-right font-mono">{item.eoq !== null ? formatNumber(item.eoq) : '—'}</td>
                      <td className="text-right">
                        <span
                          className={cn(
                            'font-mono font-semibold',
                            item.suggested_order_qty > 0
                              ? 'text-brand-600 dark:text-brand-300'
                              : 'text-slate-400',
                          )}
                        >
                          {formatNumber(item.suggested_order_qty)}
                        </span>
                      </td>
                      <td className="text-right font-mono">{formatCurrency(item.inventory_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredItems.length && (
                <div className="px-6 py-10 text-center text-xs text-slate-400">{t('No product matches the filters.')}</div>
              )}
            </div>
            {filteredItems.length > 100 && (
              <div className="border-t border-slate-100 px-5 py-3 text-center text-[10px] text-slate-400 dark:border-white/[0.06]">
                {t('Showing the first 100 filtered items. Narrow the search or status filter to inspect others.')}
              </div>
            )}
          </Card>

          <EvidenceNote>
            {t(
              'Inventory status is inferred from current stock, forecast demand and days since last sale. EOQ uses forecast annual demand and the configured costs; suggested order quantities are planning inputs, not purchase orders.',
            )}
            {data.assumptions?.coverage_formula
              ? ` ${t('Coverage formula: {formula}.', { formula: data.assumptions.coverage_formula })}`
              : ''}
          </EvidenceNote>
        </div>
      )}

      {data?.available && !data.summary && (
        <EmptyState title={t('No inventory rows')} description={t('No product had enough data to build an inventory position.')} />
      )}
    </div>
  )
}
