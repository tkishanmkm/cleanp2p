import Link from 'next/link';

export function Footer() {
  return (
    <footer className="w-full bg-slate-50 dark:bg-[#07090e] border-t border-slate-200 dark:border-[#1e2640] py-12 px-6 text-slate-600 dark:text-slate-400 text-xs transition-colors duration-200">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
        {/* Brand & Registry Information */}
        <div className="space-y-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-wider">PAXONES</h3>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Secure, peer-to-peer cryptocurrency trading platform with automated escrow protection.
          </p>
          <div className="pt-2">
            <span className="block text-slate-500 dark:text-slate-500 font-medium">Official Registry Contact:</span>
            <a 
              href="mailto:support@paxones.com" 
              className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-mono text-sm underline transition-colors"
            >
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

        {/* Support & Compliance */}
        <div>
          <h4 className="text-slate-900 dark:text-white font-semibold mb-3">Support & Help</h4>
          <ul className="space-y-2">
            <li>
              <a href="mailto:support@paxones.com" className="hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1">
                📧 Help Center (support@paxones.com)
              </a>
            </li>
            <li><Link href="/faq" className="hover:text-slate-900 dark:hover:text-white transition-colors">FAQ & Guides</Link></li>
            <li><Link href="/disputes" className="hover:text-slate-900 dark:hover:text-white transition-colors">Dispute Resolution Policy</Link></li>
          </ul>
        </div>

        {/* Legal & Registry Disclosures */}
        <div>
          <h4 className="text-slate-900 dark:text-white font-semibold mb-3">Legal & Compliance</h4>
          <ul className="space-y-2">
            <li><Link href="/terms" className="hover:text-slate-900 dark:hover:text-white transition-colors">Terms of Service</Link></li>
            <li><Link href="/privacy" className="hover:text-slate-900 dark:hover:text-white transition-colors">Privacy Policy</Link></li>
            <li><Link href="/risk-disclosure" className="hover:text-slate-900 dark:hover:text-white transition-colors">Risk Warning</Link></li>
          </ul>
        </div>
      </div>

      {/* Registry Bottom Bar */}
      <div className="max-w-7xl mx-auto pt-6 border-t border-slate-200 dark:border-[#1e2640]/50 flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-slate-500 dark:text-slate-500">
        <p>© 2026 Paxones™. All rights reserved.</p>
        <p>
          Official Registry Contact:{' '}
          <a href="mailto:support@paxones.com" className="text-slate-700 dark:text-slate-400 hover:underline">
            support@paxones.com
          </a>
        </p>
      </div>
    </footer>
  );
}
