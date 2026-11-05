'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { LANGUAGES } from '@/lib/constants';

// Import all active locale data
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';
import fr from '@/locales/fr.json';
import hi from '@/locales/hi.json';
import ko from '@/locales/ko.json';
import ptBR from '@/locales/pt-BR.json';
import ru from '@/locales/ru.json';
import es from '@/locales/es.json';
import vi from '@/locales/vi.json';
import zhCN from '@/locales/zh-CN.json';
import zhTW from '@/locales/zh-TW.json';

const translations: Record<string, any> = {
  en,
  ar,
  fr,
  hi,
  ko,
  'pt-BR': ptBR,
  ru,
  es,
  vi,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};


interface I18nContextType {
  t: (key: string) => string;
  setLanguage: (lang: string) => void;
  language: string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const getNestedValue = (obj: any, key: string) => {
  return key.split('.').reduce((acc, part) => acc && acc[part], obj);
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState('en');
  const [messages, setMessages] = useState(translations.en);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('paxones-language') || localStorage.getItem('tradeflow-lang');
      if (savedLang && translations[savedLang]) {
        setLanguageState(savedLang);
        return;
      }

      if (typeof navigator !== 'undefined') {
        const browserLang = navigator.language;
        const supportedLang =
          LANGUAGES.find((l) => l.code === browserLang) ||
          LANGUAGES.find((l) => browserLang.startsWith(l.code.split('-')[0]));
        if (supportedLang) {
          setLanguageState(supportedLang.code);
          return;
        }
      }
      setLanguageState('en');
    } catch {
      setLanguageState('en');
    }
  }, []);

  useEffect(() => {
    const syncLanguage = (event: Event) => {
      const lang = (event as CustomEvent<string>).detail;
      if (typeof lang === 'string' && translations[lang]) setLanguageState(lang);
    };
    window.addEventListener('language-changed', syncLanguage);
    return () => window.removeEventListener('language-changed', syncLanguage);
  }, []);

  useEffect(() => {
    setMessages(translations[language] || translations.en);
  }, [language]);

  // Keep assistive technology, browser language tools, and layout direction in sync
  // with the selected locale. Arabic is the only currently supported RTL locale.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  const setLanguage = useCallback((lang: string) => {
    if (!translations[lang]) return;
    // Language selection must still work when browser storage is disabled or full.
    try {
      localStorage.setItem('tradeflow-lang', lang);
      localStorage.setItem('paxones-language', lang);
    } catch {
      // Keep the selection in memory for the current page session.
    }
    setLanguageState(lang);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('language-changed', { detail: lang }));
  }, []);

  const t = useCallback((key: string): string => {
    const value = getNestedValue(messages, key);
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
    const enValue = getNestedValue(translations.en, key);
    if (enValue !== undefined && enValue !== null && enValue !== '') {
      return String(enValue);
    }
    return key;
  }, [messages]);

  return (
    <I18nContext.Provider value={{ t, setLanguage, language }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
