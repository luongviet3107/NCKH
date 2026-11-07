import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { CHART_COLORS } from '../lib/chart-colors'
import { compactNumber, formatCurrency, formatNumber, formatPercent } from '../lib/utils'
import { useI18n } from '../i18n/language-context'

const axisProps = {
  tick: { fill: '#94a3b8', fontSize: 11 },
  tickLine: false,
  axisLine: false,
}

function TooltipBox({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string; payload?: any }>
  label?: string
  valueFormatter?: (value: number, name: string) => string
  labelFormatter?: (label: string, payload?: any) => string
}) {
  if (!active || !payload?.length) return null
  const resolvedLabel = labelFormatter ? labelFormatter(String(label ?? ''), payload[0]?.payload) : label
  return (
    <div className="min-w-[160px] rounded-xl border border-white/10 bg-slate-950/95 px-3.5 py-3 text-xs shadow-2xl backdrop-blur">
      {resolvedLabel && <p className="mb-2 font-bold text-white">{resolvedLabel}</p>}
      <div className="space-y-1.5">
        {payload.map((item) => (
          <div key={`${item.dataKey}-${item.name}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              {item.name}
            </span>
            <span className="font-mono font-semibold text-white">
              {valueFormatter
                ? valueFormatter(Number(item.value ?? 0), String(item.name ?? ''))
                : formatNumber(Number(item.value ?? 0), 1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RevenueTrendChart({
  data,
  height = 290,
}: {
  data: Array<{ label: string; revenue: number; orders: number }>
  height?: number
}) {
  const { t } = useI18n()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b66ff" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#3b66ff" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={20} />
        <YAxis {...axisProps} tickFormatter={(value) => `$${compactNumber(Number(value))}`} width={58} />
        <Tooltip
          content={
            <TooltipBox
              valueFormatter={(value, name) =>
                name === t('Revenue') ? formatCurrency(value) : formatNumber(value)
              }
            />
          }
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name={t('Revenue')}
          stroke="#3b66ff"
          strokeWidth={2.4}
          fill="url(#revenueFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function ForecastChart({
  data,
  height = 300,
  showLegend = true,
}: {
  data: Array<{ date: string; actual: number | null; forecast: number | null; lower?: number | null; upper?: number | null }>
  height?: number
  showLegend?: boolean
}) {
  const { t } = useI18n()
  const rendered = data.map((point) => ({
    ...point,
    label: point.date.slice(5),
  }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rendered} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} tickFormatter={(value) => `$${compactNumber(Number(value))}`} width={58} />
        <Tooltip
          content={
            <TooltipBox
              labelFormatter={(label) => label}
              valueFormatter={(value) => formatCurrency(value)}
            />
          }
        />
        {showLegend && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />}
        <Area
          type="monotone"
          dataKey="actual"
          name={t('Actual')}
          stroke="#06b6d4"
          strokeWidth={2}
          fill="url(#actualFill)"
          dot={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          name={t('Forecast')}
          stroke="#8b5cf6"
          strokeWidth={2.2}
          strokeDasharray="6 4"
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ValidationChart({
  data,
  height = 240,
}: {
  data: Array<{ week_ending: string; actual: number; predicted: number }>
  height?: number
}) {
  const { t } = useI18n()
  const rendered = data.map((row) => ({ ...row, label: row.week_ending.slice(5) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rendered} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(value) => compactNumber(Number(value))} width={52} />
        <Tooltip content={<TooltipBox valueFormatter={(value) => formatNumber(value, 1)} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
        <Line type="monotone" dataKey="actual" name={t('Actual')} stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
        <Line
          type="monotone"
          dataKey="predicted"
          name={t('Predicted')}
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function ComparisonBarChart({
  data,
  xKey,
  series,
  height = 280,
  currency = true,
}: {
  data: Array<Record<string, any>>
  xKey: string
  series: Array<{ key: string; label: string; color: string }>
  height?: number
  currency?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={12} />
        <YAxis
          {...axisProps}
          tickFormatter={(value) => (currency ? `$${compactNumber(Number(value))}` : compactNumber(Number(value)))}
          width={58}
        />
        <Tooltip
          content={
            <TooltipBox
              valueFormatter={(value) => (currency ? formatCurrency(value) : formatNumber(value, 1))}
            />
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
        {series.map((item) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            fill={item.color}
            radius={[6, 6, 0, 0]}
            maxBarSize={38}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({
  data,
  nameKey,
  valueKey,
  colors = CHART_COLORS,
  height = 260,
  currency = false,
  centerLabel,
  showLegend = true,
}: {
  data: Array<Record<string, any>>
  nameKey: string
  valueKey: string
  colors?: string[]
  height?: number
  currency?: boolean
  centerLabel?: { label: string; value: string }
  showLegend?: boolean
}) {
  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              innerRadius="57%"
              outerRadius="82%"
              paddingAngle={3}
              stroke="none"
              animationDuration={700}
            >
              {data.map((entry, index) => (
                <Cell key={String(entry[nameKey])} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              content={
                <TooltipBox
                  valueFormatter={(value) => (currency ? formatCurrency(value) : formatNumber(value))}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {centerLabel && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              {centerLabel.label}
            </span>
            <span className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
              {centerLabel.value}
            </span>
          </div>
        )}
      </div>
      {showLegend && (
        <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
          {data.map((entry, index) => (
            <span
              key={String(entry[nameKey])}
              className="flex max-w-[150px] items-center gap-1.5 text-[9px] font-semibold text-slate-500 dark:text-slate-400"
              title={String(entry[nameKey])}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: colors[index % colors.length] }}
              />
              <span className="truncate">{String(entry[nameKey])}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function HorizontalBarChart({
  data,
  categoryKey,
  valueKey,
  height = 300,
  color = '#3b66ff',
  currency = false,
}: {
  data: Array<Record<string, any>>
  categoryKey: string
  valueKey: string
  height?: number
  color?: string
  currency?: boolean
}) {
  const { t } = useI18n()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} horizontal={false} />
        <XAxis
          type="number"
          {...axisProps}
          tickFormatter={(value) => (currency ? `$${compactNumber(Number(value))}` : compactNumber(Number(value)))}
        />
        <YAxis
          type="category"
          dataKey={categoryKey}
          {...axisProps}
          width={124}
          tickFormatter={(value) => {
            const text = String(value)
            return text.length > 18 ? `${text.slice(0, 17)}…` : text
          }}
        />
        <Tooltip
          content={
            <TooltipBox
              valueFormatter={(value) => (currency ? formatCurrency(value) : formatNumber(value, 1))}
            />
          }
        />
        <Bar dataKey={valueKey} name={currency ? t('Revenue') : t('Value')} fill={color} radius={[0, 6, 6, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CustomerScatter({
  data,
  height = 320,
}: {
  data: Array<{ recency_days: number; monetary: number; segment: string; customer_id: string }>
  height?: number
}) {
  const { t } = useI18n()
  const groups = Array.from(new Set(data.map((row) => row.segment)))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 12, left: -10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} />
        <XAxis
          dataKey="recency_days"
          name={t('Recency')}
          type="number"
          allowDecimals={false}
          {...axisProps}
          tickFormatter={(value) => t('{days}d', { days: value })}
        />
        <YAxis
          dataKey="monetary"
          name={t('Monetary')}
          type="number"
          {...axisProps}
          tickFormatter={(value) => `$${compactNumber(Number(value))}`}
          width={58}
        />
        <ZAxis range={[45, 45]} />
        <Tooltip
          content={
            <TooltipBox
              labelFormatter={(_, payload) => payload?.customer_id ?? ''}
              valueFormatter={(value, name) =>
                name === t('Recency')
                  ? t('{days} days', { days: formatNumber(value) })
                  : formatCurrency(value)
              }
            />
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        {groups.map((group, index) => (
          <Scatter
            key={group}
            name={t(group)}
            data={data.filter((row) => row.segment === group)}
            fill={CHART_COLORS[index % CHART_COLORS.length]}
            fillOpacity={0.65}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

export function MetricBars({
  data,
  height = 270,
  mode = 'percentage',
}: {
  data: Array<{ metric: string; human: number | null; ai: number | null }>
  height?: number
  mode?: 'percentage' | 'raw'
}) {
  const { t } = useI18n()
  const formatValue = (value: number) =>
    mode === 'percentage' ? formatPercent(value * 100) : formatNumber(value, 3)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey="metric" {...axisProps} />
        <YAxis
          {...axisProps}
          width={50}
          tickFormatter={(value) =>
            mode === 'percentage' ? formatPercent(Number(value) * 100, false, 0) : formatNumber(Number(value), 2)
          }
        />
        <Tooltip content={<TooltipBox valueFormatter={(value) => formatValue(value)} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="human" name={t('Human-selected')} fill="#94a3b8" radius={[5, 5, 0, 0]} maxBarSize={30} />
        <Bar dataKey="ai" name={t('AI-selected')} fill="#3b66ff" radius={[5, 5, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function BenchmarkForecastChart({
  data,
  height = 300,
  currency = true,
}: {
  data: Array<{ week_ending: string; actual: number; human_prediction: number; ai_prediction: number }>
  height?: number
  currency?: boolean
}) {
  const { t } = useI18n()
  const rendered = data.map((row) => ({ ...row, label: row.week_ending.slice(5) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rendered} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={16} />
        <YAxis
          {...axisProps}
          width={58}
          tickFormatter={(value) =>
            currency ? `$${compactNumber(Number(value))}` : compactNumber(Number(value))
          }
        />
        <Tooltip
          content={
            <TooltipBox
              valueFormatter={(value) => (currency ? formatCurrency(value) : formatNumber(value, 1))}
            />
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
        <Line type="monotone" dataKey="actual" name={t('Actual')} stroke="#0f172a" strokeWidth={2} dot={false} />
        <Line
          type="monotone"
          dataKey="human_prediction"
          name={t('Human-selected')}
          stroke="#94a3b8"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
        />
        <Line type="monotone" dataKey="ai_prediction" name={t('AI-selected')} stroke="#3b66ff" strokeWidth={2.4} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function RocCurve({
  human,
  ai,
  height = 300,
}: {
  human: Array<{ fpr: number; tpr: number }>
  ai: Array<{ fpr: number; tpr: number }>
  height?: number
}) {
  const { t } = useI18n()
  const merged = Array.from({ length: 51 }, (_, index) => {
    const fpr = index / 50
    const nearest = (points: Array<{ fpr: number; tpr: number }>) =>
      points.reduce(
        (best, point) => (Math.abs(point.fpr - fpr) < Math.abs(best.fpr - fpr) ? point : best),
        points[0] ?? { fpr: 0, tpr: 0 },
      )
    return {
      fpr: Number(fpr.toFixed(2)),
      human: nearest(human).tpr,
      ai: nearest(ai).tpr,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} />
        <XAxis dataKey="fpr" {...axisProps} tickFormatter={(value) => value.toFixed(1)} />
        <YAxis {...axisProps} tickFormatter={(value) => value.toFixed(1)} width={44} />
        <Tooltip content={<TooltipBox valueFormatter={(value) => value.toFixed(3)} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
        <Line type="monotone" dataKey="human" name={t('Human-selected')} stroke="#94a3b8" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="ai" name={t('AI-selected')} stroke="#3b66ff" strokeWidth={2.4} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function ForecastGrowthBars({
  data,
  height = 280,
}: {
  data: Array<{ product: string; recent_30_units: number; forecast_30d: number | null }>
  height?: number
}) {
  const { t } = useI18n()
  const rendered = data.map((row) => ({
    ...row,
    product: row.product.length > 20 ? `${row.product.slice(0, 19)}…` : row.product,
  }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rendered} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barGap={3}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.14} vertical={false} />
        <XAxis dataKey="product" {...axisProps} interval={0} angle={-18} textAnchor="end" height={60} />
        <YAxis {...axisProps} width={46} tickFormatter={(value) => compactNumber(Number(value))} />
        <Tooltip content={<TooltipBox valueFormatter={(value) => formatNumber(value, 1)} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
        <Bar dataKey="recent_30_units" name={t('Recent 30d')} fill="#94a3b8" radius={[5, 5, 0, 0]} maxBarSize={26} />
        <Bar dataKey="forecast_30d" name={t('Forecast 30d')} fill="#3b66ff" radius={[5, 5, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  )
}
