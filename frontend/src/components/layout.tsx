import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  Languages,
  LayoutDashboard,
  LineChart,
  Loader2,
  Menu,
  Moon,
  Package,
  Settings,
  Sparkles,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../lib/api'
import { cn, formatNumber, shortDate } from '../lib/utils'
import { useDataset } from '../context/dataset-context'
import { useTheme } from '../context/theme-context'
import { useI18n } from '../i18n/language-context'
import { Badge, Button, EmptyState, IconButton, SkeletonRows } from './ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/revenue', label: 'Revenue', icon: LineChart },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/inventory', label: 'Inventory', icon: Boxes },
      { to: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/agents', label: 'AI Agents', icon: Bot },
      { to: '/models', label: 'Model Arena', icon: FlaskConical },
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/data', label: 'Data Studio', icon: Database },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/revenue': 'Revenue intelligence',
  '/products': 'Product intelligence',
  '/inventory': 'Inventory optimization',
  '/customers': 'Customer intelligence',
  '/agents': 'AI Agent Center',
  '/models': 'Model Arena',
  '/reports': 'Decision reports',
  '/data': 'Data Studio',
  '/settings': 'Settings',
}

const DOCS_URL = import.meta.env.DEV ? 'http://127.0.0.1:8000/docs' : '/docs'

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  return (
    <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-1">
      <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-cyan-500 text-white shadow-lg shadow-brand-600/30">
        <BarChart3 size={21} strokeWidth={2.4} />
        <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-white/20 blur-md" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-extrabold tracking-tight text-slate-950 dark:text-white">AutoDS</span>
          <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            v1.0
          </span>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {t('Decision intelligence')}
        </p>
      </div>
    </Link>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-slate-200/70 bg-white/75 backdrop-blur-xl dark:border-white/[0.07] dark:bg-[#080e1d]/90">
      <div className="flex h-[74px] shrink-0 items-center justify-between px-5">
        <Brand onNavigate={onNavigate} />
        {onNavigate && (
          <IconButton label={t('Close navigation')} onClick={onNavigate} className="lg:hidden">
            <X size={18} />
          </IconButton>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-5 pt-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-2 px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t(section.label)}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
                >
                  <item.icon size={17} strokeWidth={2.1} />
                  <span>{t(item.label)}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-3 px-3 pb-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-cyan-600 p-4 text-white shadow-lg shadow-brand-600/20">
          <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10 blur-xl" />
          <div className="relative flex items-center gap-2">
            <Sparkles size={16} className="text-cyan-200" />
            <p className="text-xs font-extrabold tracking-wide">{t('Grounded multi-agent AI')}</p>
          </div>
          <p className="relative mt-1.5 text-[11px] leading-5 text-brand-100/90">
            {t('Six specialist agents analyze real metrics, with a human approval checkpoint.')}
          </p>
          <Link
            to="/agents"
            onClick={onNavigate}
            className="relative mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-white hover:text-cyan-100"
          >
            {t('Open Agent Center')} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="flex items-center justify-between px-2 text-[10px] font-medium text-slate-400">
          <span>{t('AutoDS Decision OS')}</span>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-300"
          >
            {t('API docs')} <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </aside>
  )
}

function DatasetSwitcher() {
  const { datasets, dataset, setActiveDataset, isSwitching } = useDataset()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex max-w-[220px] items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-2 text-left shadow-sm transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20 sm:max-w-[280px] sm:px-3"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          {isSwitching ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">
            {dataset?.name ?? t('No dataset')}
          </span>
          <span className="block truncate text-[10px] font-medium text-slate-400">
            {dataset
              ? t('{rows} rows · through {date}', {
                  rows: formatNumber(dataset.rows),
                  date: shortDate(dataset.date_max),
                })
              : t('Upload or load demo data')}
          </span>
        </span>
        {dataset?.is_demo && (
          <span className="hidden rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 sm:block">
            {t('Demo')}
          </span>
        )}
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t('Close dataset menu')}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-white/5">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">
                {t('Active dataset')}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('Analyses and forecasts use this dataset.')}
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5" role="listbox">
              {datasets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === dataset?.id}
                  disabled={isSwitching}
                  onClick={async () => {
                    if (item.id === dataset?.id) {
                      setOpen(false)
                      return
                    }
                    try {
                      await setActiveDataset(item.id)
                      setOpen(false)
                    } catch {
                      setOpen(false)
                    }
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-60 dark:hover:bg-white/[0.05]',
                    item.id === dataset?.id && 'bg-brand-50/70 dark:bg-brand-500/[0.08]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      item.id === dataset?.id
                        ? 'bg-brand-100 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
                    )}
                  >
                    <Database size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                        {item.name}
                      </span>
                      {item.is_demo && <Badge tone="amber" className="px-1.5 py-0 text-[9px]">{t('Demo')}</Badge>}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {t('{rows} rows · {cols} cols', {
                        rows: formatNumber(item.rows),
                        cols: formatNumber(item.columns),
                      })}
                    </span>
                  </span>
                  {item.id === dataset?.id && <Check size={15} className="shrink-0 text-brand-600 dark:text-brand-300" />}
                </button>
              ))}
              {!datasets.length && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">{t('No datasets available.')}</p>
              )}
            </div>
            <Link
              to="/data"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs font-bold text-brand-600 hover:bg-slate-50 dark:border-white/5 dark:text-brand-300 dark:hover:bg-white/[0.04]"
            >
              {t('Manage datasets')}
              <ExternalLink size={12} />
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { theme, toggleTheme } = useTheme()
  const { language, toggleLanguage, t } = useI18n()
  const location = useLocation()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 20_000,
  })
  const pageTitle = t(PAGE_TITLES[location.pathname] ?? 'Overview')

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-[#f4f7fc]/75 backdrop-blur-xl dark:border-white/[0.07] dark:bg-[#060b17]/75">
      <div className="flex h-[74px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton label={t('Open navigation')} onClick={onOpenMenu} className="lg:hidden">
            <Menu size={20} />
          </IconButton>
          <div className="hidden min-w-0 sm:block">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
              {t('Workspace')}
            </p>
            <h2 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{pageTitle}</h2>
          </div>
          <span className="hidden h-6 w-px bg-slate-200 dark:bg-white/10 sm:block" />
          <div
            className={cn(
              'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold md:inline-flex',
              health.isSuccess
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                : health.isError
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                  : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-rose-500' : 'bg-slate-400',
              )}
            />
            {health.isSuccess
              ? t('API connected')
              : health.isError
                ? t('API offline')
                : t('Checking API')}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <DatasetSwitcher />
          <button
            type="button"
            onClick={toggleLanguage}
            className="icon-btn w-auto gap-1.5 px-2.5 text-[10px] font-extrabold"
            aria-label={language === 'vi' ? t('Switch to English') : t('Switch to Vietnamese')}
            title={language === 'vi' ? t('Switch to English') : t('Switch to Vietnamese')}
          >
            <Languages size={15} />
            {language.toUpperCase()}
          </button>
          <IconButton
            label={theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="icon-btn hidden sm:inline-flex"
            aria-label={t('Open API documentation')}
            title={t('Open API documentation')}
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </div>
    </header>
  )
}

function NoDatasetPanel() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const demo = useMutation({
    mutationFn: api.datasets.loadDemo,
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })

  return (
    <div className="mx-auto max-w-3xl py-10">
      <EmptyState
        icon={<Database size={22} />}
        title={t('Your workspace needs a dataset')}
        description={t(
          'Upload a CSV or Excel file, or load the clearly labelled demo dataset to explore forecasting, inventory, customer intelligence and the multi-agent workflow.',
        )}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => demo.mutate()} loading={demo.isPending} icon={<Sparkles size={15} />}>
              {t('Load demo dataset')}
            </Button>
            <Link to="/data">
              <Button variant="secondary" icon={<Database size={15} />}>
                {t('Upload a dataset')}
              </Button>
            </Link>
          </div>
        }
      />
      {demo.isError && (
        <p className="mt-3 text-center text-xs text-rose-600 dark:text-rose-400">
          {(demo.error as Error).message}
        </p>
      )}
    </div>
  )
}

function DatasetBooting() {
  return (
    <div className="space-y-5 py-8">
      <div className="skeleton h-10 w-64" />
      <SkeletonRows rows={5} />
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { dataset, isLoading } = useDataset()
  const { t } = useI18n()

  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileOpen])

  const requiresDataset = !['/data', '/settings'].includes(location.pathname)
  let content: ReactNode
  if (requiresDataset && !isLoading && !dataset) {
    content = <NoDatasetPanel />
  } else if (requiresDataset && isLoading) {
    content = <DatasetBooting />
  } else {
    content = <Outlet />
  }

  return (
    <div className="min-h-screen">
      <div className="fixed inset-y-0 left-0 z-50 hidden w-[280px] lg:block">
        <SidebarContent />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label={t('Close navigation')}
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[280px] animate-fade-in">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-[280px]">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {content}
        </main>
      </div>
    </div>
  )
}
