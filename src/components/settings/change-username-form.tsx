"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFirebase } from "@/firebase";
import { doc, runTransaction, collection, query, where, getDocs } from "firebase/firestore";
import type { User } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Info } from "lucide-react";
import { updateProfile } from "firebase/auth";

const usernameSchema = z.object({
  newUsername: z.string().min(3, "Username must be at least 3 characters.").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores."),
});

export function ChangeUsernameForm({ user: userData }: { user: User }) {
  const { firestore, auth, user } = useFirebase();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof usernameSchema>>({
    resolver: zodResolver(usernameSchema),
  });

  const { isSubmitting } = form.formState;

  const handleUsernameChange = async (values: z.infer<typeof usernameSchema>) => {
    if (!firestore || !user || !userData || !auth) return;
    
    if (values.newUsername === userData.userId) {
      form.setError("newUsername", { type: "manual", message: "This is already your username." });
      return;
    }

    // Check if username is already taken before starting the transaction
    const usersRef = collection(firestore, "users");
    const q = query(usersRef, where("userId", "==", values.newUsername));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      form.setError("newUsername", {
        type: "manual",
        message: "This username is already taken. Please choose another one.",
      });
      return;
    }

    try {
      const userRef = doc(firestore, "users", user.uid);
      await runTransaction(firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("User document not found.");
        
        const currentData = userDoc.data() as User;
        if (currentData.usernameChanged) throw new Error("Username has already been changed once.");

        transaction.update(userRef, {
          oldUserId: currentData.userId,
          userId: values.newUsername,
          usernameChanged: true,
        });
      });
      
      // Also update the display name in Firebase Auth
      if(auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: values.newUsername });
      }

      toast({
        title: "Username Changed",
        description: `Your new username is ${values.newUsername}.`,
      });
      form.reset({ newUsername: "" }); // Reset form on success

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to Change Username",
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
              You can only change your username once. Your current username is <span className="font-bold">{userData.userId}</span>.
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
                  <FormDescription>
                    This will be your new public identity on the platform.
                  </FormDescription>
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
