'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export function OnboardingModal() {
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('first_pet');
  const [securityAnswer, setSecurityAnswer] = useState('');

  useEffect(() => {
    async function checkUserOnboarding() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) return;

        setUser(currentUser);

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed, full_name, dob')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profile && profile.onboarding_completed === false) {
          setFullName(profile?.full_name || currentUser.user_metadata?.full_name || '');
          setIsOpen(true);
        }
      } catch (err) {
        console.warn('Failed to check onboarding:', err);
      }
    }

    checkUserOnboarding();
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !dob || !securityAnswer) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Please fill out all fields.' });
      return;
    }

    setLoading(true);

    try {
      // 1. Try RPC function
      const { error: rpcErr } = await supabase.rpc('complete_user_onboarding', {
        p_user_id: user.id,
        p_full_name: fullName,
        p_dob: dob,
        p_security_question: securityQuestion,
        p_security_answer: securityAnswer
      });

      if (rpcErr) {
        // Direct profile update fallback
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({
            full_name: fullName,
            dob: dob,
            security_question: securityQuestion,
            security_answer: securityAnswer,
            onboarding_completed: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);

        if (updateErr) {
          toast({ variant: 'destructive', title: 'Update Failed', description: updateErr.message });
          setLoading(false);
          return;
        }
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
            Please complete your profile details to start trading.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="fullName">Full Name</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>

          <div className="space-y-1">
            <Label htmlFor="dob">Date of Birth</Label>
            <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
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
            <Input id="securityAnswer" type="password" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} required />
          </div>

          <DialogFooter className="pt-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Saving...' : 'Save & Continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
