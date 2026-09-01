'use client';

import { useState, useEffect } from 'react';
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
  Users,
  ArrowLeftRight,
  LifeBuoy,
  LogOut,
  ShieldAlert,
  Wallet,
  Settings,
  FileText,
  Brush,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Send,
  DollarSign,
  DatabaseZap,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';

const settingsItems = [
  { href: '/adminnarayan/appearance', label: 'Appearance', icon: Brush },
  { href: '/adminnarayan/settings/deposit-address-sets', label: 'Deposit Sets', icon: Wallet },
  { href: '/adminnarayan/settings/assign-wallet-set', label: 'Assign Wallet Sets', icon: DatabaseZap },
  { href: '/adminnarayan/settings/data', label: 'Data Management', icon: Database },
  { href: '/adminnarayan/settings/backfill-wallets', label: 'Backfill Wallets', icon: DatabaseZap },
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
    let isMounted = true;
    const fetchCounts = async () => {
      try {
        const [depRes, withRes, ticketRes, disputeRes] = await Promise.allSettled([
          supabase.from('deposits').select('id', { count: 'exact', head: true }).eq('status', 'awaiting_confirmation'),
          supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'Open'),
          supabase.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        ]);

        if (isMounted) {
          if (depRes.status === 'fulfilled') setPendingDepositsCount(depRes.value.count || 0);
          if (withRes.status === 'fulfilled') setPendingWithdrawalsCount(withRes.value.count || 0);
          if (ticketRes.status === 'fulfilled') setOpenTicketsCount(ticketRes.value.count || 0);
          if (disputeRes.status === 'fulfilled') setOpenDisputesCount(disputeRes.value.count || 0);
        }
      } catch (e) {
        console.error('Error fetching admin counts:', e);
      }
    };

    fetchCounts();
    return () => {
      isMounted = false;
    };
  }, []);

  const menuItems = [
    { href: '/adminnarayan/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/adminnarayan/users', label: 'Users', icon: Users },
    { href: '/adminnarayan/wallets', label: 'Wallets & Custody', icon: Wallet },
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
    } catch {
      toast({ variant: 'destructive', title: 'Logout Failed', description: 'An error occurred during logout.' });
    }
  };

  const adminId = user?.email?.split('@')[0] || user?.displayName;

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
                <SidebarMenuButton
                  isActive={pathname === item.href}
                  icon={<item.icon />}
                  tooltip={item.label}
                >
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
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </SidebarGroupLabel>
          <SidebarMenu>
            {settingsItems.map((item) => (
              <SidebarMenuItem key={item.label}>
                <Link href={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    icon={<item.icon />}
                    tooltip={item.label}
                  >
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
