'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  AlertOctagon, 
  Download, 
  Trash2, 
  Wallet, 
  Send, 
  Lock, 
  ShieldAlert, 
  CheckCircle2, 
  LogOut,
  AlertTriangle 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function BannedUserDashboard() {
  const supabase = createClient();
  const [profile, setProfile] = useState<any>(null);
  const [wallets, setWallets] = useState<any[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [withdrawalAddress, setWithdrawalAddress] = useState('');
  const [network, setNetwork] = useState('TRC20');
  const [loading, setLoading] = useState(true);
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawalSuccess, setWithdrawalSuccess] = useState<string | null>(null);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadBannedUserData();
  }, []);

  async function loadBannedUserData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      
      setProfile(prof);

      // Fetch wallets with positive balance (> 0)
      const { data: wData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id);

      const positiveWallets = (wData || []).filter(
        (w: any) => Number(w.balance || 0) > 0
      );

      setWallets(positiveWallets);
      if (positiveWallets.length > 0) {
        setSelectedCurrency(positiveWallets[0].currency);
        // Default network based on currency
        const cur = positiveWallets[0].currency.toUpperCase();
        if (cur === 'USDT') setNetwork('TRC20');
        else if (cur === 'BTC') setNetwork('Bitcoin');
        else if (cur === 'ETH') setNetwork('ERC20');
        else setNetwork('Mainnet');
      }
    } catch (err) {
      console.error('Error loading banned user data:', err);
    } finally {
      setLoading(false);
    }
  }

  const selectedWallet = wallets.find(
    (w) => w.currency.toUpperCase() === selectedCurrency.toUpperCase()
  );

  const handleCurrencyChange = (currency: string) => {
    setSelectedCurrency(currency);
    const cur = currency.toUpperCase();
    if (cur === 'USDT') setNetwork('TRC20');
    else if (cur === 'BTC') setNetwork('Bitcoin');
    else if (cur === 'ETH') setNetwork('ERC20');
    else if (cur === 'SOL') setNetwork('Solana');
    else setNetwork('Mainnet');
  };

  async function handleFinalWithdrawal(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawalError(null);
    setWithdrawalSuccess(null);

    if (!selectedWallet) {
      setWithdrawalError('No active coin balance selected.');
      return;
    }

    if (!withdrawalAddress.trim() || withdrawalAddress.trim().length < 8) {
      setWithdrawalError('Please enter a valid destination wallet address.');
      return;
    }

    setSubmittingWithdrawal(true);

    try {
      const res = await fetch('/api/user/banned-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: selectedCurrency,
          address: withdrawalAddress.trim(),
          network,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setWithdrawalError(data.error || 'Withdrawal failed. Please try again.');
      } else {
        setWithdrawalSuccess(
          data.message || `Successfully scheduled one-time withdrawal for ${selectedCurrency}!`
        );
        setWithdrawalAddress('');
        await loadBannedUserData();
      }
    } catch (err: any) {
      setWithdrawalError(err.message || 'An unexpected error occurred during withdrawal.');
    } finally {
      setSubmittingWithdrawal(false);
    }
  }

  async function handleExportCSV() {
    if (!profile) return;
    setExportingCSV(true);

    try {
      const { data: trades } = await supabase
        .from('trades')
        .select('*')
        .or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`)
        .order('created_at', { ascending: false });

      if (!trades || trades.length === 0) {
        alert('No trade history records found on this account.');
        setExportingCSV(false);
        return;
      }

      const headers = [
        'Trade ID',
        'Role',
        'Cryptocurrency',
        'Crypto Amount',
        'Fiat Currency',
        'Fiat Amount',
        'Price per Unit',
        'Status',
        'Payment Method',
        'Created At',
        'Completed At'
      ];

      const rows = trades.map((t: any) => [
        t.id,
        t.buyer_id === profile.id ? 'BUYER' : 'SELLER',
        t.crypto_currency || t.currency || 'USDT',
        t.amount || t.crypto_amount || '0',
        t.fiat_currency || 'USD',
        t.fiat_amount || '0',
        t.price || '0',
        t.status || 'UNKNOWN',
        `"${(t.payment_method || 'Bank Transfer').replace(/"/g, '""')}"`,
        t.created_at || '',
        t.completed_at || t.released_at || ''
      ]);

      const csvContent =
        'data:text/csv;charset=utf-8,' +
        [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `trade_history_${profile.username || profile.id}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingCSV(false);
    }
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteError(null);

    try {
      const res = await fetch('/api/user/delete-account', {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setDeleteError(data.error || 'Failed to delete account.');
        setDeletingAccount(false);
        return;
      }

      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (err: any) {
      setDeleteError(err.message || 'An error occurred while deleting account.');
      setDeletingAccount(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-white">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-slate-400">Loading account status...</span>
        </div>
      </div>
    );
  }

  const banReason = profile?.ban_reason || profile?.suspension_reason || 'No minor allowed for minor safety';
  const hasCoins = wallets.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-2xl space-y-6">
        
        {/* Top Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <span className="font-black text-xl tracking-tight text-white">PAXONES</span>
            <span className="text-xs px-2 py-0.5 rounded bg-rose-950 text-rose-400 font-semibold border border-rose-800/60">
              Account Restricted
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-xs text-slate-400 hover:text-white hover:bg-slate-800 gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </Button>
        </div>

        {/* Primary Banned Status Card */}
        <div className="rounded-2xl border-2 border-rose-600/80 bg-gradient-to-b from-rose-950/50 to-slate-900 p-6 sm:p-8 shadow-2xl space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-600/20 border border-rose-500/40 text-rose-500 flex items-center justify-center shrink-0">
              <AlertOctagon className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                You are Banned
              </h1>
              <p className="text-xs sm:text-sm text-rose-300 font-medium">
                Your Paxones account access has been permanently terminated.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-rose-900/40 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
              Reason for Ban
            </span>
            <p className="text-sm font-semibold text-rose-200">
              {banReason}
            </p>
          </div>

          {/* No Appeal Entertained Notice */}
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/50 flex items-start gap-3 text-rose-200">
            <Lock className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm leading-relaxed">
              <span className="font-bold block text-rose-100 uppercase tracking-wide">
                No Appeal Entertained
              </span>
              This suspension is definitive and permanent under Paxones platform security and regulatory compliance policies. Appeals, tickets, or reinstatement requests will not be entertained.
            </div>
          </div>
        </div>

        {/* One-Time Withdrawal Option (ONLY APPARENT IF USER HAS COINS) */}
        {hasCoins && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8 space-y-5 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  One-Time Final Balance Withdrawal
                </h2>
                <p className="text-xs text-slate-400">
                  Withdraw remaining assets. Only the maximum full balance can be selected per coin.
                </p>
              </div>
            </div>

            {withdrawalSuccess && (
              <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{withdrawalSuccess}</span>
              </div>
            )}

            {withdrawalError && (
              <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{withdrawalError}</span>
              </div>
            )}

            <form onSubmit={handleFinalWithdrawal} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Coin Selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300 font-semibold">Select Cryptocurrency</Label>
                  <select
                    value={selectedCurrency}
                    onChange={(e) => handleCurrencyChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
                  >
                    {wallets.map((w) => (
                      <option key={w.currency} value={w.currency}>
                        {w.currency.toUpperCase()} — {w.balance} available
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount (LOCKED to MAX) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-300 font-semibold">Withdrawal Amount</Label>
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                      MAX ONLY (100%)
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      type="text"
                      readOnly
                      disabled
                      value={`${selectedWallet?.balance || 0} ${selectedCurrency.toUpperCase()}`}
                      className="bg-slate-950 border-slate-800 text-white font-mono text-sm opacity-90 cursor-not-allowed"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-semibold">
                      Full Balance
                    </span>
                  </div>
                </div>
              </div>

              {/* Network */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300 font-semibold">Network</Label>
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="TRC20">TRON (TRC20) - Low Fee</option>
                  <option value="ERC20">Ethereum (ERC20)</option>
                  <option value="Bitcoin">Bitcoin Mainnet</option>
                  <option value="Litecoin">Litecoin Mainnet</option>
                  <option value="Solana">Solana (SOL)</option>
                  <option value="BEP20">BNB Smart Chain (BEP20)</option>
                </select>
              </div>

              {/* Destination Address */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300 font-semibold">Destination Wallet Address</Label>
                <Input
                  type="text"
                  required
                  placeholder="Paste your external wallet address"
                  value={withdrawalAddress}
                  onChange={(e) => setWithdrawalAddress(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white font-mono text-sm"
                />
                <p className="text-[11px] text-slate-400">
                  Verify the receiving address carefully. Transfers on the blockchain cannot be reversed.
                </p>
              </div>

              <Button
                type="submit"
                disabled={submittingWithdrawal}
                className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-bold text-sm transition-colors gap-2"
              >
                {submittingWithdrawal ? (
                  <span>Processing Withdrawal...</span>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Withdraw Max {selectedCurrency.toUpperCase()} ({selectedWallet?.balance || 0})</span>
                  </>
                )}
              </Button>
            </form>
          </div>
        )}

        {/* Action Controls: Trade CSV Export & Delete Account */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            Account Management & Data
          </h3>

          <div className="grid sm:grid-cols-2 gap-4">
            {/* CSV Export Button */}
            <Button
              type="button"
              variant="outline"
              onClick={handleExportCSV}
              disabled={exportingCSV}
              className="w-full py-3 border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200 font-semibold text-xs rounded-xl flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>{exportingCSV ? 'Generating CSV...' : 'Export Trade History (CSV)'}</span>
            </Button>

            {/* Delete Account Button */}
            <Button
              type="button"
              variant="destructive"
              onClick={() => setShowDeleteModal(true)}
              className="w-full py-3 bg-rose-700 hover:bg-rose-600 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Account Permanently</span>
            </Button>
          </div>
        </div>

      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-rose-900/60 rounded-2xl p-6 space-y-4 shadow-2xl text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-rose-950/80 border border-rose-600/40 text-rose-500 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">
                Permanently Delete Account?
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                This action is irreversible. All your profile information and active advertisements will be deleted from the system.
              </p>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deletingAccount}
                onClick={handleDeleteAccount}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl"
              >
                {deletingAccount ? 'Deleting...' : 'Yes, Delete Account'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
