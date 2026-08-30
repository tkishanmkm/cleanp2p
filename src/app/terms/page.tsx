import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-12 md:py-16">
        <div className="prose dark:prose-invert max-w-4xl mx-auto">
          <h1>Terms of Service</h1>
          <p className="text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>

          <section className="bg-destructive/10 p-6 rounded-lg border-l-4 border-destructive my-8">
            <h2 className="text-destructive mt-0">Crucial Dispute Disclaimer</h2>
            <p className="font-semibold">
              Paxones is not responsible for the final result of any dispute. Dispute awards are granted solely at the discretion of our moderation team to the party that provides all requested evidence and cooperates fully with the investigation. If you lose any funds as a result of a trade or a dispute resolution, Paxones is not liable or responsible for those losses.
            </p>
          </section>

          <h2>1. Introduction & Our Role</h2>
          <p>
            Welcome to Paxones! These Terms of Service ("Terms") govern your use of our peer-to-peer cryptocurrency
            trading platform. By accessing or using our Services, you agree to be bound by these Terms.
          </p>
          <p>
            <strong>Important Disclaimer:</strong> Paxones is a technology platform that connects users (buyers and sellers) for the purpose of executing peer-to-peer (P2P) transactions. We are not a party to any trade between users.
          </p>

          <h2>2. General P2P Trading Rules</h2>
          <p>
            All trades on Paxones are secured by our automated escrow system. You agree to communicate with other users professionally and to not engage in
            any fraudulent or illegal activities. <strong>All communication and transactions must remain strictly on the Paxones platform.</strong>
          </p>

          <h2>3. Dispute Resolution & Liability</h2>
          <p>
            In the event of a disagreement, our moderation team will intervene. Our decision is final and based on evidence provided within the trade chat. We do not guarantee any specific outcome and are not responsible for funds lost during trades.
          </p>

          <h2 id="how-to-trade">4. How to Trade: A Step-by-Step Guide</h2>
          <ol>
            <li><strong>Find an Advertisement:</strong> Browse the "Buy" or "Sell" pages to find a suitable match.</li>
            <li><strong>Initiate the Trade:</strong> Enter the amount. The cryptocurrency is locked in our secure escrow.</li>
            <li><strong>Communicate in Chat:</strong> Use the trade chat to provide or receive payment details.</li>
            <li><strong>Payment (Buyer's Role):</strong> Send the agreed-upon amount within the time limit.</li>
            <li><strong>Confirm Payment (Buyer's Role):</strong> Click the "Mark as Paid" button.</li>
            <li><strong>Release Crypto (Seller's Role):</strong> Once payment is confirmed in your account, release the crypto.</li>
          </ol>

          <h2>5. Prohibited Conduct</h2>
          <ul>
            <li>Providing fake payment receipts or proof of payment.</li>
            <li>Sharing contact information (phone numbers, social media handles) to move the trade off-platform.</li>
            <li>Attempting to cheat or defraud other users or the platform.</li>
            <li>Coercive behavior or harassment of trade partners or moderators.</li>
          </ul>
          
          <div className="not-prose mt-8 border-t pt-8">
            <p>If you have questions about these Terms, please <Link href="/contact" className="text-primary font-semibold underline">contact our support team</Link>.</p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
