'use client';

import { useI18n } from '@/context/i18n-context';

type LegalDocumentBannerProps = {
  document: 'terms' | 'privacy';
  effectiveDate: string;
  lastUpdated: string;
};

export function LegalRiskWarningTitle() {
  const { t, language } = useI18n();
  return (
    <span dir={language === 'ar' ? 'rtl' : 'ltr'}>
      ⚠️ {t('legal.riskWarningTitle')}
    </span>
  );
}

export function LegalDocumentBanner({
  document,
  effectiveDate,
  lastUpdated,
}: LegalDocumentBannerProps) {
  const { t, language } = useI18n();
  const title = document === 'terms' ? t('legal.termsTitle') : t('legal.privacyTitle');

  return (
    <div
      className="border-b border-slate-200 dark:border-[#1e2640] pb-6 mb-8"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold rounded-full mb-4">
        <span aria-hidden="true">§</span>
        <span>{t('legal.officialDocument')}</span>
      </div>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white mb-3">
        {title}
      </h1>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <strong>{t('legal.effectiveDateLabel')}:</strong> {effectiveDate}
        </span>
        <span>
          <strong>{t('legal.lastUpdatedLabel')}:</strong> {lastUpdated}
        </span>
      </div>
      <p className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {t('legal.translationNotice')}
      </p>
    </div>
  );
}
