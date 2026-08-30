"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFirebase } from "@/firebase";
import { doc, updateDoc } from "firebase/firestore";
import type { User } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { countries } from "@/lib/countries";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { FlagIcon } from "../ui/flag-icon";

const countrySchema = z.object({
  country: z.string().min(1, "Please select a country."),
});

export function ChangeCountryForm({ user: userData }: { user: User }) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof countrySchema>>({
    resolver: zodResolver(countrySchema),
    defaultValues: {
      country: userData?.country || "",
    }
  });

  useEffect(() => {
    if (userData) {
      form.setValue("country", userData.country || "");
    }
  }, [userData, form]);

  const { isSubmitting } = form.formState;

  const handleCountryChange = async (values: z.infer<typeof countrySchema>) => {
    if (!firestore || !user) return;
    
    const userRef = doc(firestore, "users", user.uid);

    try {
      await updateDoc(userRef, {
        country: values.country,
      });
      toast({
        title: "Country Updated",
        description: `Your country has been saved.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: "Could not update your country.",
      });
    }
  };
  
  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleCountryChange)}>
          <CardHeader>
            <CardTitle>Country of Residence</CardTitle>
            <CardDescription>Set your country. This helps tailor your experience and is shown to other traders.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select your country" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {countries.map(c => (
                        <SelectItem key={c.code} value={c.code}>
                          <div className="flex items-center gap-2">
                            <FlagIcon countryCode={c.code} />
                            {c.name}
                          </div>
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
              Save Country
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
