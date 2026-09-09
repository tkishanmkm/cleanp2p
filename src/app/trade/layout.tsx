import { DashboardHeader } from "@/components/dashboard/header";

export default function TradeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen max-h-screen bg-background overflow-hidden">
      <DashboardHeader />
      <main className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
        {children}
      </main>
    </div>
  );
}
