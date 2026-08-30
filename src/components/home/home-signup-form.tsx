"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/i18n-context";

export function HomeSignupForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [userId, setUserId] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId.trim()) {
      router.push(`/signup?userId=${encodeURIComponent(userId.trim())}`);
    } else {
      router.push('/signup');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
      <Input
        type="text"
        placeholder={t('homeSignupForm.placeholder')}
        className="h-12 text-base bg-background"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      />
      <Button type="submit" size="lg" className="h-12 text-base font-semibold px-8">
        {t('home.joinUs')}
      </Button>
    </form>
  );
}
