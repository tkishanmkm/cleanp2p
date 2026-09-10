'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle } from 'lucide-react';

export function OnboardingModal() {
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('first_pet');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [suspendedError, setSuspendedError] = useState('');

  useEffect(() => {
    async function checkUserOnboarding() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) return;

        setUser(currentUser);

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed, full_name, dob, is_suspended, status')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profile?.is_suspended || profile?.status === 'suspended') {
          return;
        }

        if (profile && profile.onboarding_completed === false) {
          setFullName(profile?.full_name || currentUser.user_metadata?.full_name || '');
          setDob(profile?.dob || currentUser.user_metadata?.dob || '');
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

    if (!fullName.trim() || !dob || !securityAnswer.trim()) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Please fill out all fields.' });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName.trim(),
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

      toast({ title: 'Profile Configured', description: 'Your security profile is complete.' });
      setIsOpen(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update Error', description: err.message || 'Could not save profile.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Complete Security Profile</DialogTitle>
          <DialogDescription>
            Please complete your profile details and date of birth to start trading securely.
          </DialogDescription>
        </DialogHeader>

        {suspendedError ? (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-600 dark:text-red-400 space-y-2 my-2">
            <div className="flex items-center gap-2 font-bold text-xs">
              <AlertTriangle className="w-4 h-4" />
              <span>Identity Verification Violation</span>
            </div>
            <p className="text-xs leading-relaxed">{suspendedError}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="fullName">Legal Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Alex Morgan"
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="dob">Date of Birth</Label>
              <Input
                id="dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label>Security Question</Label>
              <Select value={securityQuestion} onValueChange={setSecurityQuestion}>
                <SelectTrigger>
                  <SelectValue placeholder="Select security question" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first_pet">What was the name of your first pet?</SelectItem>
                  <SelectItem value="mother_maiden">What is your mother&apos;s maiden name?</SelectItem>
                  <SelectItem value="first_school">What was the name of your first school?</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="securityAnswer">Security Answer</Label>
              <Input
                id="securityAnswer"
                type="password"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                placeholder="Answer"
                required
              />
            </div>

            <DialogFooter className="pt-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Validating & Saving...' : 'Save & Continue'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
