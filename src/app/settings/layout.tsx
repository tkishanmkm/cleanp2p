'use client';

import React from 'react';
import { DashboardHeader } from '@/components/dashboard/header';
import { Footer } from '@/components/layout/footer';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      <DashboardHeader />
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}
