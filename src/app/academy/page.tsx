"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  GraduationCap, 
  BookOpen, 
  ShieldCheck, 
  Scale, 
  AlertTriangle, 
  Lock, 
  ArrowRight, 
  CheckCircle2, 
  Search, 
  HelpCircle, 
  FileCheck,
  TrendingUp,
  Award,
  Clock,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function AcademyPage() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'escrow' | 'disputes' | 'safety' | 'merchants'>('all');

  const guides = [
    {
      id: 'how-p2p-escrow-works',
      title: 'How PaxOnes P2P Escrow Works: Complete Security Guide',
      category: 'escrow',
      readTime: '4 min read',
      excerpt: 'Learn how PaxOnes locks cryptocurrency in smart escrow the moment a trade initiates, protecting both buyers and sellers from counterparty default.',
      content: [
        'When a buyer clicks "Buy", the seller\'s cryptocurrency is automatically deducted and locked into the PaxOnes Escrow Smart Vault.',
        'The buyer makes the fiat payment directly to the seller via their agreed banking or payment method.',
        'Once payment is sent, the buyer clicks "Transferred, Notify Seller". The timer pauses and the trade locks.',
        'The seller verifies receipt of the exact fiat amount in their personal bank account before clicking "Release Escrow".'
      ]
    },
    {
      id: 'dispute-resolution-guide',
      title: 'Dispute Resolution Masterclass: Submitting Winning Evidence',
      category: 'disputes',
      readTime: '6 min read',
      excerpt: 'Step-by-step instructions on what evidence PaxOnes moderators require to resolve payment disputes, chargebacks, and unresponsive trades.',
      content: [
        'Bank Transfers: Provide an unedited PDF statement or official wire receipt showing beneficiary name, account number, reference code, and debit confirmation.',
        'UPI / Instant Transfers: Submit a full screenshot displaying the 12-digit UTR/Ref transaction number and recipient UPI ID.',
        'Video Recording: If asked by moderation, record a continuous screen video opening your banking app, refreshing the transaction history, and demonstrating incoming or outgoing funds.',
        'Never cancel a trade if you have already transferred fiat funds.'
      ]
    },
    {
      id: 'anti-fraud-and-safety',
      title: 'Anti-Phishing & Fraud Prevention Rules for P2P Traders',
      category: 'safety',
      readTime: '5 min read',
      excerpt: 'Crucial rules to identify fraudulent triangle schemes, third-party payment scams, and fake SMS payment notifications.',
      content: [
        'Third-Party Payments Prohibited: The name on the bank account sending funds MUST match the verified legal name on the trader\'s PaxOnes profile.',
        'Fake Receipt Detection: Never rely solely on screenshots or SMS notifications. Always log directly into your banking app to verify balance updates.',
        'Strictly No Off-Platform Chat: Never communicate via Telegram, WhatsApp, or email. Trades conducted outside PaxOnes chat forfeit escrow coverage.'
      ]
    },
    {
      id: 'becoming-a-verified-merchant',
      title: 'Merchant Playbook: Scaling Volume with Gold, Diamond & Elite Tiers',
      category: 'merchants',
      readTime: '5 min read',
      excerpt: 'Discover the requirements for volume thresholds, security deposits, and how to maintain a 99%+ positive feedback rating.',
      content: [
        'Gold Tier: Requires $10,000 in completed volume and 1,000 USDT locked security deposit.',
        'Diamond Tier: Requires $100,000 in volume and 10,000 USDT security deposit for priority moderation.',
        'Elite Tier: Dedicated liquidity desks with $1,000,000+ volume and 50,000 USDT deposit.'
      ]
    }
  ];

  const filteredGuides = guides.filter((g) => {
    const matchesCategory = selectedCategory === 'all' || g.category === selectedCategory;
    const matchesSearch = 
      g.title.toLowerCase().includes(search.toLowerCase()) ||
      g.excerpt.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12 space-y-10">
      {/* Hero Section */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold">
          <GraduationCap className="h-4 w-4" />
          <span>PaxOnes Academy</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
          P2P Trading, Escrow & Safety Knowledge Base
        </h1>

        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 font-normal leading-relaxed">
          Master the fundamentals of peer-to-peer cryptocurrency exchange, non-custodial escrow protection, 
          evidence submission for dispute tribunals, and fraud prevention techniques.
        </p>

        {/* Search Bar */}
        <div className="relative max-w-xl mx-auto pt-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search guides, escrow rules, dispute procedures..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-11 h-12 rounded-2xl bg-white dark:bg-[#0f1423] border-slate-200 dark:border-[#1e2640] shadow-sm text-sm"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {[
          { id: 'all', label: 'All Articles' },
          { id: 'escrow', label: 'Escrow Mechanism' },
          { id: 'disputes', label: 'Dispute Resolution' },
          { id: 'safety', label: 'Safety & Anti-Fraud' },
          { id: 'merchants', label: 'Merchant Playbook' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSelectedCategory(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              selectedCategory === tab.id
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Guides Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredGuides.map((guide) => (
          <Card key={guide.id} className="rounded-3xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423] shadow-md flex flex-col justify-between overflow-hidden">
            <CardHeader className="p-6 pb-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="capitalize bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[11px] font-bold">
                  {guide.category}
                </Badge>
                <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {guide.readTime}
                </span>
              </div>

              <CardTitle className="text-xl font-bold text-slate-900 dark:text-white leading-snug">
                {guide.title}
              </CardTitle>

              <CardDescription className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
                {guide.excerpt}
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 pt-0 space-y-3">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <p className="font-bold text-slate-900 dark:text-white">Key Takeaways:</p>
                <ul className="space-y-1.5 list-disc pl-4 text-[11px] sm:text-xs">
                  {guide.content.map((point, i) => (
                    <li key={i} className="leading-relaxed">{point}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Platform Leadership Notice citing CEO Samuel Parker (Text Format Only, strictly no photo/avatar) */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 text-white border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center gap-2.5 text-amber-400">
          <Award className="h-5 w-5" />
          <h2 className="text-lg font-black tracking-wide uppercase">Platform Leadership Notice</h2>
        </div>

        <blockquote className="text-sm sm:text-base italic text-slate-200 leading-relaxed border-l-2 border-amber-500 pl-4">
          &ldquo;Our fundamental mission at PaxOnes is establishing uncompromising escrow integrity and frictionless liquidity for global traders. 
          Every peer-to-peer exchange is backed by cryptographic custody, transparent dispute guidelines, and stringent compliance standards to eliminate counterparty risk.&rdquo;
        </blockquote>

        <div className="pt-2 text-xs text-slate-400 font-sans">
          <p className="font-bold text-white text-sm">Samuel Parker</p>
          <p className="text-slate-400">Chief Executive Officer, PaxOnes Global</p>
        </div>
      </div>
    </div>
  );
}
