import Link from 'next/link';
import { ArrowLeft, ShieldAlert, CheckCircle2, XCircle, AlertOctagon, Lock, Eye, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Trade Safety & Fraud Prevention | Paxones Guides',
  description: 'Essential security guidelines, anti-scam warnings, and best practices to keep your funds completely safe on Paxones.',
};

export default function TradeSafetyGuidePage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-8">
        <Link href="/guides" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 gap-1.5 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Guides & Safety Hub
        </Link>
      </div>

      <div className="border-b border-slate-200 dark:border-[#1e2640] pb-8 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 mb-4">
          <ShieldAlert className="h-3.5 w-3.5" /> Guide 03 • Security First
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          Trade Safety & Risk Protection
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
          Follow these non-negotiable safety rules to protect your hard-earned money and avoid malicious actors.
        </p>
      </div>

      <div className="space-y-8 text-slate-700 dark:text-slate-300 leading-relaxed">
        {/* Cardinal Rules */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-rose-600" /> The Golden Rules of P2P Security
          </h2>
          
          <div className="grid sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold mb-2">
                <CheckCircle2 className="h-5 w-5" /> DO THIS
              </div>
              <ul className="text-sm space-y-2 text-slate-700 dark:text-slate-300">
                <li>Log in to your <strong>official banking app</strong> to verify incoming payments before releasing crypto.</li>
                <li>Stay inside the <strong>Paxones trade chat</strong> for all communication and receipts.</li>
                <li>Ensure the sender's bank account name matches their Paxones <strong>verified legal name</strong>.</li>
                <li>Enable <strong>Two-Factor Authentication (2FA)</strong> on your Paxones account.</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold mb-2">
                <XCircle className="h-5 w-5" /> NEVER DO THIS
              </div>
              <ul className="text-sm space-y-2 text-slate-700 dark:text-slate-300">
                <li><strong>NEVER</strong> release crypto based on an SMS notification or email screenshot alone (these can be spoofed).</li>
                <li><strong>NEVER</strong> cancel a trade after you have already sent money to the seller.</li>
                <li><strong>NEVER</strong> move communication to Telegram, WhatsApp, or phone calls.</li>
                <li><strong>NEVER</strong> accept third-party payments from an unverified bank account.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Common Scams to Avoid */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Ban className="h-6 w-6 text-rose-600" /> Common Scams & How to Stop Them
          </h2>

          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">1. The Fake Payment Proof / SMS Spoof</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                <strong>How it works:</strong> A buyer marks the trade as 'Paid' and sends a Photoshopped receipt or fake SMS screenshot claiming funds are on the way.
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-2 font-medium">
                <strong>Defense:</strong> Never trust receipts alone. Open your official banking portal or banking mobile app directly and verify that your balance has physically increased. If money has not arrived, do not release!
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">2. The "Accidental Overpayment" or Chargeback Scam</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                <strong>How it works:</strong> A buyer uses a stolen credit card or hacked bank account, sends payment, and subsequently reports fraud to their bank to charge back the funds.
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-2 font-medium">
                <strong>Defense:</strong> Enforce strict name matching. Reject any payment where the remitter's bank name differs from the verified name on Paxones.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">3. Off-Platform Escrow Impersonators</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                <strong>How it works:</strong> A user asks you to continue the trade on Telegram claiming lower fees or faster speed, sending links to a fake escrow bot.
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-2 font-medium">
                <strong>Defense:</strong> Paxones staff and moderators will NEVER message you on external messaging platforms or ask for your password or private keys.
              </p>
            </div>
          </div>
        </section>

        <div className="pt-6 border-t border-slate-200 dark:border-[#1e2640] flex justify-between items-center">
          <Link href="/guides/first-trade" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            ← Guide 02: Your First Trade
          </Link>
          <Link href="/guides/escrow">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              Read Next: Understanding Escrow →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
