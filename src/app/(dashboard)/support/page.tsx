'use client';

import { SupportForm } from '@/components/support/support-form';
import { LifeBuoy, ShieldCheck, Clock, MessageSquare } from 'lucide-react';

export default function SupportPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      {/* Purple-Blue Header Banner */}
      <div className="bg-gradient-to-r from-[#5B4DF6] via-[#6366F1] to-[#3B82F6] text-white p-6 sm:p-8 rounded-2xl shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-medium text-white mb-2">
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>24/7 Platform Assistance</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Customer Support</h1>
            <p className="text-white/80 text-sm mt-1 max-w-xl">
              Need assistance with an escrow trade, deposit, or account verification? Our support team is here to help.
            </p>
          </div>
          <div className="flex sm:flex-col items-start sm:items-end gap-2 text-xs text-white/90">
            <div className="flex items-center gap-1.5 bg-black/10 px-3 py-1.5 rounded-lg">
              <Clock className="w-4 h-4 text-emerald-300" />
              <span>Avg. response: &lt; 15 mins</span>
            </div>
          </div>
        </div>
      </div>

      <SupportForm />
    </div>
  );
}
