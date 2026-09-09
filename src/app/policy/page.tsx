import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export default function PolicyPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-12 md:py-16 max-w-4xl">
        <div className="prose dark:prose-invert max-w-none space-y-6">
          <div className="border-b border-border pb-6">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Effective Date: January 1, 2026 | Last Updated: September 9, 2026</p>
          </div>

          <h2>1. Commitment to Privacy</h2>
          <p>
            <strong>Paxones™</strong> (&quot;Paxones&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) values your privacy and is dedicated to protecting your personal data in accordance with international data protection standards (including GDPR and CCPA where applicable). This Privacy Policy explains how we collect, process, store, and safeguard your personal information when you use our platform.
          </p>

          <h2>2. Information We Collect</h2>
          <p>We collect only the information necessary to provide a secure, compliant P2P trading environment:</p>
          <ul>
            <li>
              <strong>Account Identification:</strong> Email address, unique username handle, encrypted password hashes, and Two-Factor Authentication (2FA) metadata.
            </li>
            <li>
              <strong>Didit KYC Verification Data:</strong> Government-issued ID document numbers, legal full name, date of birth, document expiration dates, and facial biometric verification hashes processed securely via our automated KYC partner Didit.
            </li>
            <li>
              <strong>Financial & Ledger Data:</strong> Public custodial wallet deposit addresses, on-chain transaction hashes, internal off-chain ledger balances, and escrow trade settlement history.
            </li>
            <li>
              <strong>Communications & Trade Room Attachments:</strong> In-app trade chat transcripts, payment verification receipts, proof-of-payment media, and dispute resolution communications.
            </li>
            <li>
              <strong>Technical & Security Telemetry:</strong> IP addresses, browser user-agent signatures, device fingerprints, and authentication logs used exclusively for fraud detection and account defense.
            </li>
          </ul>

          <h2>3. How We Use Your Data</h2>
          <p>Your personal information is used strictly for the following purposes:</p>
          <ul>
            <li>Facilitating and executing secure P2P crypto escrow transactions.</li>
            <li>Verifying trader identity to combat fraud, money laundering, and bad actors.</li>
            <li>Enforcing double-entry balance accounting and preventing duplicate deposit crediting.</li>
            <li>Providing 24/7 customer support and resolving trade dispute inquiries.</li>
            <li>Complying with applicable statutory legal obligations and regulatory standards.</li>
          </ul>

          <h2>4. Data Storage, Encryption & Security</h2>
          <p>
            We implement enterprise-grade security protocols:
          </p>
          <ul>
            <li>All data in transit is encrypted using modern TLS 1.3 cryptographic protocols.</li>
            <li>All database records, transaction records, and media attachments are encrypted at rest using AES-256 standards.</li>
            <li>Sensitive authentication secrets (such as Speakeasy TOTP keys) are stored in secure encrypted vaults with restricted Row-Level Security (RLS).</li>
          </ul>

          <h2>5. Data Retention & Sharing</h2>
          <p>
            We <strong>never sell, rent, or monetize</strong> your personal data to third parties. We only share information with trusted infrastructure providers (such as Supabase database infrastructure, Didit identity verification engines, and Backblaze S3 media storage) under strict data processing agreements.
          </p>

          <h2>6. Your Privacy Rights</h2>
          <p>
            Depending on your jurisdiction, you have the right to access, review, export, or request the deletion of your personal data, subject to legal and regulatory compliance retention requirements.
          </p>

          <div className="not-prose mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            <p>
              For privacy questions or data requests, contact our Data Protection Officer at{' '}
              <a href="mailto:support@paxones.com" className="text-primary font-semibold underline">
                support@paxones.com
              </a>.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

