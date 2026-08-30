
'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import type { DepositAddressSet, CryptoCurrency } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, Trash2, PlusCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';

const formSchema = z.object({
  btc_chains: z.array(z.object({ chain: z.string().min(1), address: z.string().min(1) })),
  eth_chains: z.array(z.object({ chain: z.string().min(1), address: z.string().min(1) })),
  ltc_chains: z.array(z.object({ chain: z.string().min(1), address: z.string().min(1) })),
  usdt_chains: z.array(z.object({ chain: z.string().min(1), address: z.string().min(1) })),
});

type FormValues = z.infer<typeof formSchema>;

const CRYPTO_KEYS: Record<string, keyof FormValues> = {
  BTC: 'btc_chains',
  ETH: 'eth_chains',
  LTC: 'ltc_chains',
  USDT: 'usdt_chains',
};

export default function DepositAddressSetsPage() {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [selectedSetId, setSelectedSetId] = useState('1');

  const setRef = useMemoFirebase(() => (firestore ? doc(firestore, 'crypto_deposit_addresses', selectedSetId) : null), [firestore, selectedSetId]);
  const { data: setData, isLoading: isSetLoading } = useDoc<DepositAddressSet>(setRef);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      btc_chains: [],
      eth_chains: [],
      ltc_chains: [],
      usdt_chains: [],
    },
  });

  const { control, handleSubmit, reset } = form;

  const { fields: btcFields, append: appendBtc, remove: removeBtc } = useFieldArray({ control, name: 'btc_chains' });
  const { fields: ethFields, append: appendEth, remove: removeEth } = useFieldArray({ control, name: 'eth_chains' });
  const { fields: ltcFields, append: appendLtc, remove: removeLtc } = useFieldArray({ control, name: 'ltc_chains' });
  const { fields: usdtFields, append: appendUsdt, remove: removeUsdt } = useFieldArray({ control, name: 'usdt_chains' });

  const fieldArrays = {
    btc_chains: { fields: btcFields, append: appendBtc, remove: removeBtc },
    eth_chains: { fields: ethFields, append: appendEth, remove: removeEth },
    ltc_chains: { fields: ltcFields, append: appendLtc, remove: removeLtc },
    usdt_chains: { fields: usdtFields, append: appendUsdt, remove: removeUsdt },
  };

  useEffect(() => {
    if (setData) {
      const parsedData: FormValues = { btc_chains: [], eth_chains: [], ltc_chains: [], usdt_chains: [] };
      for (const key in setData.addresses) {
        const [crypto, chain] = key.split('-') as [CryptoCurrency, string];
        const formKey = CRYPTO_KEYS[crypto];
        if (formKey) {
          parsedData[formKey].push({ chain, address: setData.addresses[key] });
        }
      }
      reset(parsedData);
    } else {
       reset({ btc_chains: [], eth_chains: [], ltc_chains: [], usdt_chains: [] });
    }
  }, [setData, reset]);

  const onSubmit = async (data: FormValues) => {
    if (!firestore) return;

    const addresses: Record<string, string> = {};
    (Object.keys(data) as Array<keyof FormValues>).forEach(key => {
      const crypto = key.split('_')[0].toUpperCase() as CryptoCurrency;
      data[key].forEach(entry => {
        if (entry.chain && entry.address) {
          addresses[`${crypto}-${entry.chain}`] = entry.address;
        }
      });
    });

    const docData: DepositAddressSet = {
      id: selectedSetId,
      setName: `Set ${selectedSetId}`,
      addresses: addresses,
    };

    try {
      await setDoc(setRef!, docData, { merge: true });
      toast({ title: 'Success', description: `Address Set ${selectedSetId} has been saved.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Save Failed', description: error.message });
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Deposit Address Sets</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Manage Address Sets</CardTitle>
          <CardDescription>Configure the deposit addresses for each of the 20 rotating sets assigned to users.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-2">
            <Label>Select Address Set to Edit</Label>
            <Select value={selectedSetId} onValueChange={setSelectedSetId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 20 }, (_, i) => String(i + 1)).map(id => (
                  <SelectItem key={id} value={id}>Set {id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      
      {isSetLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <Accordion type="multiple" className="w-full space-y-4" defaultValue={['USDT']}>
              {SUPPORTED_CRYPTOS.map(crypto => {
                const formKey = CRYPTO_KEYS[crypto.name];
                if (!formKey) return null;
                const { fields, append, remove } = fieldArrays[formKey];
                return (
                  <AccordionItem value={crypto.name} key={crypto.name} className="border rounded-lg bg-card text-card-foreground shadow-sm">
                    <AccordionTrigger className="text-xl font-semibold p-6 hover:no-underline">
                        <div className="w-full text-left">{crypto.name} Addresses</div>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-6">
                        <div className="space-y-4">
                        {fields.map((field, index) => {
                          const availableChains = SUPPORTED_CRYPTOS.find(c => c.name === crypto.name)?.chains || [];
                          return (
                            <div key={field.id} className="flex items-end gap-2 p-2 border rounded-md">
                              <FormField
                                control={control}
                                name={`${formKey}.${index}.chain`}
                                render={({ field }) => (
                                  <FormItem className="flex-1">
                                    <Label>Chain</Label>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select a chain" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {availableChains.map(chain => (
                                                <SelectItem key={chain} value={chain}>{chain}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={control}
                                name={`${formKey}.${index}.address`}
                                render={({ field }) => (
                                  <FormItem className="flex-1">
                                    <Label>Deposit Address</Label>
                                    <FormControl><Input placeholder="Enter the full address" {...field} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <Button type="button" variant="destructive" size="icon" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        })}
                        <Button type="button" variant="outline" size="sm" onClick={() => append({ chain: '', address: '' })}>
                          <PlusCircle className="mr-2 h-4 w-4" /> Add New {crypto.name} Chain
                        </Button>
                        </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes for Set {selectedSetId}
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}
