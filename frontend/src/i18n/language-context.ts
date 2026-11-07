import { createContext, useContext } from 'react'
import { messages, type Language } from './messages'

export type TranslateParams = Record<string, string | number>

export interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  toggleLanguage: () => void
  t: (key: string, params?: TranslateParams) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)

export function translate(language: Language, key: string, params?: TranslateParams) {
  let template = messages[language][key] ?? key
  if (!params) return template
  for (const [name, value] of Object.entries(params)) {
    template = template.replaceAll(`{${name}}`, String(value))
  }
  return template
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within LanguageProvider')
  return context
}
