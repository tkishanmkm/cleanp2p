"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/i18n-context";
import { ArrowRight, Mail } from "lucide-react";

export function HomeSignupForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      router.push(`/signup?email=${encodeURIComponent(email.trim())}`);
    } else {
      router.push('/signup');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5 w-full">
      <div className="relative flex-1">
        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="email"
          required
          placeholder="Enter your email address"
          className="h-12 pl-11 text-base bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl focus-visible:ring-[#9273FC] shadow-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button 
        type="submit" 
        size="lg" 
        className="h-12 text-base font-bold px-7 rounded-xl bg-gradient-to-r from-[#9273FC] via-[#6366F1] to-[#3B82F6] hover:opacity-95 text-white shadow-md shadow-indigo-500/25 transition-all shrink-0 cursor-pointer"
      >
        <span>Get Started</span>
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </form>
  );
}
