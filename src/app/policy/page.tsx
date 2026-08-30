import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export default function PolicyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-12 md:py-16">
        <div className="prose dark:prose-invert max-w-4xl mx-auto">
          <h1>Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>
    
          <h2>1. Introduction</h2>
          <p>Paxones is committed to protecting your privacy. This policy explains how we handle your information. If you do not agree, please do not use the Services.</p>
    
          <h2>2. Data Usage & Dispute Policy</h2>
          <p>We use your data to facilitate secure P2P transactions. <strong>Please note:</strong> Paxones is not responsible for the result of any dispute. Disputes are awarded only to users who provide complete evidence and cooperate with our team. If you lose funds, we are not responsible.</p>
    
          <h2>3. Information We Collect</h2>
          <ul>
            <li><strong>Personal Data:</strong> Name, ID, and date of birth provided during registration.</li>
            <li><strong>Financial Data:</strong> Wallet balances and trade history.</li>
            <li><strong>Communication:</strong> Chat logs within the platform are stored for security and dispute resolution.</li>
          </ul>

          <section className="mt-12 pt-8 border-t border-muted">
            <h2 className="text-2xl font-bold mb-4">Terms of Use & Code of Conduct</h2>
            <div className="bg-secondary/50 p-6 rounded-xl space-y-4">
              <p className="font-semibold underline">To maintain a safe environment, all users must adhere to the following:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>No Offside Trades:</strong> All trading must happen through the Paxones escrow system. Off-platform trades are strictly prohibited.</li>
                <li><strong>No Offside Chat:</strong> All communication regarding a trade must take place within the Paxones trade chat.</li>
                <li><strong>No Contact Sharing:</strong> Sharing phone numbers, Telegram IDs, or social media handles is not allowed.</li>
                <li><strong>No Fake Receipts:</strong> Uploading edited or fraudulent payment receipts will result in an immediate and permanent ban.</li>
                <li><strong>No Cheating:</strong> Any attempt to manipulate the system, cheat users, or provide false information is strictly forbidden.</li>
                <li><strong>Cooperation:</strong> You must cooperate fully with moderators during a dispute. Failure to do so will result in an unfavorable resolution.</li>
              </ul>
              <p className="text-sm italic">Violation of these terms will result in account suspension and loss of access to the platform.</p>
            </div>
          </section>
    
          <div className="not-prose mt-8 border-t pt-8">
            <p>For privacy inquiries or to report violations, please <Link href="/contact" className="font-semibold underline">contact our support team</Link>.</p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
