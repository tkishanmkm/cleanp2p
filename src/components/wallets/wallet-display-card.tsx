
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { UserWallet, CryptoCurrency } from '@/lib/types';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { DepositDialog } from './deposit-dialog';
import { WithdrawDialog } from './withdraw-dialog';

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency, className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

interface WalletDisplayCardProps {
    coin: CryptoCurrency;
    wallets: UserWallet[];
}

export function WalletDisplayCard({ coin, wallets }: WalletDisplayCardProps) {
    const [selectedChain, setSelectedChain] = useState(wallets[0]?.chain || '');
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
    const { toast } = useToast();

    const selectedWallet = wallets.find(w => w.chain === selectedChain) || wallets[0];
    const hasMultipleChains = wallets.length > 1;

    const handleDepositClick = () => {
        setIsDepositOpen(true);
    };

    const handleWithdrawClick = () => {
        setIsWithdrawOpen(true);
    };
    
    return (
        <>
            <DepositDialog
                open={isDepositOpen}
                onOpenChange={setIsDepositOpen}
                wallet={selectedWallet}
            />
            <WithdrawDialog
                open={isWithdrawOpen}
                onOpenChange={setIsWithdrawOpen}
                wallet={selectedWallet}
            />
            <Card>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <CardTitle className="text-xl font-bold">{coin}</CardTitle>
                    <CryptoLogo crypto={coin} className="h-8 w-8 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-4">
                    {hasMultipleChains && (
                        <Select value={selectedChain} onValueChange={setSelectedChain}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Network" />
                            </SelectTrigger>
                            <SelectContent>
                                {wallets.map(w => (
                                    <SelectItem key={w.chain} value={w.chain}>{w.chain}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <div>
                        <div className="text-3xl font-bold">{((selectedWallet?.balance || 0) + (selectedWallet?.lockedBalance || 0)).toFixed(6)}</div>
                        <p className="text-xs text-muted-foreground">Total Balance</p>
                    </div>
                     <div className="text-sm space-y-1">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Available:</span>
                            <span>{(selectedWallet?.balance || 0).toFixed(6)}</span>
                        </div>
                         <div className="flex justify-between">
                            <span className="text-muted-foreground">Locked:</span>
                            <span>{(selectedWallet?.lockedBalance || 0).toFixed(6)}</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex gap-2">
                    <Button size="sm" className="w-full" onClick={handleDepositClick}>
                        <ArrowDown className="mr-2 h-4 w-4" />Deposit
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={handleWithdrawClick}>
                        <ArrowUp className="mr-2 h-4 w-4" />Withdraw
                    </Button>
                </CardFooter>
            </Card>
        </>
    )
}
