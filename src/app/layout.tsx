import type { Metadata, Viewport } from 'next';
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

const WAYONES_SITE_URL = 'https://wayones.com';
const WAYONES_DESCRIPTION =
  'Wayones is a secure peer-to-peer crypto marketplace with escrow protection for buyers and sellers.';

export const metadata: Metadata = {
  metadataBase: new URL(WAYONES_SITE_URL),
  applicationName: 'Wayones',
  title: {
    default: 'Wayones | Secure P2P Crypto Trading',
    template: '%s | Wayones',
  },
  description: WAYONES_DESCRIPTION,
  category: 'finance',
  creator: 'Wayones',
  publisher: 'Wayones',
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    url: WAYONES_SITE_URL,
    siteName: 'Wayones',
    title: 'Wayones | Secure P2P Crypto Trading',
    description: WAYONES_DESCRIPTION,
    images: [{ url: '/logo-desktop.webp', alt: 'Wayones' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wayones | Secure P2P Crypto Trading',
    description: WAYONES_DESCRIPTION,
    images: ['/logo-desktop.webp'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.ico',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
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
