'use client';

import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { type Locale, type TranslationKey, translate } from '@/i18n';
import { readLocalePreference, writeLocalePreference } from '@/lib/app-preferences';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // 优先读取当前浏览器偏好；首次使用时按浏览器语言初始化。
  useEffect(() => {
    const saved = readLocalePreference();
    if (saved) {
      setLocaleState(saved);
      return;
    }

    const candidates = [
      ...(navigator.languages || []),
      navigator.language,
    ].filter(Boolean);
    const detected: Locale = candidates.some((language) => language.startsWith('zh')) ? 'zh' : 'en';
    setLocaleState(detected);
    writeLocalePreference(detected);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    writeLocalePreference(newLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}
