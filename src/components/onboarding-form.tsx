'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Shield, User, Calendar, HelpCircle, Lock, AtSign, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export interface OnboardingProps {
  user: {
    id: string;
    email: string;
    username: string; // Auto-generated handle (e.g. energyko3884)
    fullName?: string;
  };
}

export default function OnboardingForm({ user }: OnboardingProps) {
  const [fullName, setFullName] = useState(user.fullName || '');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('first_pet');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showMinorModal, setShowMinorModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const router = useRouter();
  const supabase = createClientComponentClient();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Please provide your legal full name.');
      return;
    }

    if (!dateOfBirth) {
      setError('Please enter your date of birth.');
      return;
    }

    // 18+ Child Safety check
    const birthDate = new Date(dateOfBirth);
    if (!isNaN(birthDate.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age < 18) {
        setShowMinorModal(true);
        return;
      }
    }

    if (!securityQuestion) {
      setError('Please select a security question.');
      return;
    }

    if (!securityAnswer.trim()) {
      setError('Please provide an answer to your security question.');
      return;
    }

    setLoading(true);

    try {
      // 1. Call secure server endpoint to validate duplicate identities and complete profile
      const response = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName.trim(),
          fullName: fullName.trim(),
          email: user.email,
          dob: dateOfBirth,
          securityQuestion,
          securityAnswer: securityAnswer.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        if (result.suspended) {
          setError(result.error);
          await supabase.auth.signOut();
          toast({
            variant: 'destructive',
            title: 'Account Suspended',
            description: result.error,
          });
        } else {
          setError(result.error || 'Failed to complete profile onboarding.');
          toast({
            variant: 'destructive',
            title: 'Onboarding Error',
            description: result.error || 'Failed to complete profile.',
          });
        }
        setLoading(false);
        return;
      }

      // 2. Direct client verification ensuring display_name = username mapping rule
      try {
        await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim(),
            name: fullName.trim(),
            date_of_birth: dateOfBirth,
            dob: dateOfBirth,
            security_question: securityQuestion,
            security_answer: securityAnswer.trim().toLowerCase(),
            onboarding_completed: true,
            display_name: user.username,
            username: user.username,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);
      } catch (dbErr) {
        console.warn('Direct profile sync note:', dbErr);
      }

      setSuccess(true);
      toast({
        title: 'Onboarding Complete',
        description: 'Your profile and security questions have been saved.',
      });

      // Redirect user to the unified wallets dashboard
      router.push('/wallets');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'An unexpected error occurred.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <Card className="w-full max-w-xl mx-auto border-border shadow-lg">
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2 text-[#6347ea] font-semibold text-sm">
          <div className="w-8 h-8 rounded-full bg-[#6347ea]/10 flex items-center justify-center">
            <Shield className="w-4 h-4 text-[#6347ea]" />
          </div>
          <span>Account Setup &amp; Security</span>
        </div>
        <CardTitle className="text-2xl font-bold">Complete Your Profile</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Welcome to Paxones! Your unique trading handle is ready. Please complete your identity details to activate your account.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Profile setup completed successfully! Redirecting to wallets...</span>
            </div>
          )}

          {/* Read-Only System Generated Handle */}
          <div className="space-y-1.5">
            <Label htmlFor="systemUsername" className="text-xs font-semibold flex items-center gap-1.5">
              <AtSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Paxones Handle (Auto-Generated Username)</span>
            </Label>
            <div className="relative">
              <Input
                id="systemUsername"
                value={`@${user.username}`}
                readOnly
                disabled
                className="bg-muted/60 text-muted-foreground font-mono text-sm cursor-not-allowed pl-3 select-all"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Your public handle is fixed to ensure peer-to-peer reputation integrity.
            </p>
          </div>

          {/* Legal Full Name */}
          <div className="space-y-1.5">
            <Label htmlFor="onboardingFullName" className="text-xs font-semibold flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Legal Full Name</span>
              <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="onboardingFullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alexander Hamilton"
              className="text-sm"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Used strictly for KYC identity verification and payment matching. Kept private from public view.
            </p>
          </div>

          {/* Date of Birth */}
          <div className="space-y-1.5">
            <Label htmlFor="onboardingDob" className="text-xs font-semibold flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Date of Birth</span>
              <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="onboardingDob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="text-sm"
              required
            />
          </div>

          {/* Security Question */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Security Question</span>
              <span className="text-rose-500">*</span>
            </Label>
            <Select value={securityQuestion} onValueChange={setSecurityQuestion}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select security question" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="first_pet">What was the name of your first pet?</SelectItem>
                <SelectItem value="mother_maiden">What is your mother&apos;s maiden name?</SelectItem>
                <SelectItem value="first_school">What was the name of your first school?</SelectItem>
                <SelectItem value="birth_city">In what city or town were you born?</SelectItem>
                <SelectItem value="childhood_nickname">What was your childhood nickname?</SelectItem>
                <SelectItem value="first_car">What was the make of your first car?</SelectItem>
                <SelectItem value="favorite_teacher">What was the last name of your favorite teacher?</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Security Answer */}
          <div className="space-y-1.5">
            <Label htmlFor="onboardingSecurityAnswer" className="text-xs font-semibold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Security Answer</span>
              <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="onboardingSecurityAnswer"
              type="password"
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
              placeholder="Enter your confidential answer"
              className="text-sm"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Required for account recovery and sensitive asset authorization.
            </p>
          </div>
        </CardContent>

        <CardFooter className="pt-2">
          <Button
            type="submit"
            className="w-full bg-[#6347ea] hover:bg-[#5235d6] text-white font-semibold py-2.5"
            disabled={loading}
          >
            {loading ? 'Validating & Completing Setup...' : 'Complete Account Setup'}
          </Button>
        </CardFooter>
      </form>
    </Card>

    {/* Minor Safety Dialog (18+ Requirement) */}
    {showMinorModal && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#0f1423] border border-rose-200 dark:border-rose-900/50 rounded-2xl shadow-2xl p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="mx-auto w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              Age Requirement Notice (18+ Only)
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Paxones is a peer-to-peer cryptocurrency financial exchange and is strictly restricted to individuals 18 years of age or older for child safety and regulatory compliance.
            </p>
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
              The date of birth you entered indicates you are under 18 years old.
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowMinorModal(false)}
              className="flex-1 rounded-xl font-semibold text-sm"
            >
              Correct Date of Birth
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeletingAccount}
              onClick={async () => {
                setIsDeletingAccount(true);
                try {
                  await fetch('/api/user/delete-account', { method: 'POST' }).catch(() => {});
                  await supabase.auth.signOut().catch(() => {});
                  toast({
                    title: 'Account Deleted',
                    description: 'Your account was deleted due to child safety age requirements.',
                  });
                  window.location.href = '/';
                } catch (e: any) {
                  toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete account.' });
                } finally {
                  setIsDeletingAccount(false);
                }
              }}
              className="flex-1 rounded-xl font-semibold text-sm bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
