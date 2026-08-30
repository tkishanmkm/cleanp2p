import { Header } from "@/components/layout/header";

export default function AdPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />
      <main className="flex-grow flex items-center justify-center bg-secondary/30 p-4">
        {children}
      </main>
    </div>
  );
}
