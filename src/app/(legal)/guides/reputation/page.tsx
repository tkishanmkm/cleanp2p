import Link from 'next/link';
import { ArrowLeft, Star, Award, TrendingUp, ThumbsUp, ShieldCheck, Zap, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Building Your Reputation | Paxones Guides',
  description: 'Learn how to gain 100% positive feedback, increase trade volume, earn trust badges, and become a top P2P merchant on Paxones.',
};

export default function ReputationGuidePage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-8">
        <Link href="/guides" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 gap-1.5 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Guides & Safety Hub
        </Link>
      </div>

      <div className="border-b border-slate-200 dark:border-[#1e2640] pb-8 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 mb-4">
          <Star className="h-3.5 w-3.5" /> Guide 06 • Merchant Excellence
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          Building Your Reputation & Trust Score
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
          Reputation is your greatest asset in peer-to-peer trading. Discover how top traders attract thousands of orders with impeccable trust ratings.
        </p>
      </div>

      <div className="space-y-8 text-slate-700 dark:text-slate-300 leading-relaxed">
        {/* Core Metrics */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Award className="h-6 w-6 text-amber-600" /> Key Metrics Visible on Your Profile
          </h2>
          <p>
            Every trader profile and ad card on Paxones displays authentic, database-backed statistics that buyers and sellers evaluate before engaging in a trade:
          </p>

          <div className="grid sm:grid-cols-2 gap-4 pt-1">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <ThumbsUp className="h-4 w-4 text-emerald-600" /> Positive Feedback Rating (%)
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Calculated directly from reviews left by your trade partners. Top merchants maintain a 98% to 100% positive feedback rating.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-amber-600" /> Average Release & Paid Time
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Measured from actual blockchain and payment event timestamps. Traders with release times under 3–5 minutes receive significantly higher order volumes.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-blue-600" /> Total Completed Trades & Volume
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                A tally of all successfully finished trades without chargebacks or dispute defaults.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] bg-slate-50 dark:bg-[#101726]">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> KYC Verification Tier
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Accounts with verified government ID, liveness checks, and verified email build immediate institutional confidence.
              </p>
            </div>
          </div>
        </section>

        {/* Actionable tips */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Star className="h-6 w-6 text-amber-600" /> 5 Habits of Top Paxones Merchants
          </h2>
          <div className="space-y-3">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">1. Communicate Professionally and Promptly</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Greet every counterparty with a polite greeting in the chat and provide exact, clear payment references.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">2. Release As Soon As Funds Arrive</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Do not make buyers wait needlessly. Once your bank balance reflects the credited funds, release the crypto immediately.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">3. Write Transparent Ad Terms</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Clearly disclose your requirements (e.g., 'Bank screenshot required, fast release') before the trade begins.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">4. Keep Pricing Competitive</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Utilize dynamic floating market margins (e.g. +1.5%) so your ad automatically tracks market fluctuations.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-[#1e2640] flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">5. Proactively Leave Reciprocal Feedback</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">When you leave a positive rating for honest buyers, they will almost always return the favor and favorite your profile for future repeat orders.</p>
              </div>
            </div>
          </div>
        </section>

        <div className="pt-6 border-t border-slate-200 dark:border-[#1e2640] flex justify-between items-center">
          <Link href="/guides/dispute-resolution" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            ← Guide 05: Dispute Resolution
          </Link>
          <Link href="/ads/create">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              Create Your First Ad →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
