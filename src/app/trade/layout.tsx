import { DashboardHeader } from "@/components/dashboard/header";

export default function TradeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <DashboardHeader />
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
