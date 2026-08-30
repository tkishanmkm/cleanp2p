
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
import { Loader2 } from "lucide-react";
import { useState, Suspense } from "react";
import { useFirebase } from "@/firebase";
import { updateProfile, createUserWithEmailAndPassword, setPersistence, browserLocalPersistence } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, collection, query, where, getDocs, writeBatch } from "firebase/firestore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { countries } from "@/lib/countries";
import { SECURITY_QUESTIONS, SUPPORTED_CRYPTOS } from "@/lib/constants";

const formSchema = z.object({
  fullName: z.string().min(2, { message: "Full name must be at least 2 characters." }),
  day: z.string({ required_error: "Day is required."}),
  month: z.string({ required_error: "Month is required."}),
  year: z.string({ required_error: "Year is required."}),
  country: z.string().min(1, "Please select your country."),
  userId: z.string().min(3, { message: "User ID must be at least 3 characters." }).regex(/^[a-zA-Z0-9_]+$/, "User ID can only contain letters, numbers, and underscores."),
  securityQuestion: z.string().min(1, "Please select a security question."),
  securityAnswer: z.string().min(3, "Answer must be at least 3 characters long."),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
  captcha: z.boolean().refine((val) => val === true, {
    message: "Please confirm you are not a robot.",
  }),
}).refine((data) => {
    const date = new Date(parseInt(data.year), parseInt(data.month) - 1, parseInt(data.day));
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    // Also check if the constructed date is valid
    return !isNaN(date.getTime()) && 
           date.getFullYear() === parseInt(data.year) &&
           date.getMonth() === parseInt(data.month) - 1 &&
           date.getDate() === parseInt(data.day) &&
           date <= eighteenYearsAgo;
}, {
    message: "You must be at least 18 and select a valid date.",
    path: ["year"], // Attach error to the last field in the group
});


function SignupFormComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { auth, firestore } = useFirebase();
  const [isSigningUp, setIsSigningUp] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      day: "",
      month: "",
      year: "",
      country: "",
      userId: searchParams.get("userId") || "",
      securityQuestion: "",
      securityAnswer: "",
      password: "",
      captcha: false,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth || !firestore) {
      toast({ variant: "destructive", title: "Error", description: "Authentication service not ready."});
      return;
    }
    setIsSigningUp(true);

    try {
      // 1. Check for userId uniqueness
      const usersRef = collection(firestore, "users");
      const q = query(usersRef, where("userId", "==", values.userId));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
          form.setError("userId", {
              type: "manual",
              message: "This User ID is not available. Please choose another one.",
          });
          setIsSigningUp(false);
          return;
      }
      
      // 2. Create user with email/password
      await setPersistence(auth, browserLocalPersistence);
      const dummyEmail = `${values.userId}@email.com`;
      const userCredential = await createUserWithEmailAndPassword(auth, dummyEmail, values.password);
      const { user: newUser } = userCredential;

      // 3. Update auth user profile (displayName)
      await updateProfile(newUser, { displayName: values.userId });
      
      // 4. Create Firestore user document
      const userDocRef = doc(firestore, "users", newUser.uid);
      const dob = new Date(parseInt(values.year), parseInt(values.month) - 1, parseInt(values.day));
      const walletIndex = Math.floor(Math.random() * 20) + 1; // Random index from 1-20

      const newUserDoc = {
          id: newUser.uid,
          userId: values.userId,
          fullName: values.fullName,
          dob: dob.toISOString().split('T')[0], // YYYY-MM-DD
          country: values.country,
          securityQuestion: values.securityQuestion,
          securityAnswer: values.securityAnswer,
          wallets: {}, // Initialize with an empty wallets object
          isBanned: false,
          isOnHold: false,
          tradeVolume: 0,
          completedTrades: 0,
          usernameChanged: false,
          createdAt: new Date().toISOString(),
          feedbackScore: 100,
          positiveFeedback: 0,
          negativeFeedback: 0,
          avgPaymentTime: 0,
          avgReleaseTime: 0,
          photoURL: "",
          preferredCurrency: "USD",
          blockedUsers: [],
          walletIndex: walletIndex,
      };
      await setDoc(userDocRef, newUserDoc);

      toast({ title: "Account Created", description: "Your account is ready. Redirecting..." });
      router.push('/buy');

    } catch (error: any) {
        console.error("Error during sign up:", error);
        let description = "An unexpected error occurred. Please try again.";
        if (error.code === 'auth/email-already-in-use') {
            description = "This User ID is already associated with an account.";
            form.setError("userId", { type: "manual", message: description });
        }
        toast({ variant: "destructive", title: "Signup Failed", description });
    } finally {
        setIsSigningUp(false);
    }
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
        <CardContent>
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
  )
}

    