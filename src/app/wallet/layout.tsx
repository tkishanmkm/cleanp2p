import { DashboardHeader } from "@/components/dashboard/header";
import { Footer } from "@/components/layout/footer";

export default function WalletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <DashboardHeader />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-secondary/30">
        {children}
      </main>
      <Footer />
    </div>
  );
}
