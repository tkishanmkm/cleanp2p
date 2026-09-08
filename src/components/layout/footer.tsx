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
            <span className="block text-slate-500 dark:text-slate-500 font-medium">Contact Us:</span>
            <a 
              href="mailto:support@thepax.org" 
              className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-mono text-sm underline transition-colors"
            >
              support@thepax.org
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
              <a href="mailto:support@thepax.org" className="hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1">
                📧 Help Center (support@thepax.org)
              </a>
            </li>
            <li><Link href="/faq" className="hover:text-slate-900 dark:hover:text-white transition-colors">FAQ & Guides</Link></li>
            <li><Link href="/disputes" className="hover:text-slate-900 dark:hover:text-white transition-colors">Dispute Resolution Policy</Link></li>
          </ul>
        </div>

        {/* Legal Disclosures */}
        <div>
          <h4 className="text-slate-900 dark:text-white font-semibold mb-3">Legal & Compliance</h4>
          <ul className="space-y-2">
            <li><Link href="/terms" className="hover:text-slate-900 dark:hover:text-white transition-colors">Terms of Service</Link></li>
            <li><Link href="/policy" className="hover:text-slate-900 dark:hover:text-white transition-colors">Privacy Policy</Link></li>
            <li><Link href="/risk-disclosure" className="hover:text-slate-900 dark:hover:text-white transition-colors">Risk Warning</Link></li>
          </ul>
        </div>
      </div>

      {/* Footer Bottom Bar */}
      <div className="max-w-7xl mx-auto pt-6 border-t border-slate-200 dark:border-[#1e2640]/50 flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-slate-500 dark:text-slate-500">
        <p>© 2026 ThePax. All rights reserved.</p>
        <p>
          Contact Us:{' '}
          <a href="mailto:support@thepax.org" className="text-slate-700 dark:text-slate-400 hover:underline">
            support@thepax.org
          </a>
        </p>
      </div>
    </footer>
  );
}
