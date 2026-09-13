import { redirect } from 'next/navigation';

export default async function TradeRedirectPage({ params }: { params: any }) {
  const resolvedParams = await params;
  const tradeId = resolvedParams?.tradeId;
  redirect(`/trade/${encodeURIComponent(tradeId || '')}`);
}
