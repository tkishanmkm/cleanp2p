import { DashboardHeader } from "@/components/dashboard/header";
import { Footer } from "@/components/layout/footer";

export default function PublicProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      <DashboardHeader />
      <main className="flex-grow bg-secondary/20">
        <div className="container mx-auto px-4 md:px-6 py-12 md:py-16">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
