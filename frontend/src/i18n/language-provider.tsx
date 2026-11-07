import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { setFormattingLocale } from '../lib/utils'
import { I18nContext, translate, type I18nContextValue } from './language-context'
import type { Language } from './messages'

function initialLanguage(): Language {
  // Apply the Vietnamese default once for existing installations as well.
  if (localStorage.getItem('autods-locale-version') !== 'vi-1') return 'vi'
  const stored = localStorage.getItem('autods-language')
  if (stored === 'vi' || stored === 'en') return stored
  return 'vi'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage)
  setFormattingLocale(language)

  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem('autods-language', language)
    localStorage.setItem('autods-locale-version', 'vi-1')
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => setLanguage((current) => (current === 'vi' ? 'en' : 'vi')),
      t: (key, params) => translate(language, key, params),
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
