import Link from 'next/link';
import { Logo } from '@/components/logo';

export function Footer() {
  return (
    <footer className="w-full bg-slate-50 dark:bg-[#07090e] border-t border-slate-200 dark:border-[#1e2640] py-12 px-6 text-slate-600 dark:text-slate-400 text-xs transition-colors duration-200">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
        {/* Brand & Contact Information */}
        <div className="space-y-3">
          <Link href="/" className="inline-block">
            <Logo variant="desktop" className="h-8" />
          </Link>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Secure, peer-to-peer cryptocurrency trading platform with automated escrow protection.
          </p>
          <div className="pt-2">
            <span className="block text-slate-500 dark:text-slate-500 font-medium mb-1">Contact Us:</span>
            <a 
              href="mailto:support@paxones.com" 
              className="inline-flex items-center gap-1.5 text-slate-800 dark:text-slate-200 hover:text-[#9273FC] dark:hover:text-[#9273FC] font-mono text-sm underline transition-colors"
            >
              <svg className="h-3.5 w-3.5 text-[#9273FC]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 2.5L20.5 7.5V16.5L12 21.5L3.5 16.5V7.5L12 2.5Z" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
              support@paxones.com
            </a>
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="text-slate-900 dark:text-white font-semibold mb-3">Trading</h4>
          <ul className="space-y-2">
            <li><Link href="/p2p" className="hover:text-slate-900 dark:hover:text-white transition-colors">Buy Crypto</Link></li>
            <li><Link href="/p2p" className="hover:text-slate-900 dark:hover:text-white transition-colors">Sell Crypto</Link></li>
            <li><Link href="/ads/create" className="hover:text-slate-900 dark:hover:text-white transition-colors">Post an Ad</Link></li>
            <li><Link href="/transfer" className="hover:text-slate-900 dark:hover:text-white transition-colors">Internal Transfer (1.5% Fee)</Link></li>
          </ul>
        </div>

        {/* Support & Help */}
        <div>
          <h4 className="text-slate-900 dark:text-white font-semibold mb-3">Support & Help</h4>
          <ul className="space-y-2">
            <li>
              <a href="mailto:support@paxones.com" className="hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 text-[#9273FC]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                </svg>
                Help Desk (support@paxones.com)
              </a>
            </li>
            <li><Link href="/faq" className="hover:text-slate-900 dark:hover:text-white transition-colors">FAQ & User Guides</Link></li>
            <li><Link href="/support" className="hover:text-slate-900 dark:hover:text-white transition-colors">Submit Support Ticket</Link></li>
          </ul>
        </div>

        {/* Legal Disclosures */}
        <div>
          <h4 className="text-slate-900 dark:text-white font-semibold mb-3">Legal & Compliance</h4>
          <ul className="space-y-2">
            <li><Link href="/terms" className="hover:text-slate-900 dark:hover:text-white transition-colors">Terms of Service</Link></li>
            <li><Link href="/policy" className="hover:text-slate-900 dark:hover:text-white transition-colors">Privacy Policy</Link></li>
          </ul>
        </div>
      </div>

      {/* Footer Bottom Bar */}
      <div className="max-w-7xl mx-auto pt-6 border-t border-slate-200 dark:border-[#1e2640]/50 flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-slate-500 dark:text-slate-500">
        <p>© 2026 Paxones™ All rights reserved.</p>
        <p className="flex items-center gap-1.5">
          <span>Direct Channel:</span>
          <a href="mailto:support@paxones.com" className="text-slate-700 dark:text-slate-400 hover:text-[#9273FC] hover:underline flex items-center gap-1 font-mono">
            support@paxones.com
          </a>
        </p>
      </div>
    </footer>
  );
}
