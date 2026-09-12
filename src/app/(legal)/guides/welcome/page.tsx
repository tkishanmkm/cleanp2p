import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ShieldCheck, Zap, Users, Globe, Lock, Coins, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Welcome to Paxones | Trading Guides',
  description: 'Learn how Paxones peer-to-peer cryptocurrency marketplace empowers global traders with zero-compromise escrow security.',
};

export default function WelcomeGuidePage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      {/* Back to Guides Navigation */}
      <div className="mb-8">
        <Link href="/guides" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 gap-1.5 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Guides & Safety Hub
        </Link>
      </div>

      {/* Hero Header */}
      <div className="border-b border-slate-200 dark:border-[#1e2640] pb-8 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 mb-4">
          <Sparkles className="h-3.5 w-3.5" /> Guide 01 • Getting Started
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          Welcome to Paxones
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
          The next-generation peer-to-peer (P2P) cryptocurrency platform engineered for freedom, speed, and uncompromising escrow security.
        </p>
      </div>

      {/* Guide Content Sections */}
      <div className="space-y-10 text-slate-700 dark:text-slate-300 leading-relaxed">
        {/* What is Paxones */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Globe className="h-6 w-6 text-emerald-600" /> What is Paxones?
          </h2>
          <p>
            Paxones is a decentralized, peer-to-peer financial trading hub that connects cryptocurrency buyers and sellers directly worldwide. Unlike traditional custodial exchanges where your assets can be frozen or trapped in complex withdrawal queues, Paxones allows you to trade Bitcoin (BTC), Tether (USDT), Ethereum (ETH), and Litecoin (LTC) directly using your preferred local currency and payment methods.
          </p>
          <p>
            Whether you want to pay with bank wire transfers, UPI, IMPS, SEPA, PayPal, Revolut, Wise, or gift cards, Paxones provides the real-time marketplace and secure infrastructure to transact with peace of mind.
          </p>
        </section>

        {/* The 3 Core Pillars */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Lock className="h-6 w-6 text-emerald-600" /> The Three Pillars of Paxones
          </h2>
          <div className="grid sm:grid-cols-3 gap-6 pt-2">
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold mb-3">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Guaranteed Escrow</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Whenever a trade begins, the crypto is locked in escrow. Sellers cannot vanish with your fiat payment without the crypto being released to you.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold mb-3">
                <Zap className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Instant Direct Trading</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Direct trade chats, real-time presence, automatic payment countdown timers, and streamlined releases keep your trading quick and responsive.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold mb-3">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">Reputation Network</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Transparent ratings, positive feedback scores, average release times, and badge verifications help you identify honest traders immediately.
              </p>
            </div>
          </div>
        </section>

        {/* How Transactions Work */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Coins className="h-6 w-6 text-emerald-600" /> How a Trade Flow Works
          </h2>
          <div className="space-y-3 pt-2">
            <div className="flex gap-4 items-start">
              <div className="h-7 w-7 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">1</div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Browse Offers or Create an Ad</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">Filter by crypto asset (BTC, USDT, ETH, LTC), your local currency (USD, INR, EUR, GBP), and payment method.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <div className="h-7 w-7 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">2</div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Crypto Enters Safe Escrow</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">The moment you start a trade, the seller's crypto is locked safely in the Paxones escrow vault.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <div className="h-7 w-7 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">3</div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Payment & Confirmation</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">The buyer sends fiat payment directly to the seller's account, then clicks 'I have paid'.</p>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <div className="h-7 w-7 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">4</div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Verification & Release</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">The seller checks their actual bank balance. Once verified, they release the escrowed crypto directly to the buyer's wallet.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Safety Callout */}
        <div className="p-6 rounded-2xl border-l-4 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
          <h4 className="font-bold text-base flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Platform Golden Rule
          </h4>
          <p className="text-sm mt-2 leading-relaxed">
            All trade negotiations and conversations must take place exclusively within the encrypted Paxones trade chat. Never conduct business on WhatsApp, Telegram, or Discord. In case of any disagreement, platform moderators can only review evidence contained inside your trade room.
          </p>
        </div>

        {/* Next Guide Link */}
        <div className="pt-6 border-t border-slate-200 dark:border-[#1e2640] flex justify-between items-center">
          <Link href="/guides" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            ← Guides Overview
          </Link>
          <Link href="/guides/first-trade">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              Read Next: Your First Trade →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
