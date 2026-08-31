'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import QRCode from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';
import type { CryptoCurrency, UserWallet } from '@/lib/types';
import { getActiveDepositAddress } from '@/lib/supabase/db';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { Badge } from '../ui/badge';

interface DepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: CryptoCurrency | null;
  wallet?: UserWallet | null;
  walletIndex?: number;
  initialDeposit?: unknown;
}

const NETWORK_SPECS: Record<string, { minDeposit: string; confirmations: number }> = {
  'BTC': { minDeposit: '0.0002 BTC', confirmations: 2 },
  'ETH': { minDeposit: '0.005 ETH', confirmations: 12 },
  'LTC': { minDeposit: '0.02 LTC', confirmations: 6 },
  'ERC20': { minDeposit: '20.00 USDT', confirmations: 12 },
  'TRC20': { minDeposit: '5.00 USDT', confirmations: 15 },
  'BEP20': { minDeposit: '5.00 USDT', confirmations: 15 },
  'EVM': { minDeposit: '5.00 USDT', confirmations: 15 },
  'TRON': { minDeposit: '5.00 USDT', confirmations: 15 },
};

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency; className?: string }) => {
  switch (crypto) {
    case 'BTC': return <BtcLogo className={className} />;
    case 'ETH': return <EthLogo className={className} />;
    case 'LTC': return <LtcLogo className={className} />;
    case 'USDT': return <UsdtLogo className={className} />;
    default: return null;
  }
};

/**
 * Maps asset and selected network to the standard backend provisioning chain identifier
 * BNB / ETH / ERC20 / BEP20 -> "EVM"
 * BTC -> "BTC"
 * LTC -> "LTC"
 * TRX / USDT-TRC20 -> "TRON"
 */
function mapChainForProvisioning(assetCode: string, chainCode: string): 'EVM' | 'BTC' | 'LTC' | 'TRON' {
  const normChain = (chainCode || '').toUpperCase().trim();
  const normAsset = (assetCode || '').toUpperCase().trim();

  // 1. Bitcoin
  if (normChain === 'BTC' || normAsset === 'BTC') {
    return 'BTC';
  }

  // 2. Litecoin
  if (normChain === 'LTC' || normAsset === 'LTC') {
    return 'LTC';
  }

  // 3. Tron (TRX, TRC20, USDT-TRC20)
  if (
    normChain === 'TRC20' ||
    normChain === 'TRON' ||
    normChain === 'TRX' ||
    normChain === 'USDT-TRC20' ||
    normChain === 'USDT_TRC20' ||
    normAsset === 'TRX'
  ) {
    return 'TRON';
  }

  // 4. EVM Default (BNB, ETH, ERC20, BEP20, BSC, Polygon, Arbitrum, EVM)
  return 'EVM';
}

export function DepositDialog({ open, onOpenChange, asset, wallet }: DepositDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const effectiveAsset = useMemo<CryptoCurrency>(() => {
    if (asset) return asset;
    if (wallet?.crypto) return wallet.crypto;
    return 'USDT';
  }, [asset, wallet]);

  const [selectedChain, setSelectedChain] = useState<string>('');
  const [depositAddress, setDepositAddress] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const availableChains = useMemo(() => {
    if (wallet?.chain && !asset) {
      return [wallet.chain];
    }
    const supported = SUPPORTED_CRYPTOS.find(c => c.name === effectiveAsset);
    return supported?.chains || [effectiveAsset];
  }, [effectiveAsset, wallet, asset]);

  useEffect(() => {
    if (availableChains.length > 0) {
      if (wallet?.chain && availableChains.includes(wallet.chain)) {
        setSelectedChain(wallet.chain);
      } else {
        setSelectedChain(availableChains[0]);
      }
    } else {
      setSelectedChain('');
    }
  }, [availableChains, wallet, open]);

  const fetchAddress = useCallback(async (chainToUse: string) => {
    if (!effectiveAsset || !chainToUse) return;
    setIsLoading(true);
    setErrorMessage(null);

    const mappedChain = mapChainForProvisioning(effectiveAsset, chainToUse);

    try {
      // Get current session access token directly from Supabase client
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // 1. Primary: POST /api/wallets/provision-address with credentials and auth header
      const provisionRes = await fetch('/api/wallets/provision-address', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          chain: mappedChain,
          asset: effectiveAsset,
          network: chainToUse,
        }),
      });

      const data = await provisionRes.json();

      if (provisionRes.ok && data?.success && data?.address) {
        setDepositAddress(data.address);
        setIsLoading(false);
        return;
      }

      // 2. Secondary: Fallback to /api/wallets/deposit-address
      const legacyRes = await fetch(
        `/api/wallets/deposit-address?asset=${encodeURIComponent(effectiveAsset)}&network=${encodeURIComponent(chainToUse)}`,
        {
          headers,
          credentials: 'same-origin',
        }
      );
      if (legacyRes.ok) {
        const legacyData = await legacyRes.json();
        if (legacyData?.address) {
          setDepositAddress(legacyData.address);
          setIsLoading(false);
          return;
        }
      }

      // 3. Tertiary: Check Supabase public.deposit_addresses if user is loaded
      if (user?.uid) {
        const { data: dbRecord, error: dbError } = await getActiveDepositAddress(user.uid, effectiveAsset, chainToUse);
        if (!dbError && dbRecord?.address) {
          setDepositAddress(dbRecord.address);
          setIsLoading(false);
          return;
        }
      }

      throw new Error(data?.error || 'Could not retrieve a deposit address for this network. Please try again.');
    } catch (err: any) {
      console.error("Deposit address retrieval failed:", err);
      setErrorMessage(err?.message || "Failed to generate deposit address.");
      setDepositAddress('');
    } finally {
      setIsLoading(false);
    }
  }, [effectiveAsset, user]);

  useEffect(() => {
    if (open && selectedChain) {
      fetchAddress(selectedChain);
    } else if (!open) {
      setDepositAddress('');
      setErrorMessage(null);
      setCopied(false);
    }
  }, [open, selectedChain, fetchAddress]);

  const handleCopy = () => {
    if (!depositAddress) return;
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    toast({ title: "Address Copied", description: "Deposit address copied to clipboard." });
    setTimeout(() => setCopied(false), 2500);
  };

  const currentSpec = selectedChain ? NETWORK_SPECS[selectedChain] || NETWORK_SPECS[effectiveAsset] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <CryptoLogo crypto={effectiveAsset} className="h-7 w-7" />
            <div>
              <DialogTitle>Deposit {effectiveAsset}</DialogTitle>
              <DialogDescription>
                Send only {effectiveAsset} to this personal deposit address.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {availableChains.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select Network
              </label>
              <Select value={selectedChain} onValueChange={(val) => setSelectedChain(val)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select network" />
                </SelectTrigger>
                <SelectContent>
                  {availableChains.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c} Network
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">Generating unique deposit address...</p>
              <p className="text-xs text-muted-foreground">Deriving secure address on {selectedChain || effectiveAsset} network</p>
            </div>
          ) : depositAddress ? (
            <div className="space-y-4">
              {/* QR Code */}
              <div className="flex justify-center">
                <div className="p-3 bg-white rounded-xl border shadow-sm">
                  <QRCode value={depositAddress} size={168} renderAs="svg" />
                </div>
              </div>

              {/* Address Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Deposit Address ({selectedChain})</span>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">
                    {selectedChain}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/60 border">
                  <span className="font-mono text-xs break-all select-all flex-1 text-foreground">
                    {depositAddress}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0 h-8 px-2.5"
                    onClick={handleCopy}
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1.5 text-xs">{copied ? "Copied" : "Copy"}</span>
                  </Button>
                </div>
              </div>

              {/* Network Details & Limits */}
              <div className="grid grid-cols-2 gap-2 text-xs p-3 rounded-lg bg-muted/40 border">
                <div>
                  <span className="text-muted-foreground block">Minimum Deposit</span>
                  <span className="font-semibold text-foreground">
                    {currentSpec?.minDeposit || 'No minimum'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Confirmations</span>
                  <span className="font-semibold text-foreground">
                    {currentSpec?.confirmations ? `${currentSpec.confirmations} Blocks` : 'Network Default'}
                  </span>
                </div>
              </div>

              {/* Automatic Crediting Notice */}
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Deposits are detected and credited automatically once the required blockchain confirmations are reached.
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Address Unavailable</AlertTitle>
                <AlertDescription>
                  {errorMessage || "Unable to retrieve deposit address for this network. Please check your connection."}
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => fetchAddress(selectedChain)}
              >
                <RefreshCw className="h-4 w-4" />
                Retry Generation
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
