import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Layers3,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  UserRoundSearch,
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
  riskTone,
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
  Modal,
  PageHeader,
  Progress,
  Select,
  SkeletonRows,
  Tabs,
} from '../components/ui'
import { ChartCard, DemoNotice, EvidenceNote, Metric } from '../components/shared'
import { CustomerScatter, DonutChart, HorizontalBarChart } from '../components/charts'
import { CHART_COLORS } from '../lib/chart-colors'

type CustomerTab = 'segments' | 'churn' | 'directory'

export function CustomersPage() {
  const { dataset, activeDatasetId } = useDataset()
  const { t } = useI18n()
  const [tab, setTab] = useState<CustomerTab>('segments')
  const [inactiveDraft, setInactiveDraft] = useState(90)
  const [inactiveDays, setInactiveDays] = useState(90)
  const [directorySearch, setDirectorySearch] = useState('')
  const [segmentFilter, setSegmentFilter] = useState('')
  const [recCustomer, setRecCustomer] = useState<string | null>(null)
  const deferredDirectorySearch = useDeferredValue(directorySearch)

  const segmentation = useQuery({
    queryKey: ['segmentation', activeDatasetId],
    queryFn: () => api.customers.segment(activeDatasetId as string, 500),
    enabled: Boolean(activeDatasetId) && tab === 'segments',
    staleTime: 120_000,
  })

  const churn = useQuery({
    queryKey: ['churn', activeDatasetId, inactiveDays],
    queryFn: () => api.customers.churn(activeDatasetId as string, inactiveDays),
    enabled: Boolean(activeDatasetId) && tab === 'churn',
    staleTime: 120_000,
  })

  const directory = useQuery({
    queryKey: ['customer-directory', activeDatasetId, deferredDirectorySearch, segmentFilter],
    queryFn: () =>
      api.customers.list(activeDatasetId as string, {
        search: deferredDirectorySearch || undefined,
        segment: segmentFilter || undefined,
        limit: 200,
      }),
    enabled: Boolean(activeDatasetId) && tab === 'directory',
    staleTime: 60_000,
  })

  const recommendation = useQuery({
    queryKey: ['customer-recommendation', activeDatasetId, recCustomer],
    queryFn: () => api.customers.recommend(activeDatasetId as string, recCustomer as string, 6),
    enabled: Boolean(activeDatasetId && recCustomer),
    staleTime: 120_000,
  })

  const segData = segmentation.data
  const churnData = churn.data
  const highRisk = churnData?.customers.filter((customer) => customer.churn_risk === 'High Risk') ?? []
  const churnRate =
    churnData?.churn_labels_count && churnData.churn_labels_count.churned + churnData.churn_labels_count.retained > 0
      ? (churnData.churn_labels_count.churned /
          (churnData.churn_labels_count.churned + churnData.churn_labels_count.retained)) *
        100
      : null

  const segmentOptions = directory.data?.segments ?? segData?.clusters.map((cluster) => cluster.segment) ?? []
  const confusionCells: Array<{
    label: string
    value: number
    tone: 'green' | 'amber' | 'red' | 'blue'
  }> = churnData?.metrics
    ? [
        { label: t('True negative'), value: churnData.metrics.confusion_matrix.tn, tone: 'green' },
        { label: t('False positive'), value: churnData.metrics.confusion_matrix.fp, tone: 'amber' },
        { label: t('False negative'), value: churnData.metrics.confusion_matrix.fn, tone: 'red' },
        { label: t('True positive'), value: churnData.metrics.confusion_matrix.tp, tone: 'blue' },
      ]
    : []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Customer intelligence')}
        title={t('Segments, churn risk & recommendations')}
        description={t(
          'K-Means customer segmentation, supervised churn classification and product recommendations built from real purchase behavior — with model metrics and limitations shown openly.',
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={
              (tab === 'segments' && segmentation.isFetching) ||
              (tab === 'churn' && churn.isFetching) ||
              (tab === 'directory' && directory.isFetching)
                ? 'animate-spin'
                : ''
            } />}
            onClick={() =>
              tab === 'segments' ? segmentation.refetch() : tab === 'churn' ? churn.refetch() : directory.refetch()
            }
          >
            {t('Refresh')}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { value: 'segments', label: t('Segmentation'), count: segmentation.data?.metrics?.customers },
              { value: 'churn', label: t('Churn risk'), count: churn.data?.risk_distribution.reduce((sum, row) => sum + row.count, 0) },
              { value: 'directory', label: t('Customer directory'), count: directory.data?.total },
            ]}
            value={tab}
            onChange={setTab}
          />
          <span className="text-[11px] text-slate-400">
            {dataset ? t('Data through {date}', { date: longDate(dataset.date_max) }) : ''}
          </span>
        </div>
        <div className="mt-3">
          <DemoNotice isDemo={Boolean(dataset?.is_demo)} />
        </div>
      </PageHeader>

      {tab === 'segments' && (
        <>
          {segmentation.isLoading && <SkeletonRows rows={8} />}
          {segmentation.isError && (
            <ErrorState
              error={segmentation.error as Error}
              retry={() => segmentation.refetch()}
              title={t('Segmentation unavailable')}
            />
          )}
          {segData && !segData.available && (
            <EmptyState
              icon={<Layers3 size={22} />}
              title={t('Segmentation requires more customer history')}
              description={segData.reason ?? t('Customer identifiers, dates and monetary values are required.')}
            />
          )}
          {segData?.available && segData.metrics && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label={t('Customers analyzed')}
                  value={formatNumber(segData.metrics.customers)}
                  helper={t('{count} behavioral segments', { count: formatNumber(segData.k ?? 0) })}
                  icon={<UsersRound size={20} />}
                />
                <KpiCard
                  label={t('Silhouette score')}
                  value={
                    segData.metrics.silhouette_score !== null
                      ? formatNumber(segData.metrics.silhouette_score, 3)
                      : '—'
                  }
                  helper={t('Higher is better; model diagnostics only')}
                  icon={<Target size={20} />}
                  tone="cyan"
                />
                <KpiCard
                  label={t('Davies-Bouldin index')}
                  value={
                    segData.metrics.davies_bouldin_index !== null
                      ? formatNumber(segData.metrics.davies_bouldin_index, 3)
                      : '—'
                  }
                  helper={t('Lower indicates more separated clusters')}
                  icon={<Activity size={20} />}
                  tone="violet"
                />
                <KpiCard
                  label={t('Top value segment')}
                  value={
                    [...segData.clusters].sort((a, b) => b.avg_monetary - a.avg_monetary)[0]
                      ? t([...segData.clusters].sort((a, b) => b.avg_monetary - a.avg_monetary)[0].segment)
                      : '—'
                  }
                  helper={
                    [...segData.clusters].sort((a, b) => b.avg_monetary - a.avg_monetary)[0]
                      ? t('{value} average spend', {
                          value: formatCurrency(
                            [...segData.clusters].sort((a, b) => b.avg_monetary - a.avg_monetary)[0].avg_monetary,
                          ),
                        })
                      : undefined
                  }
                  icon={<Sparkles size={20} />}
                  tone="green"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-12">
                <ChartCard
                  className="lg:col-span-8"
                  title={t('Customer value map')}
                  subtitle={t('Recency versus monetary value, colored by K-Means segment')}
                >
                  {segData.chart_data?.scatter.length ? (
                    <CustomerScatter data={segData.chart_data.scatter} height={330} />
                  ) : (
                    <EmptyState title={t('Scatter data unavailable')} />
                  )}
                </ChartCard>
                <ChartCard className="lg:col-span-4" title={t('Segment distribution')} subtitle={t('Customers per segment')}>
                  {segData.segment_distribution.length ? (
                    <DonutChart
                      data={segData.segment_distribution.map((row) => ({ ...row, segment: t(row.segment) }))}
                      nameKey="segment"
                      valueKey="count"
                      height={264}
                      colors={CHART_COLORS}
                      centerLabel={{ label: t('Customers'), value: String(segData.metrics.customers) }}
                    />
                  ) : (
                    <EmptyState title={t('No segment counts')} />
                  )}
                </ChartCard>
              </div>

              <Card className="overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
                  <h3 className="section-title">{t('Segment profiles')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{segData.method}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('Segment')}</th>
                        <th className="text-right">{t('Customers')}</th>
                        <th className="text-right">{t('Share')}</th>
                        <th className="text-right">{t('Avg recency')}</th>
                        <th className="text-right">{t('Avg frequency')}</th>
                        <th className="text-right">{t('Avg monetary')}</th>
                        <th className="text-right">{t('Avg order value')}</th>
                        <th className="text-right">{t('Avg tenure')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segData.clusters.map((cluster) => (
                        <tr key={cluster.cluster}>
                          <td className="font-semibold text-slate-800 dark:text-slate-100">{t(cluster.segment)}</td>
                          <td className="text-right font-mono">{formatNumber(cluster.count)}</td>
                          <td className="text-right"><Badge tone="slate">{formatPercent(cluster.share_pct)}</Badge></td>
                          <td className="text-right font-mono">{t('{days}d', { days: formatNumber(cluster.avg_recency_days, 1) })}</td>
                          <td className="text-right font-mono">{formatNumber(cluster.avg_frequency, 2)}</td>
                          <td className="text-right font-mono font-semibold">{formatCurrency(cluster.avg_monetary)}</td>
                          <td className="text-right font-mono">{formatCurrency(cluster.avg_order_value, true)}</td>
                          <td className="text-right font-mono">{t('{days}d', { days: formatNumber(cluster.avg_tenure_days, 1) })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <EvidenceNote>
                {segData.method}. {t('Features')}: {segData.metrics.features.join(', ')}.{' '}
                {t(
                  'Scores are unsupervised diagnostics, not business outcomes. Segment names are assigned from relative RFM behavior and should be validated with the business.',
                )}
              </EvidenceNote>
            </div>
          )}
        </>
      )}

      {tab === 'churn' && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
            <Field label={t('Inactivity threshold (days)')} className="w-full sm:w-64">
              <Input
                type="number"
                min={30}
                max={365}
                value={inactiveDraft}
                onChange={(event) => setInactiveDraft(Number(event.target.value))}
              />
            </Field>
            <Button
              size="sm"
              className="mb-0.5"
              loading={churn.isFetching}
              onClick={() => setInactiveDays(Math.min(365, Math.max(30, Math.round(inactiveDraft) || 90)))}
            >
              {t('Run churn analysis')}
            </Button>
            <p className="mb-1 text-[10px] leading-4 text-slate-400">
              {t('A customer is labeled churned when inactive longer than this threshold at the dataset end date.')}
            </p>
          </div>
          {churn.isLoading && <SkeletonRows rows={8} />}
          {churn.isError && (
            <ErrorState error={churn.error as Error} retry={() => churn.refetch()} title={t('Churn analysis unavailable')} />
          )}
          {churnData && !churnData.available && (
            <EmptyState
              icon={<AlertTriangle size={22} />}
              title={t('Churn model needs more customer history')}
              description={churnData.reason ?? t('At least 40 customers with transaction history are required.')}
            />
          )}
          {churnData?.available && churnData.metrics && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label={t('High-risk customers')}
                  value={formatNumber(highRisk.length)}
                  helper={t('Threshold ≥ {value} churn probability', {
                    value: formatPercent((churnData.risk_thresholds?.high ?? 0.65) * 100),
                  })}
                  icon={<AlertTriangle size={20} />}
                  tone="rose"
                />
                <KpiCard
                  label={t('Holdout ROC-AUC')}
                  value={churnData.metrics.roc_auc !== null ? formatNumber(churnData.metrics.roc_auc, 3) : '—'}
                  helper={`${t(titleCase(churnData.metrics.model))} · ${t('accuracy')} ${formatPercent(churnData.metrics.accuracy * 100)}`}
                  icon={<Target size={20} />}
                  tone="cyan"
                />
                <KpiCard
                  label={t('Recall')}
                  value={formatPercent(churnData.metrics.recall * 100)}
                  helper={`${t('Precision')} ${formatPercent(churnData.metrics.precision * 100)} · F1 ${formatPercent(churnData.metrics.f1 * 100)}`}
                  icon={<Activity size={20} />}
                  tone="violet"
                />
                <KpiCard
                  label={t('Observed churn rate')}
                  value={churnRate !== null ? formatPercent(churnRate) : '—'}
                  helper={t('{count} churned labels', { count: formatNumber(churnData.churn_labels_count?.churned ?? 0) })}
                  icon={<UsersRound size={20} />}
                  tone="amber"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-12">
                <ChartCard className="lg:col-span-4" title={t('Risk distribution')} subtitle={t('Model-scored customers by risk band')}>
                  {churnData.risk_distribution.length ? (
                    <DonutChart
                      data={churnData.risk_distribution.map((row) => ({ ...row, risk: t(row.risk) }))}
                      nameKey="risk"
                      valueKey="count"
                      height={264}
                      colors={['#f43f5e', '#f59e0b', '#10b981']}
                      centerLabel={{
                        label: t('Scored'),
                        value: formatNumber(churnData.risk_distribution.reduce((sum, row) => sum + row.count, 0)),
                      }}
                    />
                  ) : (
                    <EmptyState title={t('No risk distribution')} />
                  )}
                </ChartCard>
                <Card className="p-5 lg:col-span-4">
                  <h3 className="section-title">{t('Model diagnostics')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Untouched test set')}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    <Metric label={t('Accuracy')} value={formatPercent(churnData.metrics.accuracy * 100)} />
                    <Metric label={t('F1 score')} value={formatPercent(churnData.metrics.f1 * 100)} />
                    <Metric label={t('Test rows')} value={formatNumber(churnData.metrics.test_size)} />
                    <Metric label={t('Training rows')} value={formatNumber(churnData.metrics.training_size)} />
                  </div>
                  <p className="mt-3 text-[10px] leading-4 text-slate-400">{churnData.metrics.label_definition}</p>
                  <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
                    {churnData.metrics.excludes_label_source
                      ? t('The label source (recency) is excluded from features to prevent target leakage.')
                      : t('Review label construction for leakage.')}
                  </p>
                </Card>
                <Card className="p-5 lg:col-span-4">
                  <h3 className="section-title">{t('Confusion matrix')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t('Holdout predictions')}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {confusionCells.map((cell) => (
                      <div key={cell.label} className="rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{cell.label}</p>
                        <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{cell.value}</p>
                        <Badge tone={cell.tone} className="mt-1 px-1.5 py-0 text-[8px]">
                          {cell.label}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-12">
                <ChartCard
                  className="lg:col-span-5"
                  title={t('Feature importance')}
                  subtitle={t('Permutation importance on the churn model')}
                >
                  {churnData.feature_importance?.length ? (
                    <HorizontalBarChart
                      data={churnData.feature_importance.slice(0, 8).map((row) => ({
                        ...row,
                        feature: t(row.feature.replace(/_/g, ' ')),
                      }))}
                      categoryKey="feature"
                      valueKey="importance"
                      height={280}
                      color="#8b5cf6"
                    />
                  ) : (
                    <EmptyState title={t('Feature importance unavailable')} />
                  )}
                </ChartCard>
                <Card className="overflow-hidden lg:col-span-7">
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
                    <div>
                      <h3 className="section-title">{t('High-risk customers')}</h3>
                      <p className="mt-0.5 text-[11px] text-slate-400">{t('Highest churn probability first')}</p>
                    </div>
                    <Badge tone="red">{highRisk.length}</Badge>
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    <table className="data-table">
                      <thead className="sticky top-0">
                        <tr>
                          <th>{t('Customer')}</th>
                          <th>{t('Segment')}</th>
                          <th className="text-right">{t('Recency')}</th>
                          <th className="text-right">{t('Monetary')}</th>
                          <th className="text-right">{t('Churn probability')}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {highRisk.slice(0, 30).map((customer) => (
                          <tr key={customer.customer_id}>
                            <td className="font-semibold text-slate-800 dark:text-slate-100">{customer.customer_id}</td>
                            <td><span className="text-[11px] text-slate-500 dark:text-slate-400">{t(customer.segment)}</span></td>
                            <td className="text-right font-mono">{t('{days}d', { days: formatNumber(customer.recency_days) })}</td>
                            <td className="text-right font-mono">{formatCurrency(customer.monetary)}</td>
                            <td className="text-right">
                              <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                                {formatPercent(customer.churn_probability * 100)}
                              </span>
                            </td>
                            <td className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRecCustomer(customer.customer_id)}
                                icon={<Sparkles size={13} />}
                              >
                                {t('Recommend')}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!highRisk.length && (
                      <div className="px-6 py-10 text-center text-xs text-slate-400">
                        {t('No customer exceeds the high-risk probability threshold.')}
                      </div>
                    )}
                  </div>
                </Card>
              </div>

              <EvidenceNote>
                {t(
                  'Churn labels are behavioral proxies based on inactivity, not confirmed cancellations. The model uses a stratified holdout and excludes the label source from features. Use predictions to prioritize retention review; campaign uplift must be measured with a controlled test.',
                )}
              </EvidenceNote>
            </div>
          )}
        </>
      )}

      {tab === 'directory' && (
        <>
          {directory.isLoading && <SkeletonRows rows={8} />}
          {directory.isError && (
            <ErrorState
              error={directory.error as Error}
              retry={() => directory.refetch()}
              title={t('Customer directory unavailable')}
            />
          )}
          {directory.data && (
            <Card className="overflow-hidden">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/[0.06] sm:flex-row sm:items-center">
                <div>
                  <h3 className="section-title">{t('Customer directory')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {t('{total} customers · showing {shown}', {
                      total: formatNumber(directory.data.total),
                      shown: directory.data.items.length,
                    })}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative w-full sm:w-64">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={directorySearch}
                      onChange={(event) => setDirectorySearch(event.target.value)}
                      placeholder={t('Search customer ID…')}
                      className="pl-9"
                      aria-label={t('Search customers')}
                    />
                  </div>
                  <Select
                    value={segmentFilter}
                    onChange={(event) => setSegmentFilter(event.target.value)}
                    className="sm:w-52"
                    aria-label={t('Filter by segment')}
                  >
                    <option value="">{t('All segments')}</option>
                    {segmentOptions.map((segment) => (
                      <option key={segment} value={segment}>{t(segment)}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('Customer')}</th>
                      <th>{t('Segment')}</th>
                      <th className="text-right">{t('Recency')}</th>
                      <th className="text-right">{t('Frequency')}</th>
                      <th className="text-right">{t('Monetary')}</th>
                      <th className="text-right">{t('Avg order value')}</th>
                      <th className="text-right">{t('Products')}</th>
                      <th>{t('Last purchase')}</th>
                      <th>{t('Risk')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {directory.data.items.map((customer) => (
                      <tr key={customer.customer_id}>
                        <td className="font-semibold text-slate-800 dark:text-slate-100">{customer.customer_id}</td>
                        <td><Badge tone="slate">{customer.segment ? t(customer.segment) : t('Unsegmented')}</Badge></td>
                        <td className="text-right font-mono">{t('{days}d', { days: formatNumber(customer.recency_days) })}</td>
                        <td className="text-right font-mono">{formatNumber(customer.frequency)}</td>
                        <td className="text-right font-mono font-semibold">{formatCurrency(customer.monetary)}</td>
                        <td className="text-right font-mono">{formatCurrency(customer.average_order_value, true)}</td>
                        <td className="text-right font-mono">{formatNumber(customer.distinct_products)}</td>
                        <td><span className="text-[11px] text-slate-500 dark:text-slate-400">{customer.last_purchase ?? '—'}</span></td>
                        <td>
                          {customer.churn_risk ? (
                            <Badge tone={riskTone(customer.churn_risk)}>{t(customer.churn_risk)}</Badge>
                          ) : (
                            <span className="text-[10px] text-slate-400">
                              {directory.data.churn_available ? '—' : t('No model')}
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRecCustomer(customer.customer_id)}
                            icon={<UserRoundSearch size={13} />}
                          >
                            {t('Recommend')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!directory.data.items.length && (
                  <div className="px-6 py-10 text-center text-xs text-slate-400">
                    {t('No customer matches the current filters.')}
                  </div>
                )}
              </div>
            </Card>
          )}
          {directory.data && (
            <EvidenceNote>
              {t(
                'Customer metrics are computed from the selected dataset. Product recommendations use a hybrid content/co-purchase/popularity score and are relative match scores, not calibrated purchase probabilities.',
              )}
            </EvidenceNote>
          )}
        </>
      )}

      <Modal
        open={Boolean(recCustomer)}
        onClose={() => setRecCustomer(null)}
        title={t('Recommendations for {customer}', { customer: recCustomer ?? '' })}
        subtitle={recommendation.data?.method ?? t('Hybrid product recommendation scoring')}
        size="lg"
      >
        {recommendation.isLoading && <SkeletonRows rows={5} />}
        {recommendation.isError && (
          <ErrorState
            error={recommendation.error as Error}
            retry={() => recommendation.refetch()}
            title={t('Recommendations unavailable')}
          />
        )}
        {recommendation.data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Metric
                label={t('Segment')}
                value={recommendation.data.customer.segment ? t(recommendation.data.customer.segment) : '—'}
              />
              <Metric
                label={t('Recency')}
                value={t('{days} days', { days: formatNumber(recommendation.data.customer.recency_days) })}
              />
              <Metric label={t('Frequency')} value={formatNumber(recommendation.data.customer.frequency)} />
              <Metric
                label={t('Monetary')}
                value={formatCurrency(recommendation.data.customer.monetary)}
                hint={t('{count} products purchased', {
                  count: formatNumber(recommendation.data.customer.purchased_products),
                })}
              />
            </div>
            <div className="space-y-2.5">
              {recommendation.data.recommendations.map((rec) => (
                <div
                  key={rec.product}
                  className="rounded-xl border border-slate-100 p-3.5 dark:border-white/[0.06]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{rec.product}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {rec.category} · {rec.median_price !== null ? formatCurrency(rec.median_price, true) : t('price unavailable')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {rec.already_purchased && <Badge tone="slate">{t('Previously purchased')}</Badge>}
                      <Badge tone="blue">{t('{value} match', { value: formatPercent(rec.match_score) })}</Badge>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Progress value={rec.match_score} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rec.reasons.map((reason, index) => (
                      <span
                        key={index}
                        className="rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!recommendation.data.recommendations.length && (
                <EmptyState title={t('No recommendation')} description={t('This customer has too little history for a grounded recommendation.')} />
              )}
            </div>
            <p className="text-[10px] leading-4 text-slate-400">{recommendation.data.score_note}</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
