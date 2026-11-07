import { useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileUp,
  FolderOpen,
  HardDrive,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react'
import { api } from '../lib/api'
import { useDataset } from '../context/dataset-context'
import { useI18n } from '../i18n/language-context'
import { cn, formatNumber, formatPercent, longDate, shortDate, titleCase } from '../lib/utils'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  InlineNote,
  Input,
  Modal,
  PageHeader,
  Progress,
  Select,
  SkeletonRows,
  Tabs,
  Toggle,
} from '../components/ui'
import { DemoNotice, Metric } from '../components/shared'

type DataTab = 'quality' | 'columns' | 'preview' | 'mapping'

const MAX_PREVIEW = 200

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function DataPage() {
  const { datasets, activeDatasetId, refresh } = useDataset()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(activeDatasetId)
  const [tab, setTab] = useState<DataTab>('quality')
  const [dragging, setDragging] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [columnSearch, setColumnSearch] = useState('')
  const [columnSort, setColumnSort] = useState<'dataset' | 'missing'>('dataset')
  const [previewPage, setPreviewPage] = useState(0)
  const [previewSize, setPreviewSize] = useState(25)
  const [rawPreview, setRawPreview] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [cleanOptions, setCleanOptions] = useState({
    drop_duplicates: true,
    drop_missing_dates: true,
    drop_invalid_values: true,
    fill_missing_category: false,
  })
  const [cleaningNotice, setCleaningNotice] = useState<Record<string, any> | null>(null)

  const resolvedDatasetId =
    selectedDatasetId && datasets.some((item) => item.id === selectedDatasetId)
      ? selectedDatasetId
      : activeDatasetId ?? datasets[0]?.id ?? null

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 5 * 60_000,
  })

  const profile = useQuery({
    queryKey: ['dataset-profile', resolvedDatasetId],
    queryFn: () => api.datasets.profile(resolvedDatasetId as string),
    enabled: Boolean(resolvedDatasetId),
    staleTime: 10_000,
  })

  const preview = useQuery({
    queryKey: ['dataset-preview', resolvedDatasetId, previewPage, previewSize, rawPreview],
    queryFn: () =>
      api.datasets.preview(resolvedDatasetId as string, {
        limit: previewSize,
        offset: previewPage * previewSize,
        raw: rawPreview,
      }),
    enabled: Boolean(resolvedDatasetId) && tab === 'preview',
    staleTime: 10_000,
  })

  function resetDatasetView() {
    setPreviewPage(0)
    setColumnSearch('')
    setCleaningNotice(null)
    setActionError(null)
  }

  function selectDataset(datasetId: string) {
    setSelectedDatasetId(datasetId)
    resetDatasetView()
  }

  const upload = useMutation({
    mutationFn: (file: File) => api.datasets.upload(file),
    onSuccess: async (result) => {
      setUploadError(null)
      setNotice(
        t('Uploaded {name} and created its quality profile.', {
          name: result.dataset.original_filename,
        }),
      )
      await queryClient.invalidateQueries({ queryKey: ['datasets'] })
      selectDataset(result.dataset.id)
      setTab('quality')
    },
    onError: (error: Error) => setUploadError(error.message),
  })

  const loadDemo = useMutation({
    mutationFn: api.datasets.loadDemo,
    onSuccess: async (dataset) => {
      await queryClient.invalidateQueries({ queryKey: ['datasets'] })
      selectDataset(dataset.id)
      setNotice(t('The clearly labelled demo dataset is loaded and active.'))
    },
    onError: (error: Error) => setActionError(error.message),
  })

  const remove = useMutation({
    mutationFn: (datasetId: string) => api.datasets.delete(datasetId),
    onSuccess: async (_, datasetId) => {
      setDeleteTarget(null)
      setNotice(t('Dataset deleted. The original file was removed from local storage.'))
      await queryClient.invalidateQueries({ queryKey: ['datasets'] })
      if (resolvedDatasetId === datasetId) {
        setSelectedDatasetId(null)
        resetDatasetView()
      }
    },
    onError: (error: Error) => setActionError(error.message),
  })

  const clean = useMutation({
    mutationFn: () => api.datasets.clean(resolvedDatasetId as string, cleanOptions),
    onSuccess: async (result) => {
      setCleaningNotice(result.cleaning_report)
      setNotice(t('Cleaning completed. The cleaned copy is saved and active; the original upload is preserved.'))
      setRawPreview(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['datasets'] }),
        queryClient.invalidateQueries({ queryKey: ['dataset-profile', resolvedDatasetId] }),
        queryClient.invalidateQueries({ queryKey: ['dataset-preview'] }),
      ])
    },
    onError: (error: Error) => setActionError(error.message),
  })

  const selectedDataset = datasets.find((item) => item.id === resolvedDatasetId) ?? null
  const profileData = profile.data?.profile
  const cleaningReport = profile.data?.cleaning_report ?? cleaningNotice
  const mapping = profileData?.mapping ?? []
  const columns = profileData?.column_info ?? []
  const guidance = profileData?.missing_data_guidance ?? []
  const capabilities = profileData?.capabilities ?? []
  const quality = profileData?.quality_score ?? selectedDataset?.quality_score ?? 0
  const uploadLimit = settings.data?.limits.max_upload_mb ?? 50

  const filteredColumns = columns
    .filter((column) => column.name.toLowerCase().includes(columnSearch.toLowerCase()))
    .sort((a, b) => (columnSort === 'missing' ? b.missing - a.missing : 0))

  const previewColumns = preview.data?.items.length
    ? Object.keys(preview.data.items[0])
    : preview.data?.columns.map((column) => column.name) ?? []
  const totalPreview = preview.data?.total ?? 0
  const previewPages = Math.max(1, Math.ceil(totalPreview / previewSize))

  function startUpload(file: File) {
    setNotice(null)
    setUploadError(null)
    const suffix = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!['.csv', '.xlsx', '.xls'].includes(suffix)) {
      setUploadError(t('Only CSV, XLSX and XLS files are supported.'))
      return
    }
    if (file.size > uploadLimit * 1024 * 1024) {
      setUploadError(t('This file exceeds the {limit} MB upload limit.', { limit: uploadLimit }))
      return
    }
    upload.mutate(file)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) startUpload(file)
  }

  async function activateDataset(datasetId: string) {
    setActionError(null)
    setActivatingId(datasetId)
    try {
      await api.datasets.activate(datasetId)
      await queryClient.invalidateQueries()
      selectDataset(datasetId)
    } catch (error) {
      setActionError((error as Error).message)
    } finally {
      setActivatingId(null)
    }
  }

  async function refreshAll() {
    setRefreshing(true)
    setActionError(null)
    try {
      await refresh()
      if (resolvedDatasetId) {
        await queryClient.invalidateQueries({ queryKey: ['dataset-profile', resolvedDatasetId] })
        await queryClient.invalidateQueries({ queryKey: ['dataset-preview', resolvedDatasetId] })
      }
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Data studio')}
        title={t('Datasets & quality')}
        description={t(
          'Upload business data, inspect column mapping and data quality, preview the cleaned source and control which dataset every analysis uses.',
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
            <Button
              variant="secondary"
              size="sm"
              loading={loadDemo.isPending}
              onClick={() => loadDemo.mutate()}
              icon={<Sparkles size={14} />}
            >
              {t('Load demo')}
            </Button>
            <Button
              size="sm"
              loading={upload.isPending}
              onClick={() => fileInputRef.current?.click()}
              icon={<FileUp size={14} />}
            >
              {t('Upload data')}
            </Button>
          </>
        }
      >
        {selectedDataset?.is_demo && <DemoNotice isDemo />}
        {notice && (
          <InlineNote tone="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={13} /> {notice}
            </span>
          </InlineNote>
        )}
        {actionError && (
          <InlineNote tone="danger">
            <span className="flex items-center gap-2">
              <AlertTriangle size={13} /> {actionError}
            </span>
          </InlineNote>
        )}
      </PageHeader>

      <input
        ref={fileInputRef}
        id="dataset-upload-input"
        type="file"
        accept=".csv,.xlsx,.xls"
        className="sr-only"
        disabled={upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) startUpload(file)
          event.target.value = ''
        }}
      />

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-4">
          <Card className="p-4">
            <label
              htmlFor="dataset-upload-input"
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition',
                dragging
                  ? 'border-brand-400 bg-brand-50/80 dark:border-brand-400/60 dark:bg-brand-500/10'
                  : 'border-slate-200 bg-slate-50/50 hover:border-brand-300 hover:bg-brand-50/40 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-brand-400/30 dark:hover:bg-brand-500/[0.04]',
                upload.isPending && 'pointer-events-none opacity-70',
              )}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-sm dark:bg-slate-800 dark:text-brand-300">
                <UploadCloud size={21} />
              </div>
              <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                {upload.isPending ? t('Uploading & profiling…') : t('Drop a data file here')}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                {t('CSV, XLSX or XLS · up to {limit} MB', { limit: uploadLimit })}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">{t('or click to browse')}</p>
            </label>
            {uploadError && (
              <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-5 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
                {uploadError}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-2 dark:border-white/[0.06]">
              <HardDrive size={14} className="shrink-0 text-slate-400" />
              <p className="text-[10px] leading-4 text-slate-400">
                {t('Uploads are parsed locally by the backend. Automatic column detection and quality profiling run immediately.')}
              </p>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('Dataset library')}</h3>
                <p className="text-[10px] text-slate-400">
                  {t('{count} available', { count: formatNumber(datasets.length) })}
                </p>
              </div>
              <Database size={16} className="text-slate-400" />
            </div>
            <div className="max-h-[520px] overflow-y-auto p-2">
              {datasets.map((item) => {
                const isSelected = item.id === resolvedDatasetId
                const isActivating = activatingId === item.id
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'group flex items-start gap-1 rounded-xl border transition',
                      isSelected
                        ? 'border-brand-200 bg-brand-50/70 dark:border-brand-500/25 dark:bg-brand-500/[0.08]'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/[0.04]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectDataset(item.id)}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.is_active && <Badge tone="green">{t('Active')}</Badge>}
                        {item.is_demo && <Badge tone="amber">{t('Demo')}</Badge>}
                        <span className="ml-auto text-[9px] text-slate-400">{shortDate(item.created_at)}</span>
                      </div>
                      <p className="mt-1.5 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        {item.name}
                      </p>
                      <p className="truncate text-[9px] text-slate-400">{item.original_filename}</p>
                      <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-400">
                        <span>{t('{count} rows', { count: formatNumber(item.rows) })}</span>
                        <span>·</span>
                        <span>{t('{count} columns', { count: formatNumber(item.columns) })}</span>
                        {item.quality_score !== null && (
                          <>
                            <span>·</span>
                            <span
                              className={cn(
                                'font-bold',
                                item.quality_score >= 80
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : item.quality_score >= 60
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-rose-600 dark:text-rose-400',
                              )}
                            >
                              {item.quality_score}/100
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col gap-0.5 py-2 pr-1">
                      {!item.is_active && (
                        <IconButton
                          label={t('Set {name} active', { name: item.name })}
                          className="h-7 w-7"
                          disabled={isActivating}
                          onClick={() => activateDataset(item.id)}
                        >
                          <CheckCircle2
                            size={13}
                            className={isActivating ? 'animate-pulse text-emerald-500' : ''}
                          />
                        </IconButton>
                      )}
                      <IconButton
                        label={t('Delete {name}', { name: item.name })}
                        className="h-7 w-7 opacity-0 hover:text-rose-600 group-hover:opacity-100 dark:hover:text-rose-400"
                        onClick={() => setDeleteTarget({ id: item.id, name: item.name })}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                )
              })}
              {!datasets.length && (
                <p className="px-3 py-8 text-center text-[11px] leading-5 text-slate-400">
                  {t('No datasets yet. Upload a file or load the demo dataset.')}
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="xl:col-span-8">
          {!selectedDataset && (
            <Card className="flex min-h-[460px] items-center justify-center p-6">
              <EmptyState
                icon={<FolderOpen size={24} />}
                title={t('No dataset selected')}
                description={t(
                  'Upload a business dataset or load the labelled demo dataset to explore quality profiling, column mapping and cleaning.',
                )}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => fileInputRef.current?.click()} icon={<UploadCloud size={14} />}>
                      {t('Upload data')}
                    </Button>
                    <Button
                      variant="secondary"
                      loading={loadDemo.isPending}
                      onClick={() => loadDemo.mutate()}
                      icon={<Sparkles size={14} />}
                    >
                      {t('Load demo')}
                    </Button>
                  </div>
                }
              />
            </Card>
          )}

          {selectedDataset && (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={selectedDataset.is_active ? 'green' : 'slate'}>
                        {selectedDataset.is_active ? t('Active for analysis') : t('Inactive')}
                      </Badge>
                      {selectedDataset.is_demo && <Badge tone="amber">{t('Demo dataset')}</Badge>}
                      <Badge tone="blue">{t(titleCase(selectedDataset.status))}</Badge>
                    </div>
                    <h2 className="mt-2 truncate text-xl font-extrabold text-slate-950 dark:text-white">
                      {selectedDataset.name}
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {selectedDataset.original_filename} ·{' '}
                      {t('uploaded {date}', { date: longDate(selectedDataset.created_at) })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!selectedDataset.is_active && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={activatingId === selectedDataset.id}
                        onClick={() => activateDataset(selectedDataset.id)}
                        icon={<CheckCircle2 size={14} />}
                      >
                        {t('Set active')}
                      </Button>
                    )}
                    <IconButton
                      label={t('Delete dataset')}
                      onClick={() =>
                        setDeleteTarget({ id: selectedDataset.id, name: selectedDataset.name })
                      }
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Metric label={t('Rows')} value={formatNumber(selectedDataset.rows)} />
                  <Metric label={t('Columns')} value={formatNumber(selectedDataset.columns)} />
                  <Metric label={t('Quality score')} value={`${quality}/100`} />
                  <Metric
                    label={t('Date range')}
                    value={
                      selectedDataset.date_min
                        ? `${shortDate(selectedDataset.date_min)} – ${shortDate(selectedDataset.date_max)}`
                        : t('Unavailable')
                    }
                  />
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">{t('Data quality')}</span>
                    <span className="font-mono text-slate-400">{Math.round(quality)}%</span>
                  </div>
                  <Progress
                    value={quality}
                    indicatorClassName={quality >= 80 ? 'bg-emerald-500' : quality >= 60 ? 'bg-amber-500' : 'bg-rose-500'}
                  />
                </div>
              </Card>

              <Tabs
                tabs={[
                  { value: 'quality', label: t('Quality profile') },
                  { value: 'columns', label: t('Columns'), count: columns.length },
                  { value: 'preview', label: t('Data preview') },
                  { value: 'mapping', label: t('Mapping & cleaning') },
                ]}
                value={tab}
                onChange={setTab}
              />

              {profile.isLoading && <Card className="p-5"><SkeletonRows rows={7} /></Card>}
              {profile.isError && (
                <ErrorState
                  error={profile.error as Error}
                  retry={() => profile.refetch()}
                  title={t('Profile unavailable')}
                />
              )}

              {profileData && tab === 'quality' && (
                <div className="space-y-4">
                  <Card className="p-5">
                    <h3 className="section-title">{t('Quality checks')}</h3>
                    <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                      <Metric
                        label={t('Missing cells')}
                        value={formatNumber(profileData.missing_cells)}
                        hint={formatPercent(profileData.missing_pct)}
                      />
                      <Metric
                        label={t('Duplicate rows')}
                        value={formatNumber(profileData.duplicate_rows)}
                        hint={formatPercent(profileData.duplicate_pct)}
                      />
                      <Metric label={t('Invalid dates')} value={formatNumber(profileData.invalid_dates)} />
                      <Metric
                        label={t('Outlier columns')}
                        value={formatNumber(profileData.numeric_outliers.length)}
                        hint={t('IQR-based inspection')}
                      />
                    </div>
                    {profileData.numeric_outliers.length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 dark:border-white/[0.06]">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t('Numeric column')}</th>
                              <th className="text-right">{t('Outliers')}</th>
                              <th className="text-right">{t('Lower fence')}</th>
                              <th className="text-right">{t('Upper fence')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profileData.numeric_outliers.map((outlier) => (
                              <tr key={outlier.column}>
                                <td className="font-mono text-[10px]">{outlier.column}</td>
                                <td className="text-right">{formatNumber(outlier.count)}</td>
                                <td className="text-right font-mono text-[10px]">{formatNumber(outlier.lower_bound, 2)}</td>
                                <td className="text-right font-mono text-[10px]">{formatNumber(outlier.upper_bound, 2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>

                  <Card className="p-5">
                    <h3 className="section-title">{t('Available analysis capabilities')}</h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                      {t(
                        'Capabilities are derived from the detected business fields. Unsupported analyses are explicitly disabled rather than estimated from unrelated columns.',
                      )}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {capabilities.map((capability) => (
                        <div
                          key={capability.key}
                          className={cn(
                            'flex items-start gap-2.5 rounded-xl border p-3',
                            capability.available
                              ? 'border-emerald-100 bg-emerald-50/50 dark:border-emerald-500/15 dark:bg-emerald-500/[0.05]'
                              : 'border-slate-100 bg-slate-50/50 dark:border-white/[0.06] dark:bg-white/[0.02]',
                          )}
                        >
                          {capability.available ? (
                            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                          ) : (
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />
                          )}
                          <div>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                              {capability.label}
                            </p>
                            <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{capability.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {guidance.length > 0 && (
                    <Card className="p-5">
                      <h3 className="section-title">{t('Missing data guidance')}</h3>
                      <div className="mt-3 space-y-2">
                        {guidance.map((item) => (
                          <div key={item.field} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 dark:border-amber-500/15 dark:bg-amber-500/[0.05]">
                            <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                              {item.label} · {item.description}
                            </p>
                            <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                              {item.suggestion}
                            </p>
                            {item.affected.length > 0 && (
                              <p className="mt-1 text-[9px] text-slate-400">
                                {t('Affects: {fields}', { fields: item.affected.join(', ') })}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              )}

              {profileData && tab === 'columns' && (
                <Card className="overflow-hidden">
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06] sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="section-title">{t('Column profile')}</h3>
                      <p className="text-[10px] text-slate-400">
                        {t('Types, missingness, cardinality and sample values')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative">
                        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input
                          value={columnSearch}
                          onChange={(event) => setColumnSearch(event.target.value)}
                          placeholder={t('Find column…')}
                          className="h-9 w-full pl-8 text-xs sm:w-52"
                        />
                      </div>
                      <Select
                        value={columnSort}
                        onChange={(event) => setColumnSort(event.target.value as 'dataset' | 'missing')}
                        className="h-9 w-full text-xs sm:w-40"
                      >
                        <option value="dataset">{t('Dataset order')}</option>
                        <option value="missing">{t('Most missing first')}</option>
                      </Select>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('Column')}</th>
                          <th>{t('Type')}</th>
                          <th className="text-right">{t('Missing')}</th>
                          <th className="text-right">{t('Non-null')}</th>
                          <th className="text-right">{t('Unique')}</th>
                          <th>{t('Sample values')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredColumns.map((column) => (
                          <tr key={column.name}>
                            <td className="font-mono text-[10px] font-semibold">{column.name}</td>
                            <td className="text-[10px] text-slate-400">{column.pandas_dtype}</td>
                            <td className="text-right">
                              <span
                                className={cn(
                                  'font-mono text-[10px]',
                                  column.missing_pct > 20
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : column.missing_pct > 0
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-slate-400',
                                )}
                              >
                                {formatNumber(column.missing)} ({formatPercent(column.missing_pct)})
                              </span>
                            </td>
                            <td className="text-right font-mono text-[10px]">{formatNumber(column.non_null)}</td>
                            <td className="text-right font-mono text-[10px]">{formatNumber(column.unique)}</td>
                            <td className="max-w-[280px] truncate text-[10px] text-slate-400">
                              {column.sample?.length ? column.sample.join(', ') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!filteredColumns.length && (
                    <p className="px-4 py-10 text-center text-[11px] text-slate-400">
                      {t('No columns match this search.')}
                    </p>
                  )}
                </Card>
              )}

              {tab === 'preview' && (
                <Card className="overflow-hidden">
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="section-title">{t('Row preview')}</h3>
                      <p className="text-[10px] text-slate-400">
                        {preview.data?.source === 'original'
                          ? t('Showing original uploaded data')
                          : t('Showing cleaned data')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-1.5 dark:border-white/[0.06]">
                        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          {t('Original')}
                        </span>
                        <Toggle
                          checked={rawPreview}
                          onChange={setRawPreview}
                          label={t('Preview original data')}
                        />
                      </div>
                      <Select
                        value={previewSize}
                        onChange={(event) => {
                          setPreviewSize(Number(event.target.value))
                          setPreviewPage(0)
                        }}
                        className="h-9 w-28 text-xs"
                      >
                        <option value={25}>{t('{count} rows', { count: 25 })}</option>
                        <option value={50}>{t('{count} rows', { count: 50 })}</option>
                        <option value={100}>{t('{count} rows', { count: 100 })}</option>
                        <option value={MAX_PREVIEW}>{t('{count} rows', { count: 200 })}</option>
                      </Select>
                    </div>
                  </div>
                  {preview.isLoading && <div className="p-4"><SkeletonRows rows={8} /></div>}
                  {preview.isError && (
                    <div className="p-4">
                      <ErrorState
                        error={preview.error as Error}
                        retry={() => preview.refetch()}
                        title={t('Preview unavailable')}
                      />
                    </div>
                  )}
                  {preview.data && (
                    <>
                      <div className="max-h-[560px] overflow-auto">
                        <table className="data-table min-w-full">
                          <thead className="sticky top-0 z-10">
                            <tr>
                              <th className="w-12">#</th>
                              {previewColumns.map((column) => (
                                <th key={column} className="whitespace-nowrap font-mono text-[9px]">{column}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.data.items.map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                <td className="font-mono text-[9px] text-slate-400">
                                  {preview.data.offset + rowIndex + 1}
                                </td>
                                {previewColumns.map((column) => (
                                  <td key={column} className="max-w-[260px] truncate whitespace-nowrap text-[10px]">
                                    {cellText(row[column])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 dark:border-white/[0.06]">
                        <p className="text-[10px] text-slate-400">
                          {t('{count} rows · page {page} of {pages}', {
                            count: formatNumber(totalPreview),
                            page: previewPage + 1,
                            pages: previewPages,
                          })}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={previewPage === 0}
                            onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}
                          >
                            {t('Previous')}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={previewPage + 1 >= previewPages}
                            onClick={() => setPreviewPage((page) => Math.min(previewPages - 1, page + 1))}
                          >
                            {t('Next')}
                          </Button>
                        </div>
                      </div>
                      {!preview.data.items.length && (
                        <p className="px-4 py-10 text-center text-[11px] text-slate-400">{t('No rows available.')}</p>
                      )}
                    </>
                  )}
                </Card>
              )}

              {profileData && tab === 'mapping' && (
                <div className="space-y-4">
                  <Card className="overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
                      <h3 className="section-title flex items-center gap-2">
                        <Layers size={14} /> {t('Detected field mapping')}
                      </h3>
                      <p className="text-[10px] text-slate-400">
                        {t('Business semantics inferred from column names and content.')}
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t('Business field')}</th>
                            <th>{t('Mapped column')}</th>
                            <th>{t('Method')}</th>
                            <th className="text-right">{t('Confidence')}</th>
                            <th>{t('Derived')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mapping.map((field) => (
                            <tr key={field.field}>
                              <td className="text-[11px] font-bold">{t(field.label)}</td>
                              <td className="font-mono text-[10px]">{field.column ?? '—'}</td>
                              <td className="text-[10px] text-slate-400">{t(titleCase(field.method))}</td>
                              <td className="text-right font-mono text-[10px]">{formatPercent(field.confidence)}</td>
                              <td>
                                {field.derived ? (
                                  <Badge tone="blue">{t('Derived')}</Badge>
                                ) : (
                                  <span className="text-[10px] text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <Card className="p-5">
                    <h3 className="section-title flex items-center gap-2">
                      <Wand2 size={14} /> {t('Cleaning controls')}
                    </h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                      {t(
                        'Cleaning writes a separate cleaned CSV, rebuilds the profile and makes the cleaned copy active. The original upload is preserved.',
                      )}
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {[
                        {
                          key: 'drop_duplicates' as const,
                          title: t('Remove duplicate rows'),
                          description: t('Drop exact duplicate records.'),
                        },
                        {
                          key: 'drop_missing_dates' as const,
                          title: t('Remove missing dates'),
                          description: t('Drop rows without a parseable order date.'),
                        },
                        {
                          key: 'drop_invalid_values' as const,
                          title: t('Remove invalid numeric values'),
                          description: t('Drop rows with non-numeric mapped numeric fields.'),
                        },
                        {
                          key: 'fill_missing_category' as const,
                          title: t('Fill missing categories'),
                          description: t('Replace blank category labels with “Uncategorized”.'),
                        },
                      ].map((option) => (
                        <div
                          key={option.key}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/[0.06]"
                        >
                          <div>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{option.title}</p>
                            <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{option.description}</p>
                          </div>
                          <Toggle
                            checked={cleanOptions[option.key]}
                            onChange={(checked) => setCleanOptions((current) => ({ ...current, [option.key]: checked }))}
                            label={option.title}
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      className="mt-4"
                      loading={clean.isPending}
                      onClick={() => clean.mutate()}
                      icon={<Wand2 size={14} />}
                    >
                      {t('Apply cleaning')}
                    </Button>
                    {clean.isError && (
                      <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{(clean.error as Error).message}</p>
                    )}
                  </Card>

                  <Card className="p-5">
                    <h3 className="section-title flex items-center gap-2">
                      <FileSpreadsheet size={14} /> {t('Cleaning report')}
                    </h3>
                    {cleaningReport ? (
                      <>
                        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                          <Metric
                            label={t('Original rows')}
                            value={formatNumber(cleaningReport.original_rows)}
                          />
                          <Metric label={t('Rows removed')} value={formatNumber(cleaningReport.removed_rows)} />
                          <Metric label={t('Saved rows')} value={formatNumber(cleaningReport.saved_rows)} />
                          <Metric
                            label={t('Duplicates removed')}
                            value={formatNumber(cleaningReport.duplicates_removed)}
                          />
                        </div>
                        {Array.isArray(cleaningReport.transformations) && cleaningReport.transformations.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {cleaningReport.transformations.map((transformation: string, index: number) => (
                              <p key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                                <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                                {transformation}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-[11px] leading-5 text-slate-400">
                        {t(
                          'This dataset has not been cleaned yet. Apply cleaning options above to create a cleaned copy and a traceable cleaning report.',
                        )}
                      </p>
                    )}
                  </Card>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-[10px] leading-4 text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <Table2 size={13} className="shrink-0" />
                    <span>
                      {t(
                        'Data operations are limited to profiling, mapping and cleaning. Arbitrary user code is never executed by the platform.',
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('Delete dataset?')}
        subtitle={t(
          'All saved analyses and reports remain, but this dataset and its stored files will be removed.',
        )}
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
              {t('Delete dataset')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t('{name} will be deleted along with its original and cleaned data files. This cannot be undone.', {
            name: deleteTarget?.name ?? '',
          })}
        </p>
        {remove.isError && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{(remove.error as Error).message}</p>
        )}
      </Modal>
    </div>
  )
}
