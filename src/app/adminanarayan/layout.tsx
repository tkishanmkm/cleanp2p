import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  // Fetch admin status
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();

  const isAuthorized = Boolean(
    profile?.is_admin ||
    profile?.role === 'ADMIN' ||
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'admin'
  );

  if (!isAuthorized) {
    redirect('/unauthorized');
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 font-sans flex">
      {/* Admin Sidebar Navigation */}
      <aside className="w-64 bg-[#0f1423] border-r border-[#1e2640] p-6 hidden md:block shrink-0">
        <div className="flex items-center gap-2 mb-8">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-lg font-extrabold text-white tracking-wider">PAXONES ADMIN</h2>
        </div>
        <nav className="space-y-2 text-sm font-medium">
          <Link
            href="/adminanarayan"
            className="block py-2.5 px-4 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/20 hover:bg-blue-600/20 transition-colors"
          >
            ⚖️ Dispute Resolution Queue
          </Link>
          <Link
            href="/adminanarayan/reports"
            className="block py-2.5 px-4 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors"
          >
            🚨 Security & Issue Reports
          </Link>
          <Link
            href="/adminanarayan/treasury"
            className="block py-2.5 px-4 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors"
          >
            💰 Treasury & 1.5% Fee Ledger
          </Link>
        </nav>
      </aside>

      {/* Main Admin Workspace */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
