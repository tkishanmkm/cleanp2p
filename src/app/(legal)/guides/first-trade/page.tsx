import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle, Clock, MessageSquare, Shield, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Your First Trade | Paxones Trading Guide',
  description: 'Step-by-step walkthrough for completing your first buy or sell trade safely on Paxones P2P.',
};

export default function FirstTradeGuidePage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-8">
        <Link href="/guides" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 gap-1.5 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Guides & Safety Hub
        </Link>
      </div>

      <div className="border-b border-slate-200 dark:border-[#1e2640] pb-8 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 mb-4">
          <Wallet className="h-3.5 w-3.5" /> Guide 02 • Practical Walkthrough
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          Your First Trade on Paxones
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
          Master the complete process of buying or selling cryptocurrency with local fiat payment methods in a few simple, protected steps.
        </p>
      </div>

      <div className="space-y-10 text-slate-700 dark:text-slate-300 leading-relaxed">
        {/* Step 1 */}
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423] space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-600 text-white font-bold text-sm">1</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Find the Right Offer</h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Navigate to the <strong>Buy Crypto</strong> or <strong>Sell Crypto</strong> marketplace. Use the filters to select your target crypto (e.g. USDT, BTC), fiat currency (e.g. INR, USD, EUR), and preferred payment method (e.g. Bank Transfer, UPI, IMPS, Revolut).
          </p>
          <ul className="list-disc list-inside text-sm space-y-1 text-slate-600 dark:text-slate-400 pl-2">
            <li>Review the trader's <strong>completed trades count</strong> and <strong>positive feedback %</strong>.</li>
            <li>Check their <strong>average payment or release time</strong>.</li>
            <li>Ensure your trade amount fits within their minimum and maximum limit brackets.</li>
          </ul>
        </div>

        {/* Step 2 */}
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423] space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-600 text-white font-bold text-sm">2</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Initiate the Trade & Review Terms</h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Enter the fiat amount you want to pay or crypto amount you want to receive. Carefully read the seller's <strong>Trade Terms</strong> and payment instructions. Once you click <em>Initiate Trade</em>, the seller's cryptocurrency is automatically frozen in <strong>Escrow</strong>.
          </p>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" />
            <span>Pay attention to the <strong>Payment Window timer</strong> (usually 15–30 minutes). You must transfer payment and mark 'Paid' before this timer expires.</span>
          </div>
        </div>

        {/* Step 3 */}
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423] space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-600 text-white font-bold text-sm">3</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Chat and Transfer Payment</h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Open the real-time chat in the trade room. Say hello and confirm the seller is ready. Send the exact fiat amount to the payment account details shown on the screen.
          </p>
          <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-900 dark:text-rose-200 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
            <span><strong>CRITICAL PAYMENT RULE:</strong> Do NOT mention words like "crypto", "Bitcoin", "USDT", or "Paxones" in the bank transfer remarks or reference. Use only your name or the Trade ID number to avoid bank flags.</span>
          </div>
        </div>

        {/* Step 4 */}
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423] space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-600 text-white font-bold text-sm">4</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Mark as Paid & Provide Proof</h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            After your transfer is successful, click the green <strong>"I have paid"</strong> button. This locks the trade into escrow protection permanently so the seller cannot cancel it. In the trade chat, you may upload your payment transfer receipt or transaction screenshot.
          </p>
        </div>

        {/* Step 5 */}
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423] space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-600 text-white font-bold text-sm">5</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Receive Crypto & Leave Feedback</h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            The seller checks their actual bank account or wallet application. Once they verify the funds, they click <strong>"Release Crypto"</strong>. The cryptocurrency is instantly credited to your Paxones wallet balance. Leave a friendly positive rating to build community trust!
          </p>
        </div>

        <div className="pt-6 border-t border-slate-200 dark:border-[#1e2640] flex justify-between items-center">
          <Link href="/guides/welcome" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            ← Guide 01: Welcome
          </Link>
          <Link href="/guides/safety">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              Read Next: Trade Safety →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
