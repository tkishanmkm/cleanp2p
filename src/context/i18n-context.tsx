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
  t: (key: string, params?: Record<string, string | number>) => string;
  setLanguage: (lang: string) => void;
  language: string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const getNestedValue = (obj: any, key: string) => {
  if (!obj) return undefined;
  return key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>('en');
  const [messages, setMessages] = useState<any>(translations.en);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('paxones-lang') || localStorage.getItem('tradeflow-lang');
      if (savedLang && translations[savedLang]) {
        setLanguageState(savedLang);
        return;
      }

      if (typeof navigator !== 'undefined') {
        const browserLang = navigator.language;
        const supportedLang = LANGUAGES.find(
          (l) => l.code === browserLang || browserLang.startsWith(l.code.split('-')[0])
        );
        if (supportedLang && translations[supportedLang.code]) {
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
    const currentMessages = translations[language] || translations.en;
    setMessages(currentMessages);

    // Update document language and text direction dynamically
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    }
  }, [language]);

  const setLanguage = useCallback((lang: string) => {
    if (!translations[lang]) return;
    try {
      localStorage.setItem('paxones-lang', lang);
      localStorage.setItem('tradeflow-lang', lang);
    } catch {
      // Ignore storage errors in private browsing
    }
    setLanguageState(lang);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    let value = getNestedValue(messages, key);
    
    // Fallback to English if translation is missing in current locale
    if (value === undefined && language !== 'en') {
      value = getNestedValue(translations.en, key);
    }

    if (value === undefined || value === null) {
      return key;
    }

    if (typeof value !== 'string') {
      return String(value);
    }

    if (params) {
      return Object.entries(params).reduce((acc, [paramKey, paramVal]) => {
        return acc.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
      }, value);
    }

    return value;
  }, [messages, language]);

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

