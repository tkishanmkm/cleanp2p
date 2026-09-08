'use client';

import { DashboardHeader } from '@/components/dashboard/header';
import { Footer } from '@/components/layout/footer';

export default function AdLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen w-full bg-background text-foreground">
      <DashboardHeader />
      <main className="flex-1 flex flex-col bg-secondary/30">
        {children}
      </main>
      <Footer />
    </div>
  );
}
