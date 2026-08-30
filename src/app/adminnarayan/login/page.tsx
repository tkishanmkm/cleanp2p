
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useFirebase } from "@/firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, setPersistence, browserLocalPersistence, updateProfile, type User as AuthUser, UserCredential } from "firebase/auth";
import { doc, setDoc, getDoc, type Firestore } from "firebase/firestore";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createUserSession } from "@/lib/users";

const formSchema = z.object({
  adminId: z.string().min(1, { message: "Admin ID is required." }),
  password: z.string().min(1, { message: "Password is required." }),
  captcha: z.boolean().refine((val) => val === true, {
    message: "Please confirm you are not a robot.",
  }),
});


export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { auth, firestore } = useFirebase();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      adminId: "",
      password: "",
      captcha: false,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth || !firestore) {
      toast({ variant: "destructive", title: "Auth service not ready", description: "Please try again in a moment." });
      return;
    }

    setIsLoggingIn(true);
    
    const domainsToTry = [ "email.com", "paxones.app", "tradenance.app", "tradenaire.app", "tradeflow.app" ];
    let userCredential: UserCredential | null = null;
    let lastError: any = null;

    try {
        await setPersistence(auth, browserLocalPersistence);

        // --- PHASE 1: Attempt to log in with all possible domains ---
        for (const domain of domainsToTry) {
            try {
                const email = `${values.adminId}@${domain}`;
                userCredential = await signInWithEmailAndPassword(auth, email, values.password);
                if (userCredential) break; // Login successful, exit loop
            } catch (error: any) {
                lastError = error;
                // Continue to next domain
            }
        }
        
        if (userCredential) {
            const { user } = userCredential;
            const adminRoleRef = doc(firestore, 'admins', user.uid);
            const adminRoleSnap = await getDoc(adminRoleRef);
            if (!adminRoleSnap.exists()) {
                await auth.signOut();
                throw new Error("This user is not an administrator.");
            }
            
            const sessionId = await createUserSession(firestore, user);
            if (sessionId) sessionStorage.setItem('sessionId', sessionId);
            
            toast({ title: "Login Successful", description: "Redirecting to admin dashboard..." });
            router.push("/adminnarayan/dashboard");
        } else if (lastError?.code === 'auth/user-not-found') {
            // All attempts failed with user-not-found, so now try to create the user (first-time setup)
            try {
                const adminEmail = `${values.adminId}@email.com`; // Standardize creation with email.com
                const newUserCredential = await createUserWithEmailAndPassword(auth, adminEmail, values.password);
                const { user: newUser } = newUserCredential;
                await updateProfile(newUser, { displayName: values.adminId });
                
                const userDocRef = doc(firestore, 'users', newUser.uid);
                await setDoc(userDocRef, {
                    id: newUser.uid,
                    userId: values.adminId,
                    fullName: "Administrator",
                    dob: "1970-01-01", isBanned: false, isOnHold: false, tradeVolume: 0, completedTrades: 0, usernameChanged: true,
                    createdAt: new Date().toISOString(), feedbackScore: 100, positiveFeedback: 0, negativeFeedback: 0, avgPaymentTime: 0,
                    avgReleaseTime: 0, photoURL: "", preferredCurrency: "USD", securityQuestion: "Admin account", securityAnswer: "Admin account",
                    isAdminAccount: true, blockedUsers: [],
                });

                const adminRoleRef = doc(firestore, 'admins', newUser.uid);
                await setDoc(adminRoleRef, { role: "admin", createdAt: new Date().toISOString() });

                const newSessionId = await createUserSession(firestore, newUser);
                if (newSessionId) sessionStorage.setItem('sessionId', newSessionId);
                
                toast({ title: "Admin Account Created", description: "First-time setup successful. Logging you in..." });
                router.push("/adminnarayan/dashboard");
            } catch (signUpError: any) {
                 if (signUpError.code === 'auth/email-already-in-use') {
                    toast({ variant: "destructive", title: "Login Failed", description: "Invalid Admin ID or password." });
                 } else {
                    toast({ variant: "destructive", title: "Admin Setup Failed", description: signUpError.message });
                 }
            }
        } else {
            throw lastError || new Error("An unknown login error occurred.");
        }
    } catch (error: any) {
        let description = "An unknown error occurred. Please try again.";
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
            description = "Invalid Admin ID or password.";
        } else if (error.message) {
            description = error.message;
        }
        toast({ variant: "destructive", title: "Login Failed", description });
    } finally {
        setIsLoggingIn(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/50 p-4">
      <Card className="w-full max-w-md border-destructive">
        <CardHeader className="text-center">
          <Link href="/" className="flex justify-center mb-4">
             <Logo />
          </Link>
          <CardTitle className="text-2xl">Admin Panel Access</CardTitle>
          <CardDescription>
            Restricted area. Authorized personnel only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="adminId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin ID</FormLabel>
                    <FormControl>
                      <Input placeholder="Your Admin ID" {...field} />
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
                    <FormLabel>Password</FormLabel>
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
              <Button type="submit" className="w-full" variant="destructive" disabled={isLoggingIn}>
                {isLoggingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Authenticate
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
