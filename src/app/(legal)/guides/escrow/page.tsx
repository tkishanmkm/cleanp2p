import Link from 'next/link';
import { ArrowLeft, Lock, ShieldCheck, Clock, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Understanding Escrow | Paxones Guides',
  description: 'How the Paxones cryptographic escrow vault protects both buyers and sellers from fraud during every trade.',
};

export default function EscrowGuidePage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-8">
        <Link href="/guides" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 gap-1.5 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Guides & Safety Hub
        </Link>
      </div>

      <div className="border-b border-slate-200 dark:border-[#1e2640] pb-8 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 mb-4">
          <Lock className="h-3.5 w-3.5" /> Guide 04 • The Escrow Shield
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          Understanding the Escrow System
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
          The mathematical and procedural backbone that guarantees you will never be scammed out of your cryptocurrency or fiat money.
        </p>
      </div>

      <div className="space-y-8 text-slate-700 dark:text-slate-300 leading-relaxed">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" /> What is an Escrow?
          </h2>
          <p>
            An escrow is an impartial third-party holding mechanism. On Paxones, when a buyer initiates an order to purchase cryptocurrency from a seller, that exact amount of cryptocurrency is automatically deducted from the seller’s wallet and locked into the secure Paxones Escrow Vault.
          </p>
          <p>
            Neither the buyer nor the seller can withdraw or transfer these coins while the escrow is active. The cryptocurrency remains safely suspended until either:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2 text-slate-600 dark:text-slate-400">
            <li>The seller confirms receipt of fiat payment and unlocks the escrow to the buyer.</li>
            <li>The payment window expires without payment and the crypto safely reverts to the seller.</li>
            <li>A dispute is opened and a Paxones compliance moderator evaluates proof and issues the coins to the rightful owner.</li>
          </ul>
        </section>

        {/* Protection for Buyers & Sellers */}
        <div className="grid sm:grid-cols-2 gap-6 pt-2">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726] space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> How Escrow Protects Buyers
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              When you send fiat money through your bank or payment app, the seller cannot run away with your cash. The cryptocurrency is already locked on our platform. Even if the seller goes offline or refuses to release, a Paxones moderator can inspect your payment receipt and release the crypto to your wallet.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726] space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> How Escrow Protects Sellers
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Your cryptocurrency will never be released to the buyer until you explicitly click 'Release Crypto' after seeing the funds settled in your personal bank account. If the buyer never pays, the trade times out or can be cancelled and your coins are refunded safely.
            </p>
          </div>
        </div>

        {/* The 4 Stages of Escrow Lifecycle */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="h-6 w-6 text-emerald-600" /> The Escrow Lifecycle
          </h2>

          <div className="space-y-3">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-4">
              <div className="h-7 w-7 rounded-full bg-blue-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">1</div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white">Active Lock</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">Trade is created. Seller's cryptocurrency balance is reserved in escrow. Payment timer starts.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-4">
              <div className="h-7 w-7 rounded-full bg-amber-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">2</div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white">Payment In Transit (Marked Paid)</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">Buyer makes transfer and clicks 'I have paid'. The trade can no longer auto-cancel. Escrow stays locked.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-4">
              <div className="h-7 w-7 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">3</div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white">Completed Release</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">Seller verifies bank deposit and clicks 'Release'. Cryptographic ownership transfers immediately to the buyer.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-4">
              <div className="h-7 w-7 rounded-full bg-rose-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">4</div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white">Dispute Escrow Guard</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">If either party raises an issue, the trade freezes into Dispute state. The escrow remains locked under moderator jurisdiction until resolved.</p>
              </div>
            </div>
          </div>
        </section>

        <div className="pt-6 border-t border-slate-200 dark:border-[#1e2640] flex justify-between items-center">
          <Link href="/guides/safety" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            ← Guide 03: Trade Safety
          </Link>
          <Link href="/guides/dispute-resolution">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              Read Next: Dispute Resolution →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
