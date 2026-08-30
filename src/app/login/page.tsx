
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
import { useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { useState, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, UserCredential } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createUserSession } from "@/lib/users";

const formSchema = z.object({
  userId: z.string().min(1, { message: "User ID is required." }),
  password: z.string().min(1, { message: "Password is required." }),
  captcha: z.boolean().refine((val) => val === true, {
    message: "Please confirm you are not a robot.",
  }),
});

function LoginFormComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const redirectUrl = searchParams.get('redirect');

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      userId: "",
      password: "",
      captcha: false,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth || !firestore) {
      toast({ variant: "destructive", title: "Error", description: "Authentication service not ready."});
      return;
    }
    setIsLoading(true);

    const domainsToTry = [
      "email.com",
      "paxones.app",
      "tradenance.app",
      "tradenaire.app",
      "tradeflow.app"
    ];
    let userCredential: UserCredential | null = null;
    let lastError: any = null;

    try {
      await setPersistence(auth, browserLocalPersistence);

      for (const domain of domainsToTry) {
        try {
          const email = `${values.userId}@${domain}`;
          userCredential = await signInWithEmailAndPassword(auth, email, values.password);
          if (userCredential) break; // Success, exit loop
        } catch (error: any) {
          lastError = error; // Store the error and continue to the next domain
        }
      }
      
      if (userCredential) {
        // --- SUCCESS ---
        const { user } = userCredential;
        const sessionId = await createUserSession(firestore, user);
        if (sessionId) {
          sessionStorage.setItem('sessionId', sessionId);
        }

        const adminDocRef = doc(firestore, "admins", user.uid);
        const adminDocSnap = await getDoc(adminDocRef);

        if (adminDocSnap.exists() && adminDocSnap.data().role === 'admin') {
          toast({ title: "Admin Login Successful", description: "Redirecting to admin dashboard..." });
          router.push('/adminnarayan/dashboard');
        } else {
          const userDocRef = doc(firestore, "users", user.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
              toast({ title: "Logging In...", description: "Please wait while we log you in." });
              router.push(redirectUrl || '/buy');
          } else {
              await auth.signOut();
              throw new Error("User profile not found. Please contact support.");
          }
        }
      } else {
        // If userCredential is still null after all attempts, throw the last recorded error.
        throw lastError || new Error("Login failed. Please check your credentials.");
      }

    } catch (error: any) {
      let description = "An unknown error occurred. Please try again.";
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
          description = "The User ID or password you entered is incorrect.";
      } else if (error.message) {
          description = error.message;
      }
      toast({ variant: "destructive", title: "Login Failed", description });
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
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="userId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>User ID</FormLabel>
                    <FormControl>
                      <Input placeholder="YourUniqueUserID" {...field} />
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
                      <Input type="password" placeholder="••••••••" {...field} />
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
                     <FormMessage className="absolute"/>
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
            Don't have an account?{" "}
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
    )
}
