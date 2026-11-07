import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Inbox,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { cn, formatPercent, type UiTone } from '../lib/utils'
import { useI18n } from '../i18n/language-context'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants[variant], size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  className,
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={cn('icon-btn', className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

const badgeClasses: Record<UiTone, string> = {
  blue: 'badge-blue',
  green: 'badge-green',
  amber: 'badge-amber',
  red: 'badge-red',
  slate: 'badge-slate',
}

export function Badge({
  tone = 'slate',
  children,
  className,
  dot = false,
}: {
  tone?: UiTone
  children: ReactNode
  className?: string
  dot?: boolean
}) {
  return (
    <span className={cn(badgeClasses[tone], className)}>
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            tone === 'green' && 'bg-emerald-500',
            tone === 'blue' && 'bg-brand-500',
            tone === 'amber' && 'bg-amber-500',
            tone === 'red' && 'bg-rose-500',
            tone === 'slate' && 'bg-slate-400',
          )}
        />
      )}
      {children}
    </span>
  )
}

export function Card({
  children,
  className,
  hover = false,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}) {
  return <div className={cn('card', hover && 'card-hover', className)}>{children}</div>
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: string
  children: ReactNode
  className?: string
  hint?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="animate-fade-up">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="max-w-3xl">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-balance text-2xl font-extrabold text-slate-950 dark:text-white sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  helper,
  trend,
  icon,
  tone = 'blue',
  className,
}: {
  label: string
  value: ReactNode
  helper?: string
  trend?: number | null
  icon?: ReactNode
  tone?: 'blue' | 'cyan' | 'green' | 'violet' | 'amber' | 'rose'
  className?: string
}) {
  const tones = {
    blue: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
    cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  }

  return (
    <Card className={cn('group relative overflow-hidden p-5', className)} hover>
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-brand-500/10 to-cyan-400/10 blur-2xl transition-transform duration-300 group-hover:scale-125" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">
            {value}
          </p>
        </div>
        {icon && (
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tones[tone])}>
            {icon}
          </div>
        )}
      </div>
      <div className="relative mt-3 flex min-h-5 flex-wrap items-center gap-2">
        {trend !== undefined && trend !== null && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs font-bold',
              trend >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400',
            )}
          >
            {trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {formatPercent(trend, true)}
          </span>
        )}
        {helper && <p className="line-clamp-1 text-xs text-slate-400">{helper}</p>}
      </div>
    </Card>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-14 text-center dark:border-white/10 dark:bg-white/[0.025]">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-500">
        {icon ?? <Inbox size={22} />}
      </div>
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  retry,
  title,
}: {
  error: Error | null
  retry?: () => void
  title?: string
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/60 px-6 py-12 text-center dark:border-rose-500/20 dark:bg-rose-500/[0.06]">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
        <AlertTriangle size={20} />
      </div>
      <h3 className="text-sm font-bold text-rose-900 dark:text-rose-100">{title ?? t('Something went wrong')}</h3>
      <p className="mt-1.5 max-w-lg text-sm leading-6 text-rose-700/80 dark:text-rose-200/70">
        {error?.message ?? t('An unexpected error occurred.')}
      </p>
      {retry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={retry} icon={<RefreshCw size={14} />}>
          {t('Try again')}
        </Button>
      )}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn('skeleton h-32', className)} />
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-12" style={{ opacity: 1 - index * 0.1 }} />
      ))}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const titleId = useId()
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'glass relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 py-4 dark:border-white/10 sm:px-6">
          <div>
            <h2 id={titleId} className="text-lg font-extrabold text-slate-950 dark:text-white">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <IconButton label={t('Close dialog')} onClick={onClose} className="-mr-1 -mt-1">
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/70 bg-white/60 px-5 py-4 dark:border-white/10 dark:bg-slate-900/60 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-slate-100/60 p-1 dark:border-white/10 dark:bg-white/[0.04]',
        className,
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition',
            value === tab.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-white/10">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  value: number
  className?: string
  indicatorClassName?: string
}) {
  return (
    <div className={cn('progress-track', className)}>
      <div
        className={cn('progress-bar transition-all duration-500', indicatorClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors',
        checked ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function InlineNote({
  children,
  tone = 'blue',
}: {
  children: ReactNode
  tone?: 'blue' | 'amber' | 'green' | 'success' | 'danger'
}) {
  const tones = {
    blue: 'border-brand-200 bg-brand-50/70 text-brand-800 dark:border-brand-500/20 dark:bg-brand-500/[0.07] dark:text-brand-200',
    amber:
      'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/[0.07] dark:text-amber-200',
    green:
      'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07] dark:text-emerald-200',
    success:
      'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07] dark:text-emerald-200',
    danger:
      'border-rose-200 bg-rose-50/70 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/[0.07] dark:text-rose-200',
  }
  return <div className={cn('rounded-xl border px-4 py-3 text-xs leading-5', tones[tone])}>{children}</div>
}
