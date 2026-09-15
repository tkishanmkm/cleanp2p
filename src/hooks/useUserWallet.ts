import { useState, useEffect } from 'react';

export function useUserWallet() {
  const [walletData, setWalletData] = useState<{
    evm?: string;
    tron?: string;
    btc?: string;
    ltc?: string;
  }>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWallet() {
      try {
        const res = await fetch('/api/wallet/deposit-address');
        const data = await res.json();

        if (data.success && data.addresses) {
          // Set dynamic addresses from API
          setWalletData(data.addresses);
        } else if (data.wallet) {
          setWalletData({
            evm: data.wallet.evm_address || data.wallet.evm,
            btc: data.wallet.btc_address || data.wallet.btc,
            tron: data.wallet.tron_address || data.wallet.tron,
            ltc: data.wallet.ltc_address || data.wallet.ltc,
          });
        }
      } catch (err) {
        console.error('Failed to load deposit addresses', err);
      } finally {
        setLoading(false);
      }
    }

    fetchWallet();
  }, []);

  return { walletData, loading };
}
