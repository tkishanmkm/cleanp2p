
"use client";

import { DashboardHeader } from "@/components/dashboard/header";
import { Footer } from "@/components/layout/footer";

export default function FullPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen w-full bg-background">
      <DashboardHeader />
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}
