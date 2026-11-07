import type { ReactNode } from 'react'
import { ArrowUpRight, Lightbulb } from 'lucide-react'
import { cn } from '../lib/utils'
import type { Insight } from '../lib/types'
import { useI18n } from '../i18n/language-context'
import { Badge } from './ui'

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={cn('card p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  )
}

export function Metric({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]', className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-1.5 text-lg font-extrabold text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{hint}</p>}
    </div>
  )
}

const insightStyles: Record<string, { dot: string; tone: 'green' | 'amber' | 'blue' }> = {
  positive: { dot: 'bg-emerald-500', tone: 'green' },
  warning: { dot: 'bg-amber-500', tone: 'amber' },
  opportunity: { dot: 'bg-brand-500', tone: 'blue' },
  info: { dot: 'bg-cyan-500', tone: 'blue' },
}

export function InsightList({ insights, compact = false }: { insights: Insight[]; compact?: boolean }) {
  const { t } = useI18n()
  if (!insights.length) {
    return <p className="py-6 text-center text-xs text-slate-400">{t('No insight was generated for this dataset.')}</p>
  }
  return (
    <div className={cn('space-y-3', compact && 'space-y-2.5')}>
      {insights.map((insight, index) => {
        const style = insightStyles[insight.type] ?? insightStyles.info
        return (
          <div
            key={`${insight.title}-${index}`}
            className="group rounded-xl border border-slate-100 bg-white/60 px-3.5 py-3 transition-colors hover:border-slate-200 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/10"
          >
            <div className="flex items-start gap-2.5">
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{insight.title}</p>
                  <Badge tone={style.tone} className="px-1.5 py-0.5 text-[9px]">
                    {t(insight.type)}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{insight.detail}</p>
                {insight.evidence && (
                  <p className="mt-1 font-mono text-[10px] leading-4 text-slate-400">{insight.evidence}</p>
                )}
                {insight.action && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                    <ArrowUpRight size={12} className="mt-0.5 shrink-0" />
                    {insight.action}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EvidenceNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-[10px] leading-4 text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <Lightbulb size={13} className="mt-0.5 shrink-0 text-amber-500" />
      <span>{children}</span>
    </div>
  )
}

export function DemoNotice({ isDemo }: { isDemo: boolean }) {
  const { t } = useI18n()
  if (!isDemo) return null
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-2.5 text-[11px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/[0.07] dark:text-amber-200">
      <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">
        {t('Demo')}
      </span>
      {t(
        'You are exploring the built-in demo dataset. Figures are illustrative sample data, not real business results.',
      )}
    </div>
  )
}
