import type { Metadata } from 'next';
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
import UserPresenceProvider from '@/components/providers/UserPresenceProvider';
import { OnboardingModal } from '@/components/OnboardingModal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Paxones - Secure P2P Coin Trading',
  description: 'A full-featured, production-quality Peer-to-Peer (P2P) coin trading platform with an escrow system.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-body antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthProvider>
            <I18nProvider>
              <NotificationsProvider>
                <PriceProvider>
                  <BrandingProvider>
                    <WalletProvider>
                      <UserPresenceProvider>
                        {children}
                        <OnboardingModal />
                      </UserPresenceProvider>
                    </WalletProvider>
                  </BrandingProvider>
                </PriceProvider>
              </NotificationsProvider>
            </I18nProvider>
          </AuthProvider>
          <RadixToaster />
          <SonnerToaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
