
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
import { Loader2, AlertCircle, CheckCircle2, Copy, Check, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";
import { useState, Suspense, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { countries } from "@/lib/countries";
import { SECURITY_QUESTIONS } from "@/lib/constants";
import { signUpWithEmail, updateUserProfile } from "@/lib/auth";
import { checkSupabaseConfig } from "@/lib/supabase/client";

const formSchema = z.object({
  fullName: z.string().min(2, { message: "Full name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
  confirmPassword: z.string().min(8, { message: "Confirm password is required." }),
  day: z.string({ required_error: "Day is required." }),
  month: z.string({ required_error: "Month is required." }),
  year: z.string({ required_error: "Year is required." }),
  country: z.string().min(1, "Please select your country."),
  securityQuestion: z.string().min(1, "Please select a security question."),
  securityAnswer: z.string().min(3, "Answer must be at least 3 characters long."),
  captcha: z.boolean().refine((val) => val === true, {
    message: "Please confirm you are not a robot.",
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
}).refine((data) => {
  const date = new Date(parseInt(data.year), parseInt(data.month) - 1, parseInt(data.day));
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  return !isNaN(date.getTime()) &&
    date.getFullYear() === parseInt(data.year) &&
    date.getMonth() === parseInt(data.month) - 1 &&
    date.getDate() === parseInt(data.day) &&
    date <= eighteenYearsAgo;
}, {
  message: "You must be at least 18 and select a valid date.",
  path: ["year"],
});

type SignupFormValues = z.infer<typeof formSchema>;

function SignupFormComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlEmail = searchParams?.get("email") || searchParams?.get("userId") || "";
  const { toast } = useToast();
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  const [createdAccountInfo, setCreatedAccountInfo] = useState<{
    email: string;
    username: string;
  } | null>(null);
  const [copiedUsername, setCopiedUsername] = useState(false);

  useEffect(() => {
    const config = checkSupabaseConfig();
    setIsConfigured(config.isConfigured);
  }, []);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      email: urlEmail,
      password: "",
      confirmPassword: "",
      day: "",
      month: "",
      year: "",
      country: "",
      securityQuestion: "",
      securityAnswer: "",
      captcha: false,
    },
  });

  // Keep form email synchronized if URL param loads later
  useEffect(() => {
    if (urlEmail && !form.getValues("email")) {
      form.setValue("email", urlEmail);
    }
  }, [urlEmail, form]);

  async function onSubmit(values: SignupFormValues) {
    setIsSigningUp(true);

    try {
      // 1. Sign up with email via Supabase Auth
      const { data, error } = await signUpWithEmail(values.email, values.password, {
        displayName: values.fullName,
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Signup Failed",
          description: error.message,
        });
        setIsSigningUp(false);
        return;
      }

      const assignedUsername = data?.assignedUsername || (data?.user?.user_metadata?.username as string) || "trader_user";

      if (data?.user) {
        // 2. Update additional profile details if available
        const dob = new Date(parseInt(values.year), parseInt(values.month) - 1, parseInt(values.day));
        await updateUserProfile(data.user.id, {
          display_name: values.fullName,
        });

        toast({
          title: "Account Created Successfully",
          description: `Assigned User ID: ${assignedUsername}`,
        });

        setCreatedAccountInfo({
          email: values.email,
          username: assignedUsername,
        });
      }
    } catch (error: unknown) {
      console.error("Error during sign up:", error);
      const description = error instanceof Error ? error.message : "An unexpected error occurred. Please try again.";
      toast({ variant: "destructive", title: "Signup Failed", description });
    } finally {
      setIsSigningUp(false);
    }
  }

  if (createdAccountInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/50 p-4">
        <Card className="w-full max-w-md border border-[#9273FC]/30 shadow-2xl bg-white dark:bg-[#18181c] rounded-2xl overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-[#9273FC] via-[#6366F1] to-[#3B82F6]" />
          <CardHeader className="text-center pt-8 pb-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <CheckCircle2 className="h-9 w-9 stroke-[2.5]" />
            </div>
            <CardTitle className="text-2xl font-bold">Account Created Successfully!</CardTitle>
            <CardDescription className="text-sm">
              Welcome to Paxones. Your secure peer-to-peer trading account is now ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 px-6 pb-8">
            <div className="rounded-xl border border-[#9273FC]/25 bg-[#9273FC]/5 dark:bg-[#9273FC]/10 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#9273FC] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Assigned User ID / Username
                </span>
                <span className="text-[11px] font-semibold text-muted-foreground bg-background/80 px-2 py-0.5 rounded-full border">
                  Auto-assigned
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                <span className="font-mono text-xl font-extrabold text-slate-900 dark:text-white tracking-wide">
                  {createdAccountInfo.username}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(createdAccountInfo.username);
                    setCopiedUsername(true);
                    setTimeout(() => setCopiedUsername(false), 2000);
                  }}
                  className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {copiedUsername ? (
                    <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                      <Check className="h-3.5 w-3.5" /> Copied
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </span>
                  )}
                </Button>
              </div>
              <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-400 pt-1">
                <strong>One-time change notice:</strong> You did not choose a username during signup. You can change this generated User ID <strong>only once</strong> from your Account Settings.
              </p>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Registered Email: <span className="font-semibold text-foreground">{createdAccountInfo.email}</span></span>
              </div>
            </div>

            <Button
              onClick={() => router.push("/wallets")}
              className="w-full h-12 text-base font-bold rounded-xl bg-gradient-to-r from-[#9273FC] via-[#6366F1] to-[#3B82F6] hover:opacity-95 text-white shadow-lg shadow-indigo-500/25 cursor-pointer"
            >
              <span>Continue to Platform</span>
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() - 18);
  const toYear = maxDate.getFullYear();
  const fromYear = 1924;

  const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => String(toYear - i));
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }),
  }));
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="flex justify-center mb-4">
            <Logo />
          </Link>
          <CardTitle className="text-2xl">Create an Account</CardTitle>
          <CardDescription>
            Join Paxones to start trading securely.
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormItem>
                <FormLabel>Date of Birth</FormLabel>
                <div className="grid grid-cols-3 gap-2">
                  <FormField
                    control={form.control}
                    name="month"
                    render={({ field }) => (
                      <FormItem>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="day"
                    render={({ field }) => (
                      <FormItem>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {days.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="year"
                    render={({ field }) => (
                      <FormItem>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </FormItem>

              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select your country" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {countries.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="securityQuestion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Security Question</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select a security question" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SECURITY_QUESTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="securityAnswer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Security Answer</FormLabel>
                    <FormControl>
                      <Input placeholder="Your secret answer" {...field} />
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

              <div className="text-xs text-muted-foreground">
                By creating an account, you agree to our{" "}
                <Link href="/terms" className="underline hover:text-primary">Terms of Service</Link> and{" "}
                <Link href="/policy" className="underline hover:text-primary">Privacy Policy</Link>.
              </div>

              <Button type="submit" className="w-full" disabled={isSigningUp}>
                {isSigningUp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSigningUp ? "Creating Account..." : "Join us"}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Log In
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignupFormComponent />
    </Suspense>
  );
}