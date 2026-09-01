"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/logo";
import { useToast } from "@/hooks/use-toast";
import { useState, Suspense, useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { signInWithIdentifier, getUserProfile } from "@/lib/auth";
import { checkSupabaseConfig } from "@/lib/supabase/client";

const formSchema = z.object({
  identifier: z.string().min(1, { message: "Email or Username is required." }),
  password: z.string().min(1, { message: "Password is required." }),
  captcha: z.boolean().refine((val) => val === true, {
    message: "Please confirm you are not a robot.",
  }),
});

function LoginFormComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  const redirectUrl = searchParams.get('redirect');

  useEffect(() => {
    const config = checkSupabaseConfig();
    setIsConfigured(config.isConfigured);
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      identifier: "",
      password: "",
      captcha: false,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      const { data, error } = await signInWithIdentifier(values.identifier, values.password);

      if (error) {
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: error.message || "Invalid credentials. Please check your email/username and password.",
        });
        return;
      }

      if (data?.user) {
        const profile = await getUserProfile(data.user.id);

        if (profile?.is_admin || profile?.role === 'admin') {
          toast({
            title: "Admin Login Successful",
            description: "Redirecting to admin dashboard...",
          });
          router.push('/adminnarayan/dashboard');
        } else {
          toast({
            title: "Login Successful",
            description: `Welcome back${profile?.display_name ? `, ${profile.display_name}` : ''}!`,
          });
          router.push(redirectUrl || '/wallets');
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="flex justify-center mb-4">
            <Logo />
          </Link>
          <CardTitle className="text-2xl">Welcome Back</CardTitle>
          <CardDescription>
            Enter your credentials to access your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConfigured && (
            <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs flex gap-2.5 items-start">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-semibold">Supabase Configuration Required</p>
                <p>
                  To enable authentication, please provide your <span className="font-mono font-semibold">NEXT_PUBLIC_SUPABASE_URL</span> and <span className="font-mono font-semibold">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> in the <strong>Settings &gt; Secrets / Environment Variables</strong> menu.
                </p>
              </div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="identifier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email or Username</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="you@example.com or your_username"
                        autoComplete="username"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center">
                      <FormLabel>Password</FormLabel>
                      <Button asChild variant="link" className="p-0 h-auto text-sm">
                        <Link href="/forgot-password">Forgot password?</Link>
                      </Button>
                    </div>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="captcha"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>
                        I am not a robot
                      </FormLabel>
                    </div>
                    <FormMessage className="absolute" />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "Logging in..." : "Log In"}
              </Button>
            </form>
          </Form>
          <div className="mt-6 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Join us
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <LoginFormComponent />
    </Suspense>
  );
}
