import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { NotificationsProvider } from '@/components/notifications-provider';
import { PriceProvider } from '@/context/price-context';
import { BrandingProvider } from '@/context/branding-context';
import { I18nProvider } from '@/context/i18n-context';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
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
                    {children}
                  </BrandingProvider>
                </I18nProvider>
              </PriceProvider>
            </NotificationsProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
