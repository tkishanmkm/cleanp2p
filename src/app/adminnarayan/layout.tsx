
"use client";

import { AdminSidebar } from "@/components/admin/sidebar";
import { SidebarProvider, Sidebar } from "@/components/ui/sidebar";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AdminHeader } from "@/components/admin/header";

/**
 * Smart Admin Layout
 * This layout applies to all routes under /adminnarayan.
 * It conditionally renders the sidebar shell based on whether the user is on the login page.
 */
export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { isAdmin, isLoading } = useAdminStatus();
  const router = useRouter();

  const isLoginPage = pathname === "/adminnarayan/login";

  useEffect(() => {
    // Redirect to login if not authenticated and trying to access a protected admin page
    if (!isLoading && !isAdmin && !isLoginPage) {
      router.push("/adminnarayan/login");
    }
  }, [isAdmin, isLoading, router, isLoginPage]);

  // For the login page, render children directly without the sidebar shell
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Show loading spinner while checking admin status for protected pages
  if (isLoading || !isAdmin) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Main Admin Panel Shell
  return (
    <SidebarProvider>
      <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <Sidebar className="hidden md:block">
           <div className="flex h-full max-h-screen flex-col gap-2 border-r bg-muted/40">
                <AdminSidebar />
            </div>
        </Sidebar>
        <div className="flex flex-col">
          <AdminHeader />
          <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-secondary/20">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
