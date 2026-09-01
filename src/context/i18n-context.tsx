
'use client';
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { LANGUAGES } from '@/lib/constants';

// Import all locale data
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
import enIN from '@/locales/en-IN.json';
import bho from '@/locales/bho.json';

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
  'en-IN': enIN,
  bho,
};

const countryToLang: Record<string, string> = {
  CN: 'zh-CN',
  TW: 'zh-TW',
  HK: 'zh-TW',
  BR: 'pt-BR',
  PT: 'pt-BR',
  KR: 'ko',
  FR: 'fr',
  ES: 'es',
  MX: 'es',
  RU: 'ru',
  VN: 'vi',
  IN: 'hi',
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
  const { user } = useAuth();
  const [language, setLanguageState] = useState('en');
  const [messages, setMessages] = useState(translations.en);

  useEffect(() => {
    const savedLang = localStorage.getItem('tradeflow-lang');
    if (savedLang && translations[savedLang]) {
      setLanguageState(savedLang);
    } else if (user?.ipBasedCountry && countryToLang[user.ipBasedCountry]) {
      setLanguageState(countryToLang[user.ipBasedCountry]);
    } else {
        const browserLang = navigator.language;
        const supportedLang = LANGUAGES.find(l => l.code === browserLang || browserLang.startsWith(l.code.split('-')[0]));
        if (supportedLang) {
            setLanguageState(supportedLang.code);
        } else {
            setLanguageState('en');
        }
    }
  }, [user]);

  useEffect(() => {
    setMessages(translations[language] || translations.en);
  }, [language]);

  const setLanguage = useCallback((lang: string) => {
    localStorage.setItem('tradeflow-lang', lang);
    setLanguageState(lang);
  }, []);

  const t = useCallback((key: string): string => {
    const value = getNestedValue(messages, key);
    return value || key;
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
