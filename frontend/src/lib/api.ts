import type {
  AgentRun,
  AgentRunListData,
  ApiEnvelope,
  ApiErrorBody,
  AppSettings,
  BenchmarkData,
  BenchmarkListData,
  ChurnData,
  CleanResult,
  CustomerDirectoryData,
  DashboardData,
  DatasetListData,
  DatasetProfileData,
  InventoryData,
  PreviewData,
  ProductCatalogData,
  ProductDetailData,
  ProductForecastData,
  RecommendationData,
  ReportDetailData,
  ReportListData,
  RevenueData,
  RevenueForecastData,
  SegmentData,
  UploadResult,
} from './types'
import { downloadBlob } from './utils'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'

export class ApiError extends Error {
  status: number
  code?: string
  details?: unknown

  constructor(message: string, status = 0, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function errorMessage(payload: ApiErrorBody | null, fallback: string) {
  if (!payload) return fallback
  if (payload.error?.message) return payload.error.message
  if (typeof payload.detail === 'string') return payload.detail
  if (Array.isArray(payload.detail)) {
    return payload.detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) return String(item.msg)
        return 'Yêu cầu không hợp lệ'
      })
      .join(' · ')
  }
  if (payload.message) return payload.message
  return fallback
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('Không thể kết nối API AutoDS. Hãy kiểm tra máy chủ đang chạy trên cổng 8000.', 0, 'network_error')
  }

  const contentType = response.headers.get('content-type') ?? ''
  let payload: unknown = null
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null)
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null
    throw new ApiError(
      errorMessage(body, `Yêu cầu thất bại với mã trạng thái ${response.status}.`),
      response.status,
      body?.error?.code,
      body?.error?.details,
    )
  }

  if (!payload || typeof payload !== 'object') {
    return payload as T
  }

  const envelope = payload as ApiEnvelope<T>
  if (envelope.success === false) {
    throw new ApiError(
      errorMessage(payload as ApiErrorBody, 'API trả về kết quả không thành công.'),
      response.status,
    )
  }
  return envelope.data
}

function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const rendered = query.toString()
  return rendered ? `?${rendered}` : ''
}

export const api = {
  health: () => request<{ status: string; version: string; datasets: number }>('/health'),

  datasets: {
    list: () => request<DatasetListData>('/data/datasets'),
    preview: (datasetId: string, options?: { limit?: number; offset?: number; raw?: boolean }) =>
      request<PreviewData>(
        `/data/preview${qs({
          dataset_id: datasetId,
          limit: options?.limit ?? 25,
          offset: options?.offset ?? 0,
          raw: options?.raw ?? false,
        })}`,
      ),
    profile: (datasetId: string) => request<DatasetProfileData>(`/data/${datasetId}/profile`),
    activate: (datasetId: string) =>
      request<DatasetListData['items'][number]>(`/data/${datasetId}/activate`, { method: 'POST' }),
    delete: (datasetId: string) =>
      request<{ id: string }>(`/data/${datasetId}`, { method: 'DELETE' }),
    loadDemo: () => request<DatasetListData['items'][number]>('/data/demo', { method: 'POST' }),
    clean: (datasetId: string, body: {
      drop_duplicates: boolean
      drop_missing_dates: boolean
      drop_invalid_values: boolean
      fill_missing_category: boolean
    }) =>
      request<CleanResult>(`/data/${datasetId}/clean`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    upload: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return request<UploadResult>('/data/upload', { method: 'POST', body: form })
    },
  },

  dashboard: {
    overview: (datasetId: string, startDate?: string, endDate?: string) =>
      request<DashboardData>(
        `/dashboard/overview${qs({
          dataset_id: datasetId,
          start_date: startDate,
          end_date: endDate,
        })}`,
      ),
  },

  products: {
    catalog: (
      datasetId: string,
      options?: { search?: string; sortBy?: string; limit?: number; offset?: number },
    ) =>
      request<ProductCatalogData>(
        `/products${qs({
          dataset_id: datasetId,
          search: options?.search,
          sort_by: options?.sortBy ?? 'recent_revenue',
          limit: options?.limit ?? 100,
          offset: options?.offset ?? 0,
        })}`,
      ),
    forecast: (datasetId: string, horizonDays = 30, limit = 100) =>
      request<ProductForecastData>('/products/forecast', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: datasetId, horizon_days: horizonDays, limit }),
      }),
    detail: (datasetId: string, product: string, horizonDays = 90) =>
      request<ProductDetailData>('/products/detail-forecast', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: datasetId, product, horizon_days: horizonDays }),
      }),
  },

  inventory: {
    forecast: (
      datasetId: string,
      options?: {
        leadTimeDays?: number
        serviceLevel?: number
        orderingCost?: number
        holdingRate?: number
        limit?: number
      },
    ) =>
      request<InventoryData>('/inventory/forecast', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: datasetId,
          lead_time_days: options?.leadTimeDays ?? 7,
          service_level: options?.serviceLevel ?? 0.95,
          ordering_cost: options?.orderingCost ?? 500,
          holding_rate: options?.holdingRate ?? 0.2,
          limit: options?.limit ?? 150,
        }),
      }),
    recommendations: (
      datasetId: string,
      options?: {
        leadTimeDays?: number
        serviceLevel?: number
        orderingCost?: number
        holdingRate?: number
        priority?: string
        product?: string
      },
    ) =>
      request<InventoryData>('/inventory/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: datasetId,
          lead_time_days: options?.leadTimeDays ?? 7,
          service_level: options?.serviceLevel ?? 0.95,
          ordering_cost: options?.orderingCost ?? 500,
          holding_rate: options?.holdingRate ?? 0.2,
          priority: options?.priority,
          product: options?.product,
        }),
      }),
  },

  customers: {
    segment: (datasetId: string, limit = 100) =>
      request<SegmentData>('/customers/segment', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: datasetId, limit }),
      }),
    churn: (datasetId: string, inactiveDays = 90) =>
      request<ChurnData>('/customers/churn', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: datasetId, inactive_days: inactiveDays }),
      }),
    list: (
      datasetId: string,
      options?: { segment?: string; search?: string; limit?: number; offset?: number },
    ) =>
      request<CustomerDirectoryData>('/customers/list', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: datasetId,
          segment: options?.segment || undefined,
          search: options?.search || undefined,
          limit: options?.limit ?? 100,
          offset: options?.offset ?? 0,
        }),
      }),
    recommend: (datasetId: string, customerId: string, topN = 5) =>
      request<RecommendationData>('/customers/recommend', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: datasetId, customer_id: customerId, top_n: topN }),
      }),
  },

  revenue: {
    analyze: (
      datasetId: string,
      options?: { startDate?: string; endDate?: string; granularity?: 'day' | 'week' | 'month' },
    ) =>
      request<RevenueData>('/revenue/analyze', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: datasetId,
          start_date: options?.startDate,
          end_date: options?.endDate,
          granularity: options?.granularity ?? 'month',
        }),
      }),
    forecast: (datasetId: string, horizonDays = 90) =>
      request<RevenueForecastData>('/revenue/forecast', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: datasetId, horizon_days: horizonDays }),
      }),
  },

  agents: {
    list: (datasetId?: string, limit = 25) =>
      request<AgentRunListData>(
        `/agents/runs${qs({ dataset_id: datasetId, limit })}`,
      ),
    get: (runId: string) => request<AgentRun>(`/agents/runs/${runId}`),
    start: (body: {
      dataset_id: string
      mode: 'auto' | 'hitl'
      objective: string
      agents?: string[]
    }) =>
      request<AgentRun>('/agents/run', { method: 'POST', body: JSON.stringify(body) }),
    approve: (body: {
      run_id: string
      approved: boolean
      selected_tasks?: string[]
      notes?: string
    }) =>
      request<AgentRun>('/agents/approve', { method: 'POST', body: JSON.stringify(body) }),
    reject: (body: { run_id: string; notes?: string }) =>
      request<AgentRun>('/agents/reject', {
        method: 'POST',
        body: JSON.stringify({ run_id: body.run_id, notes: body.notes ?? '', approved: false }),
      }),
    cancel: (runId: string) =>
      request<AgentRun>(`/agents/runs/${runId}/cancel`, { method: 'POST' }),
  },

  models: {
    list: (datasetId?: string, limit = 20) =>
      request<BenchmarkListData>(`/models/benchmarks${qs({ dataset_id: datasetId, limit })}`),
    run: (
      datasetId: string,
      task: string,
      humanModel: string,
      testRatio = 0.2,
    ) =>
      request<BenchmarkData>('/models/benchmark', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: datasetId,
          task,
          human_model: humanModel,
          test_ratio: testRatio,
        }),
      }),
  },

  reports: {
    list: (datasetId?: string, limit = 50) =>
      request<ReportListData>(`/reports${qs({ dataset_id: datasetId, limit })}`),
    get: (reportId: string) => request<ReportDetailData>(`/reports/${reportId}`),
    create: (datasetId: string, title?: string, includeForecast = true) =>
      request<{ id: string; title: string; summary: string; created_at: string }>('/reports', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: datasetId,
          title: title || undefined,
          include_forecast: includeForecast,
        }),
      }),
    delete: (reportId: string) =>
      request<{ id: string }>(`/reports/${reportId}`, { method: 'DELETE' }),
    export: async (reportId: string, format: 'pdf' | 'xlsx', fallbackName = 'AutoDS-report') => {
      let response: Response
      try {
        response = await fetch(`${API_BASE}/reports/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ report_id: reportId, format }),
        })
      } catch {
        throw new ApiError('Không thể kết nối API để xuất báo cáo.', 0, 'network_error')
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorBody | null
        throw new ApiError(
          errorMessage(payload, 'Không thể xuất báo cáo.'),
          response.status,
          payload?.error?.code,
        )
      }
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') ?? ''
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
      const resolved = encoded ? decodeURIComponent(encoded) : plain
      const safeFallback = fallbackName.replace(/[^a-z0-9._-]+/gi, '_')
      downloadBlob(blob, resolved || `${safeFallback}.${format}`)
    },
  },

  settings: {
    get: () => request<AppSettings>('/settings'),
    clearCache: () => request<{ cleared: boolean }>('/settings/cache/clear', { method: 'POST' }),
  },
}
