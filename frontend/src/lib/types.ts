export interface ApiEnvelope<T> {
  success: boolean
  data: T
  message?: string | null
}

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
  detail?: string | Array<string | { msg?: string }>
  message?: string
}

export interface Capability {
  key: string
  label: string
  available: boolean
  description: string
}

export interface DatasetSummary {
  id: string
  name: string
  original_filename: string
  status: string
  rows: number
  columns: number
  is_demo: boolean
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  quality_score: number | null
  date_min: string | null
  date_max: string | null
  capabilities: Record<string, boolean>
}

export interface DatasetListData {
  items: DatasetSummary[]
  active_dataset_id: string | null
  total: number
}

export interface ColumnInfo {
  name: string
  dtype: string
  pandas_dtype: string
  missing: number
  missing_pct: number
  non_null: number
  unique: number
  sample: string[]
}

export interface MappingView {
  field: string
  label: string
  column: string | null
  confidence: number
  method: string
  derived: boolean
}

export interface GuidanceItem {
  field: string
  label: string
  description: string
  affected: string[]
  suggestion: string
}

export interface DataProfile {
  rows: number
  columns: number
  missing_cells: number
  missing_pct: number
  duplicate_rows: number
  duplicate_pct: number
  invalid_dates: number
  quality_score: number
  numeric_outliers: Array<{
    column: string
    count: number
    lower_bound: number
    upper_bound: number
  }>
  column_info: ColumnInfo[]
  date_min: string | null
  date_max: string | null
  mapping: MappingView[]
  capabilities: Capability[]
  missing_data_guidance: GuidanceItem[]
}

export interface PreviewData {
  items: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
  columns: ColumnInfo[]
  mapping: MappingView[]
  source: string
}

export interface DatasetProfileData {
  dataset: DatasetSummary
  profile: DataProfile
  cleaning_report: Record<string, any> | null
  mapping: Record<string, any>
}

export interface UploadResult {
  dataset: DatasetSummary
  profile: DataProfile
  preview: Record<string, unknown>[]
}

export interface CleanResult {
  dataset: DatasetSummary
  cleaning_report: Record<string, any>
  profile: DataProfile
  preview: Record<string, unknown>[]
}

export interface TrendPoint {
  date: string
  label: string
  revenue: number
  orders: number
  units: number
}

export interface MonthlyPoint {
  date: string
  label: string
  year: number
  month: number
  revenue: number
  previous_year_revenue: number | null
  previous_year_label: string
  growth_pct: number | null
}

export interface CategoryPoint {
  category: string
  revenue: number
  units: number
  share_pct: number
}

export interface ProductRevenuePoint {
  product: string
  revenue: number
  units: number
  share_pct: number
}

export interface Insight {
  type: 'positive' | 'warning' | 'opportunity' | 'info' | string
  title: string
  detail: string
  evidence?: string
  action?: string
}

export interface TrendForecastPoint {
  date: string
  actual: number | null
  forecast: number | null
  lower: number | null
  upper: number | null
}

export interface ForecastValidationPoint {
  week_ending: string
  actual: number
  predicted: number
}

export interface ForecastMetrics {
  mae: number | null
  mse: number | null
  rmse: number | null
  mape: number | null
  r2: number | null
  n: number
}

export interface ForecastSummary {
  horizon_days: number
  forecast_7d: number
  forecast_30d: number
  forecast_90d: number
  recent_30d_actual: number
  growth_30_pct: number | null
  model: string
  model_label: string
  metrics: ForecastMetrics
  candidates: Array<{
    model: string
    label: string
    metrics: ForecastMetrics
    status: string
    reason?: string
  }>
  trend: string
  validation_quality: string
}

export interface RevenueKpis {
  total_revenue: number
  total_orders: number
  units_sold: number
  customers: number
  average_order_value: number
  growth_pct: number | null
  profit: number | null
  gross_margin_pct: number | null
  inventory_value: number | null
  inventory_value_basis: string | null
  bestseller_rate_pct: number | null
  bestseller_definition: string
  period_growth_pct: number | null
  growth_basis: string
  order_count_basis: string
  revenue_derived: boolean
  profit_available: boolean
}

export interface RevenueData {
  period: {
    start: string
    end: string
    days: number
    granularity: string
    data_start: string
    data_end: string
  }
  kpis: RevenueKpis
  trend: TrendPoint[]
  monthly_comparison: MonthlyPoint[]
  categories: CategoryPoint[]
  products: ProductRevenuePoint[]
  top_customers: Array<{ customer_id: string; revenue: number; orders: number }>
  peak_period: { label: string; revenue: number; date: string } | null
  declining_months: Array<{ label: string; growth_pct: number }>
  insights: Insight[]
  data_context: Record<string, any>
}

export interface RevenueForecastData {
  summary: ForecastSummary
  series: TrendForecastPoint[]
  weekly_history: Array<{ date: string; actual: number }>
  weekly_forecast: Array<{ date: string; forecast: number }>
  validation: ForecastValidationPoint[]
  insights: Insight[]
  notes: string[]
  data_context: Record<string, any>
}

export interface DashboardKpis {
  total_revenue: number
  total_orders: number
  units_sold: number
  total_customers: number
  average_order_value: number
  inventory_value: number | null
  revenue_growth_pct: number | null
  growth_basis: string
  bestseller_rate_pct: number | null
  bestseller_definition: string
  gross_margin_pct: number | null
  profit_available: boolean
  period_growth_pct: number | null
  revenue_derived: boolean
}

export interface InventorySummary {
  products_analyzed: number
  total_inventory_value: number
  status_counts: Record<string, number>
  critical_low_count: number
  dead_stock_count: number
  overstock_count: number
  optimal_count: number
  review_required_count: number
  critical_low_recent_revenue: number
  dead_stock_value: number
  average_coverage_days: number | null
  health_score: number
  high_priority_products: Array<{
    product: string
    status: string
    coverage_days: number | null
    stock: number
  }>
}

export interface CustomerCluster {
  cluster: number
  segment: string
  count: number
  share_pct: number
  avg_recency_days: number
  avg_frequency: number
  avg_monetary: number
  avg_order_value: number
  avg_tenure_days: number
}

export interface SegmentDistribution {
  segment: string
  count: number
}

export interface ChurnRiskDistribution {
  risk: string
  count: number
}

export interface DashboardData {
  period: {
    start: string
    end: string
    days: number
    granularity: string
    data_start: string
    data_end: string
  }
  kpis: DashboardKpis
  charts: {
    revenue_trend: TrendPoint[]
    monthly_comparison: MonthlyPoint[]
    top_products: Array<{ product: string; units: number; revenue: number }>
    category_revenue: CategoryPoint[]
    inventory_status: Array<{ status: string; count: number }>
    customer_segments: SegmentDistribution[]
    actual_vs_forecast: TrendForecastPoint[]
  }
  forecast: {
    summary: ForecastSummary
    actual_vs_forecast: TrendForecastPoint[]
    validation: ForecastValidationPoint[]
  }
  inventory: {
    available: boolean
    summary: InventorySummary | null
    top_risks: InventorySummary['high_priority_products']
    reason: string | null
  }
  customers: {
    available: boolean
    metrics: Record<string, any> | null
    clusters: CustomerCluster[]
    reason: string | null
  }
  products: {
    summary: ProductSummary | null
    top_future_best_sellers: Array<{
      product: string
      forecast_30d: number
      recent_30_units: number
    }>
    fastest_growing: {
      product: string
      growth_pct: number
      forecast_30d: number
    } | null
  }
  insights: Insight[]
  priority_actions: Array<{
    priority: string
    area: string
    action: string
    reason: string
  }>
  data_context: {
    data_through: string
    revenue_derived: boolean
    inventory_point_in_time: string
    notes: string[]
  }
}

export interface ProductForecast {
  product: string
  product_id: string | null
  category: string
  units_sold: number
  revenue: number
  recent_30_units: number
  previous_30_units: number
  recent_30_revenue: number
  growth_pct: number | null
  current_stock: number | null
  days_since_last_sale: number
  forecast_7d: number | null
  forecast_30d: number | null
  forecast_60d: number | null
  forecast_90d: number | null
  forecast_30_growth_pct: number | null
  model: string | null
  metrics: (ForecastMetrics & { validation_weeks?: number }) | null
  validation_quality: string
  potential: string
  potential_score: number | null
  rank?: number | null
  trend: string
  explanation: string
  status: string
}

export interface ProductSummary {
  total_products: number
  products_in_list: number
  forecasted_products: number
  total_forecast_30d: number
  rising_products: number
  declining_products: number
  high_potential_products: number
  model_mix: Array<{ model: string; count: number }>
  training_window: { start: string; end: string }
}

export interface ProductForecastData {
  products: ProductForecast[]
  summary: ProductSummary
  chart_data: {
    top_future_best_sellers: Array<{
      product: string
      forecast_30d: number
      recent_30_units: number
    }>
    growth_comparison: Array<{
      product: string
      recent_30_units: number
      forecast_30d: number
      growth_pct: number | null
    }>
  }
  notes: string[]
  data_context: Record<string, any>
}

export interface ProductCatalogItem {
  product: string
  product_id: string | null
  category: string
  units_sold: number
  revenue: number
  orders: number
  recent_30_units: number
  previous_30_units: number
  recent_30_revenue: number
  growth_pct: number | null
  days_since_last_sale: number
  current_stock: number | null
}

export interface ProductCatalogData {
  items: ProductCatalogItem[]
  total: number
  limit: number
  offset: number
  categories: string[]
  data_context: Record<string, any>
}

export interface ProductDetailData {
  product: {
    product: string
    product_id: string | null
    category: string
    units_sold: number
    revenue: number
    recent_30_units: number
    recent_30_revenue: number
    current_stock: number | null
  }
  forecast: {
    model: string
    model_label: string
    metrics: ForecastMetrics
    forecast_7d: number
    forecast_30d: number
    forecast_90d: number
    growth_30_pct: number | null
    validation_quality: string
    candidates: ForecastSummary['candidates']
    notes: string[]
  }
  series: TrendForecastPoint[]
  validation: ForecastValidationPoint[]
  factors: string[]
}

export interface InventoryItem {
  product: string
  product_id: string | null
  category: string
  abc_class: string
  current_stock: number
  recent_30_units: number
  forecast_30d: number | null
  forecast_60d: number | null
  forecast_90d: number | null
  average_daily_forecast: number | null
  coverage_days: number | null
  stockout_date: string | null
  status: string
  days_since_last_sale: number
  reorder_point: number
  safety_stock: number
  eoq: number | null
  eoq_note: string | null
  suggested_order_qty: number
  excess_units_vs_60d: number
  projected_stock: {
    day_30: number | null
    day_60: number | null
    day_90: number | null
  }
  inventory_value: number | null
  unit_value: number | null
  value_basis: string
  recent_30_revenue: number
}

export interface InventoryRecommendation {
  product: string
  status: string
  current_stock: number
  forecast_30d: number | null
  coverage_days: number | null
  priority: string
  impact_rank: number
  issue: string
  cause: string
  evidence: string[]
  actions: string[]
  expected_impact: string
}

export interface InventoryAssumptions {
  lead_time_days: number
  service_level: number
  z_value: number
  ordering_cost_per_order: number
  annual_holding_rate_on_unit_cost: number
  safety_stock_formula: string
  reorder_point_formula: string
  eoq_formula: string
  coverage_formula: string
  notes: string[]
}

export interface InventoryData {
  available: boolean
  reason: string | null
  missing_fields: string[]
  guidance: GuidanceItem[]
  assumptions: InventoryAssumptions | null
  summary: InventorySummary | null
  items: InventoryItem[]
  recommendations: InventoryRecommendation[]
  chart_data?: {
    status_distribution: Array<{ status: string; count: number }>
    abc_distribution: Array<{ class: string; count: number }>
    coverage_vs_stock: Array<{
      product: string
      stock: number
      forecast_30d: number | null
      status: string
    }>
  }
  data_context?: Record<string, any>
}

export interface CustomerRecord {
  customer_id: string
  segment: string | null
  cluster: number | null
  recency_days: number
  frequency: number
  monetary: number
  average_order_value: number
  tenure_days: number
  distinct_products: number
  last_purchase: string | null
  churn_probability?: number | null
  churn_risk?: string | null
}

export interface SegmentData {
  available: boolean
  reason: string | null
  method?: string
  k?: number
  metrics: {
    silhouette_score: number | null
    davies_bouldin_index: number | null
    inertia: number
    customers: number
    features: string[]
  } | null
  clusters: CustomerCluster[]
  segment_distribution: SegmentDistribution[]
  customers: CustomerRecord[]
  chart_data?: {
    scatter: Array<{
      customer_id: string
      recency_days: number
      monetary: number
      frequency: number
      segment: string
    }>
    segment_value: Array<{ segment: string; count: number; avg_monetary: number }>
  }
  guidance: GuidanceItem[]
  data_context: { data_through: string; as_of: string }
}

export interface ChurnCustomer {
  customer_id: string
  segment: string
  recency_days: number
  frequency: number
  monetary: number
  churn_probability: number
  churn_risk: string
  churn_label: number
  actions: string[]
}

export interface ChurnData {
  available: boolean
  reason: string | null
  metrics: {
    model: string
    accuracy: number
    precision: number
    recall: number
    f1: number
    roc_auc: number | null
    confusion_matrix: { tn: number; fp: number; fn: number; tp: number }
    test_size: number
    training_size: number
    candidate_selection: Array<{ model: string; validation_roc_auc: number | null }>
    label_definition: string
    excludes_label_source: boolean
  } | null
  risk_thresholds?: { high: number; medium: number }
  risk_distribution: ChurnRiskDistribution[]
  feature_importance?: Array<{ feature: string; importance: number }>
  customers: ChurnCustomer[]
  churn_labels_count?: { churned: number; retained: number }
  guidance?: GuidanceItem[]
  data_context?: { data_through: string; inactive_threshold_days: number }
}

export interface CustomerDirectoryData {
  items: CustomerRecord[]
  total: number
  limit: number
  offset: number
  segments: string[]
  churn_available: boolean
  churn_metrics: ChurnData['metrics']
}

export interface RecommendationData {
  customer: {
    customer_id: string
    segment: string | null
    frequency: number
    monetary: number
    recency_days: number
    average_order_value: number
    purchased_products: number
  }
  recommendations: Array<{
    product: string
    category: string
    median_price: number | null
    match_score: number
    already_purchased: boolean
    reasons: string[]
    components: {
      category_affinity: number
      co_purchase_affinity: number
      recent_popularity: number
      price_fit: number
    }
  }>
  method: string
  score_note: string
  data_context: Record<string, any>
}

export interface AgentStep {
  key: string
  label: string
  status: string
  started_at: string | null
  completed_at: string | null
  summary: string | null
  error: string | null
  result_summary?: Record<string, unknown> | null
}

export interface AgentProposalTask {
  id: string
  label: string
  description: string
  available: boolean
  selected: boolean
  reason?: string
}

export interface AgentRun {
  id: string
  dataset_id: string
  mode: 'auto' | 'hitl'
  objective: string
  status: string
  steps: AgentStep[]
  proposal: {
    objective?: string
    summary?: string
    dataset?: {
      id?: string
      name?: string
      rows?: number
      quality_score?: number | null
      date_range?: { start?: string | null; end?: string | null }
      is_demo?: boolean
    }
    data_quality_findings?: string[]
    missing_fields?: GuidanceItem[]
    human_checkpoint?: string
    proposed_tasks?: AgentProposalTask[]
    assumptions?: string[]
    data_context?: Record<string, any>
  } | null
  result: Record<string, any> | null
  selected_tasks: string[]
  notes: string
  error: string | null
  llm_used: boolean
  duration_seconds: number | null
  created_at: string | null
  updated_at: string | null
  completed_at: string | null
  dataset_name?: string
}

export interface AgentRunListData {
  items: AgentRun[]
  total: number
}

export interface BenchmarkData {
  benchmark_id?: string
  created_at?: string
  task: string
  task_label: string
  target: string
  unit?: string
  frequency?: string
  human_model: string
  ai_model: string
  ai_validation_metrics?: {
    validation_mae: number | null
    validation_rmse: number | null
    method: string
  }
  human: {
    model: string
    label: string
    metrics: Record<string, number | null>
    runtime_seconds: number
    validation_roc_auc?: number
  }
  ai: {
    model: string
    label: string
    metrics: Record<string, number | null>
    runtime_seconds: number
    validation_roc_auc?: number
  }
  comparison_table: Array<{
    criterion: string
    human: string | number | null
    ai: string | number | null
    better?: string
  }>
  candidates: Array<Record<string, any>>
  split: Record<string, any>
  chart_data: any
  duration_seconds: number
  metric_notes: string[]
}

export interface BenchmarkListItem {
  id: string
  dataset_id: string
  dataset_name: string | null
  task: string
  human_model: string
  ai_model: string
  results: BenchmarkData
  created_at: string | null
}

export interface BenchmarkListData {
  items: BenchmarkListItem[]
  total: number
}

export interface ReportListItem {
  id: string
  dataset_id: string
  dataset_name: string | null
  title: string
  summary: string
  created_at: string | null
}

export interface ReportListData {
  items: ReportListItem[]
  total: number
}

export interface ReportDetailData {
  id: string
  dataset_id: string
  title: string
  summary: string
  content: Record<string, any>
  created_at: string | null
}

export interface AppSettings {
  app: {
    name: string
    version: string
    environment: string
  }
  llm: {
    configured: boolean
    model: string | null
    provider: string | null
    message: string
  }
  database: {
    backend: string
    configured: boolean
    dataset_count: number
  }
  limits: {
    max_upload_mb: number
    max_agent_runtime_seconds: number
    api_key_enabled: boolean
  }
  models: {
    available: Record<string, string>
    xgboost: boolean
    langgraph: boolean
    prophet: boolean
  }
  sandbox: {
    mode: string
    arbitrary_code_execution: boolean
    description: string
  }
  langsmith: {
    configured: boolean
    tracing_enabled: boolean
    project: string | null
  }
}
