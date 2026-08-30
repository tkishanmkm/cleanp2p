'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const CryptoPricesFlowInputSchema = z.object({
  symbols: z.array(z.string()).describe('An array of cryptocurrency symbols (e.g., BTC, ETH).'),
});
export type CryptoPricesFlowInput = z.infer<typeof CryptoPricesFlowInputSchema>;

const CryptoPricesFlowOutputSchema = z.object({
  prices: z.record(z.string(), z.number()).describe('An object mapping each crypto symbol to its current price in USD.'),
});
export type CryptoPricesFlowOutput = z.infer<typeof CryptoPricesFlowOutputSchema>;


const cryptoPricePrompt = ai.definePrompt({
    name: 'cryptoPricePrompt',
    input: { schema: CryptoPricesFlowInputSchema },
    output: { schema: CryptoPricesFlowOutputSchema },
    prompt: `Provide the current price in USD for the following cryptocurrencies: {{symbols}}. Return only the JSON object with the prices.`,
});

const getCryptoPricesFlow = ai.defineFlow(
  {
    name: 'getCryptoPricesFlow',
    inputSchema: CryptoPricesFlowInputSchema,
    outputSchema: CryptoPricesFlowOutputSchema,
  },
  async (input) => {
    const {output} = await cryptoPricePrompt(input);
    return output!;
  }
);

export async function getPrices(input: CryptoPricesFlowInput): Promise<CryptoPricesFlowOutput> {
  return await getCryptoPricesFlow(input);
}
