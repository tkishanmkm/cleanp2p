'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAd } from './actions';

export function CreateAdForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const formData = new FormData(e.currentTarget);
    const payload = {
      type: formData.get('type') as string,
      crypto: formData.get('crypto') as string,
      fiat: formData.get('fiat') as string,
      price: Number(formData.get('price')),
      totalAmount: Number(formData.get('totalAmount')),
      minLimit: Number(formData.get('minLimit')),
      maxLimit: Number(formData.get('maxLimit')),
      paymentMethods: (formData.get('paymentMethods') as string)?.split(',') || ['Bank Transfer'],
      terms: formData.get('terms') as string,
    };

    try {
      // Direct Server Action invocation prevents HTML response parsing crashes
      const res = await createAd(payload);

      if (res.error) {
        setErrorMsg(res.error.message);
        setLoading(false);
        return;
      }

      if (res.data?.id) {
        // Successful creation -> Redirect to dynamic ad detail view
        router.push(`/ad/${res.data.id}`);
        router.refresh();
      } else {
        router.push('/my-ads');
      }
    } catch (err: any) {
      console.error('Failed to submit form:', err);
      setErrorMsg('Network or server error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto p-6 bg-slate-900 rounded-xl">
      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* Form Inputs */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Ad Type</label>
        <select name="type" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800">
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Crypto Symbol</label>
          <input name="crypto" defaultValue="BTC" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Fiat Symbol</label>
          <input name="fiat" defaultValue="USD" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Price</label>
          <input name="price" type="number" step="any" defaultValue="75000" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Total Amount</label>
          <input name="totalAmount" type="number" step="any" defaultValue="1.5" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Min Limit</label>
          <input name="minLimit" type="number" defaultValue="100" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Max Limit</label>
          <input name="maxLimit" type="number" defaultValue="5000" className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-800" />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-all disabled:opacity-50"
      >
        {loading ? 'Creating Ad...' : 'Post Advertisement'}
      </button>
    </form>
  );
}
export default CreateAdForm;
