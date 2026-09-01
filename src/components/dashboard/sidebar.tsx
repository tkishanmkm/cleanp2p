'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  LifeBuoy,
  LogOut,
  Settings,
  FileText,
  Brush,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Send,
  DollarSign,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

const settingsItems = [
  { href: '/adminnarayan/appearance', label: 'Appearance', icon: Brush },
  { href: '/adminnarayan/wallets', label: 'Wallet Custody', icon: Wallet },
  { href: '/adminnarayan/settings/data', label: 'Data Management', icon: Database },
  { href: '/adminnarayan/settings/deposit-address-sets', label: 'Deposit Sets', icon: FileText },
  { href: '/adminnarayan/settings/assign-wallet-set', label: 'Assign Wallet Set', icon: Database },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [pendingDepositsCount, setPendingDepositsCount] = useState(0);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState(0);
  const [openTicketsCount, setOpenTicketsCount] = useState(0);
  const [openDisputesCount, setOpenDisputesCount] = useState(0);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const { count: depositsCount } = await supabase
          .from('deposits')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'awaiting_confirmation');
        if (depositsCount !== null) setPendingDepositsCount(depositsCount);

        const { count: withdrawalsCount } = await supabase
          .from('withdrawals')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        if (withdrawalsCount !== null) setPendingWithdrawalsCount(withdrawalsCount);

        const { count: ticketsCount } = await supabase
          .from('support_tickets')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'Open');
        if (ticketsCount !== null) setOpenTicketsCount(ticketsCount);

        const { count: disputesCount } = await supabase
          .from('disputes')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'open');
        if (disputesCount !== null) setOpenDisputesCount(disputesCount);
      } catch (err) {
        console.error('Error fetching admin sidebar counts:', err);
      }
    }

    fetchCounts();
  }, []);

  const menuItems = [
    { href: '/adminnarayan/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/adminnarayan/users', label: 'Users', icon: Users },
    { href: '/adminnarayan/trades', label: 'Trades', icon: ArrowLeftRight },
    { href: '/adminnarayan/transfers', label: 'Transfers', icon: Send },
    { href: '/adminnarayan/deposits', label: 'Deposits', icon: ArrowDownToLine, badge: pendingDepositsCount },
    { href: '/adminnarayan/withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine, badge: pendingWithdrawalsCount },
    { href: '/adminnarayan/ads', label: 'Ads', icon: FileText },
    { href: '/adminnarayan/support', label: 'Support', icon: LifeBuoy, badge: openTicketsCount },
    { href: '/adminnarayan/disputes', label: 'Disputes', icon: ShieldAlert, badge: openDisputesCount },
    { href: '/adminnarayan/escrow', label: 'Escrow', icon: DollarSign },
  ];

  const handleLogout = async () => {
    try {
      await signOut();
      toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
      router.push('/adminnarayan/login');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Logout Failed', description: 'An error occurred during logout.' });
    }
  };

  const adminId = user?.email?.split('@')[0];

  return (
    <>
      <SidebarHeader>
        <Logo />
        <Badge variant="destructive">ADMIN</Badge>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <Link href={item.href}>
                <SidebarMenuButton isActive={pathname === item.href} icon={<item.icon />} tooltip={item.label}>
                  <span className="flex-grow">{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <Badge variant="destructive" className="ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center">
            <Settings className="mr-2" />
            Settings
          </SidebarGroupLabel>
          <SidebarMenu>
            {settingsItems.map((item) => (
              <SidebarMenuItem key={item.label}>
                <Link href={item.href}>
                  <SidebarMenuButton isActive={pathname === item.href} icon={<item.icon />} tooltip={item.label}>
                    <span className="flex-grow">{item.label}</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <Separator />
      <SidebarFooter>
        <div className="flex items-center gap-3 p-2">
          <Avatar className="h-10 w-10">
            <AvatarFallback>AD</AvatarFallback>
          </Avatar>
          <div className="overflow-hidden group-data-[collapsible=icon]:hidden">
            <p className="font-semibold truncate">{adminId || 'Admin'}</p>
            <p className="text-xs text-muted-foreground truncate">Super Administrator</p>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton icon={<LogOut />} tooltip="Logout" onClick={handleLogout}>
              Logout
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
