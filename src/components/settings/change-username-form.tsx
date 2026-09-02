'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';

import { USERNAME_REGEX, sanitizeUsername } from '@/lib/utils';

const usernameSchema = z.object({
  newUsername: z
    .string()
    .min(1, 'Username must be at least 1 character.')
    .max(25, 'Username cannot exceed 25 characters.')
    .regex(USERNAME_REGEX, 'Username can only contain lowercase letters, numbers, dots (.), and underscores (_).'),
});

export function ChangeUsernameForm({ user: userData }: { user: User }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof usernameSchema>>({
    resolver: zodResolver(usernameSchema),
    defaultValues: {
      newUsername: '',
    },
  });

  const { isSubmitting } = form.formState;

  const handleUsernameChange = async (values: z.infer<typeof usernameSchema>) => {
    if (!user || !userData) return;

    if (values.newUsername === (userData.userId || userData.username)) {
      form.setError('newUsername', { type: 'manual', message: 'This is already your username.' });
      return;
    }

    try {
      // Check if username is taken
      const { data: existingUsers, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', values.newUsername);

      if (checkError) throw checkError;

      if (existingUsers && existingUsers.length > 0) {
        form.setError('newUsername', {
          type: 'manual',
          message: 'This username is already taken. Please choose another one.',
        });
        return;
      }

      // Update username in profiles
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          username: values.newUsername,
          username_changed: true,
          old_username: userData.userId || userData.username,
        })
        .eq('id', user.uid);

      if (updateError) throw updateError;

      // Update Supabase auth user metadata
      await supabase.auth.updateUser({
        data: { username: values.newUsername },
      });

      toast({
        title: 'Username Changed',
        description: `Your new username is ${values.newUsername}.`,
      });
      form.reset({ newUsername: '' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to Change Username',
        description: error.message,
      });
    }
  };

  if (userData?.usernameChanged) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Change Username</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Username Already Changed</AlertTitle>
            <AlertDescription>
              You can only change your username once. Your current username is{' '}
              <span className="font-bold">{userData.userId || userData.username}</span>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleUsernameChange)}>
          <CardHeader>
            <CardTitle>Change Username</CardTitle>
            <CardDescription>You can only change your username once. This action cannot be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="newUsername"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Username</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your new unique username" {...field} />
                  </FormControl>
                  <FormDescription>This will be your new public identity on the platform.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Username
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
