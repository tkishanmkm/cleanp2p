"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFirebase } from "@/firebase";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
}).refine(data => data.currentPassword !== data.newPassword, {
  message: "New password must be different from the current password.",
  path: ["newPassword"],
});

export function ChangePasswordForm() {
  const { auth, user } = useFirebase();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: ""
    }
  });

  const { isSubmitting } = form.formState;

  const handlePasswordChange = async (values: z.infer<typeof passwordSchema>) => {
    if (!auth || !user || !user.email) {
      toast({ variant: "destructive", title: "Error", description: "User not authenticated properly." });
      return;
    }
    
    try {
      // Step 1: Re-authenticate the user
      const credential = EmailAuthProvider.credential(user.email, values.currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Step 2: Update the password
      await updatePassword(user, values.newPassword);
      
      toast({
        title: "Password Changed",
        description: "Your password has been successfully updated.",
      });
      form.reset({currentPassword: "", newPassword: ""});

    } catch (error: any) {
      console.error(error);
      let description = "An unknown error occurred.";
      if (error.code === 'auth/wrong-password') {
        description = "The current password you entered is incorrect.";
        form.setError("currentPassword", { type: "manual", message: "Incorrect password." });
      } else if (error.code === 'auth/too-many-requests') {
          description = "Too many attempts. Please try again later.";
      }
      toast({
        variant: "destructive",
        title: "Failed to Change Password",
        description: description,
      });
    }
  };

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handlePasswordChange)}>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your account password. Choose a strong, unique password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="A strong new password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
