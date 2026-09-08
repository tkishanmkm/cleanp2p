'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Flag, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export interface ReportIssueDialogProps {
  tradeId: string;
  tradePublicId?: string;
  reportedUserId?: string;
  triggerButton?: React.ReactNode;
}

const REPORT_CATEGORIES = [
  { value: 'CHARGEBACK', label: 'I experienced a chargeback / fraudulent reversal' },
  { value: 'OFF_PLATFORM', label: 'Off-platform trade / communication request attempt' },
  { value: 'INCORRECT_AMOUNT', label: 'Incorrect payment amount received' },
  { value: 'IDENTITY_MISMATCH', label: 'Identity mismatch / Third-party payment attempt' },
  { value: 'PAYMENT_DELAY_FREEZE', label: 'Delayed payment or bank account flag/freeze' },
  { value: 'SUSPICIOUS_BEHAVIOR', label: 'Other suspicious user behavior' },
];

export function ReportIssueDialog({
  tradeId,
  tradePublicId,
  reportedUserId,
  triggerButton,
}: ReportIssueDialogProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [evidenceUrl, setEvidenceUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!category) {
      toast({
        title: 'Select a category',
        description: 'Please select a reason for reporting this trade.',
        variant: 'destructive',
      });
      return;
    }

    if (!description.trim()) {
      toast({
        title: 'Description required',
        description: 'Please provide a brief explanation of the issue encountered.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/trade/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId,
          tradePublicId: tradePublicId || tradeId,
          reportedUserId,
          category,
          description: description.trim(),
          evidenceUrls: evidenceUrl.trim() ? [evidenceUrl.trim()] : [],
        }),
      });

      const json = await response.json();

      if (!response.ok || json.error) {
        throw new Error(json.error || 'Failed to submit report');
      }

      setSubmitted(true);
      toast({
        title: 'Report Submitted',
        description: 'Our security and compliance team has received your report and opened an investigation.',
      });

      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setDescription('');
        setEvidenceUrl('');
        setCategory('');
      }, 2000);
    } catch (err: any) {
      toast({
        title: 'Submission Failed',
        description: err.message || 'An error occurred while submitting your report.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm" className="gap-2 border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">
            <Flag className="w-4 h-4" />
            <span>Report an Issue</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="w-5 h-5" />
            <DialogTitle>Report an Issue</DialogTitle>
          </div>
          <DialogDescription>
            Flag post-trade irregularities or fraudulent activity on trade{' '}
            <span className="font-mono font-bold text-foreground">{tradePublicId || tradeId}</span>. Our security desk will review your submission.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-green-500 animate-in zoom-in" />
            <div className="text-base font-semibold text-foreground">Report Received</div>
            <p className="text-sm text-muted-foreground max-w-xs">
              Thank you for keeping Paxones safe. An administrative officer has been assigned to this case.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="category" className="text-xs font-semibold">
                Reason / Category <span className="text-red-500">*</span>
              </Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category" className="w-full">
                  <SelectValue placeholder="Select the issue type" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value} className="text-xs sm:text-sm">
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-xs font-semibold">
                Detailed Explanation <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Describe what occurred, including transaction IDs, bank references, or counterparty actions..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="text-sm resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evidence" className="text-xs font-semibold">
                Supporting Evidence Link (Optional)
              </Label>
              <Input
                id="evidence"
                placeholder="Google Drive, Dropbox, or OneDrive shareable link"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                Ensure permissions are set to &quot;Anyone with the link can view&quot;.
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={loading}
                className="gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <Flag className="w-4 h-4" />
                    <span>Submit Report</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
