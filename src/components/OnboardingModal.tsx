'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Shield, Mail, Calendar, User, HelpCircle, Lock } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';

export function OnboardingModal() {
  const { toast } = useToast();
  const { refreshProfile } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('first_pet');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [suspendedError, setSuspendedError] = useState('');
  const [showMinorModal, setShowMinorModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    async function checkUserOnboarding() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) return;

        setUser(currentUser);
        setEmail(currentUser.email || '');

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed, full_name, name, dob, date_of_birth, security_question, is_suspended, status')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profile?.is_suspended || profile?.status === 'suspended') {
          return;
        }

        // Trigger onboarding modal if onboarding_completed is false OR security question/dob is missing
        const isCompleted = profile?.onboarding_completed === true && !!(profile?.dob || profile?.date_of_birth) && !!profile?.security_question;
        
        if (!isCompleted) {
          setFullName(profile?.full_name || profile?.name || currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '');
          setDob(profile?.dob || profile?.date_of_birth || currentUser.user_metadata?.dob || '');
          if (profile?.security_question) {
            setSecurityQuestion(profile.security_question);
          }
          setIsOpen(true);
        }
      } catch (err) {
        console.warn('Failed to check onboarding:', err);
      }
    }

    checkUserOnboarding();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuspendedError('');

    if (!fullName.trim()) {
      toast({ variant: 'destructive', title: 'Missing Full Name', description: 'Please provide your legal full name.' });
      return;
    }
    if (!dob) {
      toast({ variant: 'destructive', title: 'Missing Date of Birth', description: 'Please enter your date of birth.' });
      return;
    }

    // 18+ Child Safety check
    const birthDate = new Date(dob);
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

    if (!securityAnswer.trim()) {
      toast({ variant: 'destructive', title: 'Missing Security Answer', description: 'Please enter an answer for your security question.' });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName.trim(),
          fullName: fullName.trim(),
          email: email.trim() || user?.email,
          dob: dob.trim(),
          securityQuestion,
          securityAnswer: securityAnswer.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        if (data.suspended) {
          setSuspendedError(data.error);
          await supabase.auth.signOut();
          toast({
            variant: 'destructive',
            title: 'Account Suspended',
            description: data.error,
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: data.error || 'Could not save profile.',
          });
        }
        setLoading(false);
        return;
      }

      toast({ title: 'Security Profile Completed', description: 'Your profile and security questions are saved successfully.' });
      setIsOpen(false);
      try {
        await refreshProfile?.();
      } catch (e) {
        // ignore
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update Error', description: err.message || 'Could not save profile.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg [&>button]:hidden">
        {showMinorModal ? (
          <div className="text-center space-y-4 py-3 animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <DialogTitle className="text-xl font-bold text-slate-900 dark:text-white">
                Age Requirement Notice (18+ Only)
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Paxones is a peer-to-peer cryptocurrency financial exchange and is strictly restricted to individuals 18 years of age or older for child safety and regulatory compliance.
              </DialogDescription>
              <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold pt-1">
                The date of birth you entered indicates you are under 18 years old.
              </p>
            </div>

            <div className="pt-4 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowMinorModal(false);
                }}
                className="w-full sm:flex-1 min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-800 dark:text-slate-200 font-semibold text-sm transition-all touch-manipulation cursor-pointer flex items-center justify-center select-none shadow-xs"
              >
                Correct Date of Birth
              </button>
              <button
                type="button"
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
                className="w-full sm:flex-1 min-h-[48px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-semibold text-sm transition-all touch-manipulation cursor-pointer flex items-center justify-center select-none disabled:opacity-50 shadow-md shadow-rose-600/20"
              >
                {isDeletingAccount ? 'Deleting...' : 'Delete Account / Cancel'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-primary" />
                </div>
                <span>First-Time Security Profile Setup</span>
              </div>
              <DialogTitle className="text-xl font-bold">Complete Your Identity &amp; Security</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                To ensure account protection and secure P2P trading, please confirm your full name, email, date of birth, and setup your security question.
              </DialogDescription>
            </DialogHeader>

            {suspendedError ? (
              <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-400 space-y-2 my-2">
                <div className="flex items-center gap-2 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Identity Verification Violation</span>
                </div>
                <p className="text-xs leading-relaxed">{suspendedError}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Full Name */}
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
                      placeholder="e.g. John Doe"
                      className="rounded-xl text-sm"
                      required
                    />
                  </div>

                  {/* Email (Read-only / Display) */}
                  <div className="space-y-1.5">
                    <Label htmlFor="onboardingEmail" className="text-xs font-semibold flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Email Address</span>
                    </Label>
                    <Input
                      id="onboardingEmail"
                      type="email"
                      value={email}
                      readOnly
                      disabled
                      className="rounded-xl text-sm bg-muted/50 cursor-not-allowed opacity-80"
                    />
                  </div>
                </div>

                {/* Date of Birth */}
                <div className="space-y-1.5">
                  <Label htmlFor="onboardingDob" className="text-xs font-semibold flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Date of Birth (DOB)</span>
                    <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="onboardingDob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="rounded-xl text-sm"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Required for regulatory compliance and identity verification (18+ only).
                  </p>
                </div>

                {/* Security Question Selection */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Security Question</span>
                    <span className="text-rose-500">*</span>
                  </Label>
                  <Select value={securityQuestion} onValueChange={setSecurityQuestion}>
                    <SelectTrigger className="rounded-xl text-xs sm:text-sm">
                      <SelectValue placeholder="Select security question" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
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
                    placeholder="Enter secret answer"
                    className="rounded-xl text-sm"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    This answer will be used to verify high-security actions or account recovery.
                  </p>
                </div>

                <DialogFooter className="pt-3">
                  <Button type="submit" className="w-full rounded-xl font-bold min-h-[44px] py-2.5 touch-manipulation cursor-pointer" disabled={loading}>
                    {loading ? 'Validating & Saving to Database...' : 'Save & Complete Setup'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  </>
  );
}
