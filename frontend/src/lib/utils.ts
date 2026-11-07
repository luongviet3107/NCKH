import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type FormattingLocale = 'en-US' | 'vi-VN'

let formattingLocale: FormattingLocale = 'en-US'

export function setFormattingLocale(language: 'en' | 'vi') {
  formattingLocale = language === 'vi' ? 'vi-VN' : 'en-US'
}

const currencyFormatters = {
  'en-US': new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }),
  'vi-VN': new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }),
}

const preciseCurrencyFormatters = {
  'en-US': new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  'vi-VN': new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
}

export function formatCurrency(value: number | null | undefined, precise = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return (precise ? preciseCurrencyFormatters : currencyFormatters)[formattingLocale].format(value)
}

export function formatNumber(value: number | null | undefined, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat(formattingLocale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  }
  return new Intl.NumberFormat(formattingLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatPercent(value: number | null | undefined, withSign = false, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = withSign && value > 0 ? '+' : ''
  const formatted = new Intl.NumberFormat(formattingLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
  return `${sign}${formatted}%`
}

export function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(formattingLocale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function titleCase(value: string | null | undefined) {
  if (!value) return '—'
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function shortDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(formattingLocale, { month: 'short', day: 'numeric' }).format(date)
}

export function longDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(formattingLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export type UiTone = 'blue' | 'green' | 'amber' | 'red' | 'slate'

export function riskTone(risk: string | null | undefined): UiTone {
  if (risk === 'High Risk' || risk === 'Critical Stock') return 'red'
  if (risk === 'Medium Risk' || risk === 'Low Stock' || risk === 'Dead Stock' || risk === 'Overstock') return 'amber'
  if (risk === 'Low Risk' || risk === 'Optimal Stock') return 'green'
  return 'slate'
}

export function priorityTone(priority: string | null | undefined): UiTone {
  if (priority === 'urgent' || priority === 'high') return 'red'
  if (priority === 'medium') return 'amber'
  return 'slate'
}

export function statusTone(status: string | null | undefined): UiTone {
  if (status === 'completed') return 'green'
  if (status === 'running') return 'blue'
  if (status === 'awaiting_approval') return 'amber'
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'red'
  return 'slate'
}

export function formatSeconds(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  if (formattingLocale === 'vi-VN') {
    if (value < 1) return `${formatNumber(Math.round(value * 1000))} mili giây`
    if (value < 60) return `${formatNumber(value, 1)} giây`
    return `${Math.floor(value / 60)} phút ${Math.round(value % 60)} giây`
  }
  if (value < 1) return `${Math.round(value * 1000)} ms`
  if (value < 60) return `${value.toFixed(1)} s`
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
}

export function formatUnits(value: number | null | undefined, decimals = 1) {
  return `${formatNumber(value, decimals)} ${formattingLocale === 'vi-VN' ? 'đơn vị' : 'units'}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
