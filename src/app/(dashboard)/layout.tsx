
"use client";

import { DashboardHeader } from "@/components/dashboard/header";
import { Footer } from "@/components/layout/footer";
import { usePathname } from 'next/navigation';
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isTradePage = pathname.startsWith('/trade/');

  return (
    <div className={cn(
        "flex flex-col w-full",
        isTradePage ? "h-screen" : "min-h-screen"
      )}
    >
      <DashboardHeader />
      <main className={cn(
        "flex-1 flex flex-col bg-secondary/30",
        isTradePage ? "overflow-hidden min-h-0" : "gap-4 p-2 sm:p-4 lg:p-6"
      )}>
        {children}
      </main>
      {!isTradePage && <Footer />}
    </div>
  );
}
