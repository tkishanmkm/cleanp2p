
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
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
  Beaker,
  DatabaseZap,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useMemoFirebase } from "@/firebase";
import { query, where, collection, collectionGroup } from "firebase/firestore";
import type { Deposit, Withdrawal, Dispute, SupportTicket } from "@/lib/types";
import { signOut } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";

const settingsItems = [
    { href: "/adminnarayan/appearance", label: "Appearance", icon: Brush },
    { href: "/adminnarayan/settings/deposit-address-sets", label: "Deposit Sets", icon: Wallet },
    { href: "/adminnarayan/settings/assign-wallet-set", label: "Assign Wallet Sets", icon: DatabaseZap },
    { href: "/adminnarayan/settings/data", label: "Data Management", icon: Database },
    { href: "/adminnarayan/settings/backfill-wallets", label: "Backfill Wallets", icon: DatabaseZap },
    { href: "#", label: "Security Logs", icon: FileText },
]

export function AdminSidebar() {
  const pathname = usePathname();
  const { firestore, auth, user } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  
  const pendingDepositsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'deposits'), where('status', '==', 'awaiting_confirmation')) : null, [firestore]);
  const { data: pendingDeposits } = useCollection<Deposit>(pendingDepositsQuery);
  
  const pendingWithdrawalsQuery = useMemoFirebase(() => firestore ? query(collectionGroup(firestore, 'withdrawals'), where('status', '==', 'pending')) : null, [firestore]);
  const { data: pendingWithdrawals } = useCollection<Withdrawal>(pendingWithdrawalsQuery);
  
  const openTicketsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'support_tickets'), where('status', '==', 'Open')) : null, [firestore]);
  const { data: openTickets } = useCollection<SupportTicket>(openTicketsQuery);
  
  const openDisputesQuery = useMemoFirebase(() => firestore ? query(collectionGroup(firestore, 'disputes'), where('status', '==', 'open')) : null, [firestore]);
  const { data: openDisputes } = useCollection<Dispute>(openDisputesQuery);

  const menuItems = [
    { href: "/adminnarayan/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/adminnarayan/users", label: "Users", icon: Users },
    { href: "/adminnarayan/wallets", label: "Wallets & Custody", icon: Wallet },
    { href: "/adminnarayan/trades", label: "Trades", icon: ArrowLeftRight },
    { href: "/adminnarayan/transfers", label: "Transfers", icon: Send },
    { href: "/adminnarayan/deposits", label: "Deposits", icon: ArrowDownToLine, badge: pendingDeposits?.length || 0 },
    { href: "/adminnarayan/withdrawals", label: "Withdrawals", icon: ArrowUpFromLine, badge: pendingWithdrawals?.length || 0 },
    { href: "/adminnarayan/ads", label: "Ads", icon: FileText },
    { href: "/adminnarayan/support", label: "Support", icon: LifeBuoy, badge: openTickets?.length || 0 },
    { href: "/adminnarayan/disputes", label: "Disputes", icon: ShieldAlert, badge: openDisputes?.length || 0 },
    { href: "/adminnarayan/escrow", label: "Escrow", icon: DollarSign },
  ];

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/adminnarayan/login');
    } catch (error) {
      toast({ variant: "destructive", title: "Logout Failed", description: "An error occurred during logout." });
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
                <SidebarMenuButton
                  isActive={pathname === item.href}
                  icon={<item.icon />}
                  tooltip={item.label}
                >
                  <span className="flex-grow">{item.label}</span>
                  {item.badge != null && item.badge > 0 && <Badge variant="destructive" className="ml-auto">{item.badge}</Badge>}
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
