import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow bg-background">
        <div className="container mx-auto px-4 md:px-6 py-12 md:py-16">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
