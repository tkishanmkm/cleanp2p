import type { Metadata } from 'next';
import { Inter, Source_Code_Pro } from 'next/font/google';
import './globals.css';
import { Toaster as RadixToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { NotificationsProvider } from '@/components/notifications-provider';
import { PriceProvider } from '@/context/price-context';
import { BrandingProvider } from '@/context/branding-context';
import { I18nProvider } from '@/context/i18n-context';
import { WalletProvider } from '@/context/wallet-context';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const sourceCodePro = Source_Code_Pro({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Paxones - Secure P2P Coin Trading',
  description: 'A full-featured, production-quality Peer-to-Peer (P2P) coin trading platform with an escrow system.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceCodePro.variable}`} suppressHydrationWarning>
      <body className={`font-body antialiased ${inter.className}`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <NotificationsProvider>
              <PriceProvider>
                <I18nProvider>
                  <BrandingProvider>
                    <WalletProvider>
                      {children}
                    </WalletProvider>
                  </BrandingProvider>
                </I18nProvider>
              </PriceProvider>
            </NotificationsProvider>
          </AuthProvider>
          <RadixToaster />
          <SonnerToaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
