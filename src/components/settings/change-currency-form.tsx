'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { currencies } from '@/lib/currencies';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';

const currencySchema = z.object({
  currency: z.string().min(1, 'Please select a currency.'),
});

export function ChangeCurrencyForm({ user: userData }: { user: User }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof currencySchema>>({
    resolver: zodResolver(currencySchema),
    defaultValues: {
      currency: userData?.preferredCurrency || 'USD',
    },
  });

  useEffect(() => {
    if (userData?.preferredCurrency) {
      form.setValue('currency', userData.preferredCurrency);
    }
  }, [userData, form]);

  const { isSubmitting } = form.formState;

  const handleCurrencyChange = async (values: z.infer<typeof currencySchema>) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ preferred_currency: values.currency })
        .eq('id', user.uid);

      if (error) throw error;

      toast({
        title: 'Currency Updated',
        description: 'Your preferred currency has been saved.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'Could not update your preferred currency.',
      });
    }
  };

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleCurrencyChange)}>
          <CardHeader>
            <CardTitle>Preferred Currency</CardTitle>
            <CardDescription>
              Select the currency used to display wallet values and estimates across the platform.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a currency" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Currency
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
