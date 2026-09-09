import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-12 md:py-16 max-w-4xl">
        <div className="prose dark:prose-invert max-w-none space-y-6">
          <div className="border-b border-border pb-6">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2">Terms of Service</h1>
            <p className="text-sm text-muted-foreground">Effective Date: January 1, 2026 | Last Updated: September 9, 2026</p>
          </div>

          <h2>1. Introduction & Acceptance of Terms</h2>
          <p>
            Welcome to <strong>Paxones™</strong> (&quot;Paxones&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). Paxones operates a peer-to-peer (P2P) digital currency escrow trading marketplace accessible via our web and mobile applications. By creating an account, accessing, browsing, or utilizing any services provided by Paxones, you unconditionally agree to comply with and be legally bound by these Terms of Service and our Privacy Policy.
          </p>

          <h2>2. Eligibility & Identity Verification (KYC)</h2>
          <p>
            To use Paxones, you must be at least 18 years of age and possess full legal capacity to enter into binding agreements. You agree to provide accurate, complete, and current information during registration.
          </p>
          <ul>
            <li>
              <strong>Didit KYC Verification:</strong> Verification of your identity is powered by automated biometric and document verification engines. Upon successful KYC approval, your legal Full Name, Date of Birth (DOB), and country of origin are extracted directly from official government documents and permanently locked to your account profile to prevent account sharing, synthetic identity fraud, or unauthorized modification.
            </li>
            <li>
              <strong>One Account Per Person:</strong> Each individual is permitted to maintain only one active Paxones account. Multi-accounting, account leasing, or operating accounts on behalf of unverified third parties is strictly prohibited.
            </li>
          </ul>

          <h2>3. Automated Escrow Protection Protocol</h2>
          <p>
            All trades initiated on Paxones are protected by our cryptographic and custodial dual-ledger escrow system:
          </p>
          <ul>
            <li>
              <strong>Seller Deposit Locking:</strong> When a trade is initiated, the designated amount of cryptocurrency is instantly deducted from the seller&apos;s available wallet balance and locked in platform escrow.
            </li>
            <li>
              <strong>Escrow Fee:</strong> A standard platform escrow fee of 1.5% is calculated on the gross trade value upon successful settlement.
            </li>
            <li>
              <strong>Buyer Payment Window:</strong> The buyer is allocated a specific time window to transfer the exact fiat payment using the payment method specified in the advertisement.
            </li>
            <li>
              <strong>Fund Release:</strong> The seller is required to release the locked escrow funds immediately upon verifying receipt of cleared funds in their personal bank or payment account.
            </li>
          </ul>

          <h2>4. User Code of Conduct & Trading Rules</h2>
          <p>To ensure a safe, fair, and reliable trading environment, all users must adhere to the following mandatory rules:</p>
          <ol>
            <li>
              <strong>On-Platform Transactions Only:</strong> All trade-related communications, negotiation of terms, and payment confirmations must occur exclusively within the official Paxones trade room. Attempting to direct trade partners off-platform (e.g., Telegram, WhatsApp, email) is strictly prohibited and results in immediate account termination.
            </li>
            <li>
              <strong>First-Party Payments:</strong> Payment must be sent from a bank or payment account registered in the exact legal name matching the user&apos;s verified Paxones profile. Third-party payments are forbidden.
            </li>
            <li>
              <strong>Legitimate Proof of Payment:</strong> Uploading fraudulent, altered, or fabricated payment receipts, chargebacking legitimate fiat payments, or claiming false payment will result in permanent banning and referral to financial crime enforcement authorities.
            </li>
            <li>
              <strong>Coin-Locking & Malicious Delays:</strong> Initiating trades without the intention or ability to complete payment, or intentionally stalling trade timers, is treated as market abuse.
            </li>
          </ol>

          <h2>5. Internal User-to-User Transfers & Withdrawals</h2>
          <p>
            Internal user-to-user transfers on Paxones allow fast, zero-confirmation off-chain balance movement between registered usernames subject to the standard 1.5% internal transfer fee. External on-chain withdrawals are processed via multi-signature hot wallets and require Two-Factor Authentication (2FA) verification.
          </p>

          <h2>6. Account Security & Two-Factor Authentication (2FA)</h2>
          <p>
            You are solely responsible for maintaining the confidentiality of your credentials, password, TOTP authenticator secret keys, and backup codes. Paxones is not liable for unauthorized account access resulting from compromised user devices or phishing attacks.
          </p>

          <h2>7. Service Availability & Modifications</h2>
          <p>
            Paxones reserves the right to modify, suspend, or discontinue any aspect of our services, introduce rate limits, or adjust platform fee schedules with prior notice where practicable.
          </p>

          <div className="not-prose mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            <p>
              For legal inquiries or account support, contact our compliance team at{' '}
              <a href="mailto:support@paxones.com" className="text-primary font-semibold underline">
                support@paxones.com
              </a>{' '}
              or visit our <Link href="/support" className="text-primary font-semibold underline">Support Center</Link>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

