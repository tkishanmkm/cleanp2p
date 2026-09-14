'use client';

import React, { useState } from 'react';
import { generateP2PCompliancePayload, SystemMessageType, PaymentCategory } from '@/lib/p2p-compliance-assistant';
import { ShieldCheck, ShieldAlert, Copy, Check, Send, ArrowRight, Lock, AlertTriangle, FileText, Bot } from 'lucide-react';

export default function P2PAssistantPage() {
  const [systemMessageType, setSystemMessageType] = useState<SystemMessageType>('TRADE_INITIATED');
  const [buyerUsername, setBuyerUsername] = useState('CryptoBuyer99');
  const [sellerUsername, setSellerUsername] = useState('SecureMerchantX');
  const [initiatorUsername, setInitiatorUsername] = useState('PaxonesAssistant');
  const [initiatorRole, setInitiatorRole] = useState<'Buyer' | 'Seller' | 'User'>('User');
  const [targetUsername, setTargetUsername] = useState('CryptoBuyer99');
  const [targetRole, setTargetRole] = useState<'Buyer' | 'Seller' | 'User'>('Buyer');
  const [amount, setAmount] = useState('500.00');
  const [asset, setAsset] = useState('USDT');
  const [fiatAmount, setFiatAmount] = useState('500.00');
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  const [paymentWindowMins, setPaymentWindowMins] = useState(15);
  const [paymentMethodName, setPaymentMethodName] = useState('Bank Wire / SEPA');
  const [paymentCategory, setPaymentCategory] = useState<PaymentCategory>('bank_transfer');
  const [reason, setReason] = useState('Standard P2P Escrow Initiation');
  const [feedbackType, setFeedbackType] = useState<'positive' | 'negative'>('positive');
  const [feedbackComment, setFeedbackComment] = useState('Extremely professional and fast transaction.');

  const [copied, setCopied] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const payload = generateP2PCompliancePayload({
    systemMessageType,
    buyerUsername,
    sellerUsername,
    initiatorUsername,
    initiatorRole,
    targetUsername,
    targetRole,
    amount,
    asset,
    fiatAmount,
    fiatCurrency,
    paymentWindowMins: Number(paymentWindowMins),
    paymentMethodName,
    paymentCategory,
    reason,
    feedbackType,
    feedbackComment
  });

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestApi = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/p2p/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setApiResponse(data);
    } catch (err) {
      setApiResponse({ error: 'Failed to connect to assistant API' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="border-b pb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <Bot className="h-6 w-6" />
            <span className="text-xs font-mono uppercase tracking-widest font-semibold px-2 py-0.5 bg-primary/10 rounded">
              Paxones Compliance & Escrow Assistant
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">P2P Crypto Trade & Payment Compliance Assistant</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enforcing strict anti-fraud rules, escrow lifecycle events, and verified payment protocol guidance.
          </p>
        </div>
        <button
          onClick={handleCopyJson}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied JSON Payload' : 'Copy JSON Payload'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Controls Column */}
        <div className="lg:col-span-5 space-y-6 bg-card p-6 rounded-2xl border shadow-sm">
          <h2 className="text-lg font-semibold flex items-center gap-2 border-b pb-3">
            <FileText className="h-5 w-5 text-primary" /> Trade Event & Metadata Config
          </h2>

          <div className="space-y-4 text-sm">
            <div>
              <label className="font-medium text-muted-foreground block mb-1">System Message Type (`systemMessageType`)</label>
              <select
                value={systemMessageType}
                onChange={(e) => setSystemMessageType(e.target.value as SystemMessageType)}
                className="w-full p-2.5 rounded-lg border bg-background font-medium"
              >
                <option value="TRADE_INITIATED">TRADE_INITIATED</option>
                <option value="MARKED_PAID">MARKED_PAID</option>
                <option value="TRADE_RELEASED">TRADE_RELEASED</option>
                <option value="TRADE_CANCELLED">TRADE_CANCELLED</option>
                <option value="TRADE_EXPIRED">TRADE_EXPIRED</option>
                <option value="TRADE_DISPUTED">TRADE_DISPUTED</option>
                <option value="TRADE_REPORTED">TRADE_REPORTED</option>
                <option value="USER_BLOCKED">USER_BLOCKED</option>
                <option value="FEEDBACK_LEFT">FEEDBACK_LEFT</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-medium text-muted-foreground block mb-1">Buyer Username</label>
                <input
                  type="text"
                  value={buyerUsername}
                  onChange={(e) => setBuyerUsername(e.target.value)}
                  className="w-full p-2 rounded-lg border bg-background"
                />
              </div>
              <div>
                <label className="font-medium text-muted-foreground block mb-1">Seller Username</label>
                <input
                  type="text"
                  value={sellerUsername}
                  onChange={(e) => setSellerUsername(e.target.value)}
                  className="w-full p-2 rounded-lg border bg-background"
                />
              </div>
            </div>

            <div>
              <label className="font-medium text-muted-foreground block mb-1">Payment Category (`PaymentCategory`)</label>
              <select
                value={paymentCategory}
                onChange={(e) => {
                  const val = e.target.value as PaymentCategory;
                  setPaymentCategory(val);
                  if (val === 'bank_transfer') setPaymentMethodName('Bank Transfer / SEPA / Wire');
                  else if (val === 'online_wallet') setPaymentMethodName('Wise / PayPal / Revolut');
                  else if (val === 'mobile_money') setPaymentMethodName('M-Pesa / GCash / Momo');
                  else if (val === 'cash_payments') setPaymentMethodName('In-Person Cash Deposit');
                  else if (val === 'gift_cards') setPaymentMethodName('Amazon / Apple Gift Card');
                  else setPaymentMethodName('Custom Escrow Protocol');
                }}
                className="w-full p-2.5 rounded-lg border bg-background font-medium"
              >
                <option value="bank_transfer">bank_transfer (SEPA, SWIFT, UPI, IMPS, ACH, Wire)</option>
                <option value="online_wallet">online_wallet (Wise, Revolut, PayPal, Zelle, Venmo)</option>
                <option value="mobile_money">mobile_money (M-Pesa, GCash, Momo, Airtel)</option>
                <option value="cash_payments">cash_payments (In-person, Deposit)</option>
                <option value="gift_cards">gift_cards (Retail Gift Cards)</option>
                <option value="custom">custom (Special Protocol)</option>
              </select>
            </div>

            <div>
              <label className="font-medium text-muted-foreground block mb-1">Payment Method Name</label>
              <input
                type="text"
                value={paymentMethodName}
                onChange={(e) => setPaymentMethodName(e.target.value)}
                className="w-full p-2 rounded-lg border bg-background"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="font-medium text-muted-foreground block mb-1">Crypto Amt</label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full p-2 rounded-lg border bg-background"
                />
              </div>
              <div>
                <label className="font-medium text-muted-foreground block mb-1">Fiat Amt</label>
                <input
                  type="text"
                  value={fiatAmount}
                  onChange={(e) => setFiatAmount(e.target.value)}
                  className="w-full p-2 rounded-lg border bg-background"
                />
              </div>
              <div>
                <label className="font-medium text-muted-foreground block mb-1">Currency</label>
                <input
                  type="text"
                  value={fiatCurrency}
                  onChange={(e) => setFiatCurrency(e.target.value)}
                  className="w-full p-2 rounded-lg border bg-background"
                />
              </div>
            </div>

            <div>
              <label className="font-medium text-muted-foreground block mb-1">Payment Window (Minutes)</label>
              <input
                type="number"
                value={paymentWindowMins}
                onChange={(e) => setPaymentWindowMins(Number(e.target.value))}
                className="w-full p-2 rounded-lg border bg-background"
              />
            </div>

            <button
              onClick={handleTestApi}
              disabled={loading}
              className="w-full py-3 bg-secondary text-secondary-foreground font-semibold rounded-xl hover:bg-secondary/80 transition flex items-center justify-center gap-2 mt-4"
            >
              {loading ? 'Verifying with API...' : 'Test Assistant API Route (/api/p2p/assistant)'}
            </button>
          </div>
        </div>

        {/* Output & Guidance Column */}
        <div className="lg:col-span-7 space-y-6">
          {/* Instructions & Guidance Card */}
          <div className="p-6 rounded-2xl border bg-card shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-500" /> Operational Protocol & Instructions
              </h2>
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold font-mono">
                {payload.systemMessageType}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="p-4 bg-muted/50 rounded-xl border space-y-2">
                <h3 className="font-bold text-primary flex items-center gap-1.5">
                  <ArrowRight className="h-4 w-4" /> Buyer Action Mandate
                </h3>
                <p className="text-muted-foreground leading-relaxed text-xs">{payload.instructions.buyerAction}</p>
              </div>

              <div className="p-4 bg-muted/50 rounded-xl border space-y-2">
                <h3 className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <Lock className="h-4 w-4" /> Seller Verification Mandate
                </h3>
                <p className="text-muted-foreground leading-relaxed text-xs">{payload.instructions.sellerVerification}</p>
              </div>
            </div>

            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
              <h3 className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Payment-Rail Specific Focus & Fraud Checks
              </h3>
              <p className="text-amber-950 dark:text-amber-200 text-xs leading-relaxed">{payload.instructions.specialFocus}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 border rounded-xl space-y-2">
                <h4 className="font-bold text-rose-600 dark:text-rose-400">Buyer Anti-Fraud Rules</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  {payload.instructions.buyerWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 border rounded-xl space-y-2">
                <h4 className="font-bold text-rose-600 dark:text-rose-400">Seller Anti-Fraud Rules</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  {payload.instructions.sellerWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* JSON Payload Preview */}
          <div className="p-6 rounded-2xl border bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-md font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Required JSON Payload Schema Output
              </h2>
              <span className="text-xs text-muted-foreground font-mono">200 OK</span>
            </div>
            <pre className="p-4 bg-slate-950 text-slate-200 rounded-xl text-xs overflow-x-auto font-mono max-h-96">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>

          {apiResponse && (
            <div className="p-6 rounded-2xl border bg-emerald-500/5 border-emerald-500/30 shadow-sm space-y-3">
              <h2 className="text-md font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Check className="h-4 w-4" /> Live API Route Test Response
              </h2>
              <pre className="p-3 bg-slate-950 text-slate-200 rounded-xl text-xs overflow-x-auto font-mono max-h-48">
                {JSON.stringify(apiResponse, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
