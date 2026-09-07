'use client';
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { BuySellForm } from "@/components/home/buy-sell-form";
import { HomeSignupForm } from "@/components/home/home-signup-form";
import { CheckCircle, Globe, Gavel, Lock, MessageSquare, Search, ShieldCheck, UserPlus, Users, Landmark } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { SUPPORTED_CRYPTOS } from "@/lib/constants";
import type { CryptoCurrency } from "@/lib/types";
import { useI18n } from "@/context/i18n-context";

const stats = [
    { value: "180+", label: "home.statsCountries" },
    { value: "500+", label: "home.statsPayments" },
    { value: "5min", label: "home.statsTime" },
];

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency, className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

export default function Home() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <Header />
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative w-full py-16 md:py-24 lg:py-32">
            <div className="container mx-auto px-4 md:px-6 grid md:grid-cols-2 gap-10 lg:gap-16 items-center">
                <div className="text-center md:text-left">
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
                        {t('home.heroTitle')}
                    </h1>
                     <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto md:mx-0">
                        {t('home.heroSubtitle')}
                    </p>
                    <div className="mt-8 max-w-md mx-auto md:mx-0">
                      <HomeSignupForm />
                    </div>
                </div>
                <div className="relative flex justify-center">
                    <BuySellForm />
                </div>
            </div>
        </section>

        {/* Stats Section */}
        <section className="py-16 bg-muted border-y border-border">
            <div className="container mx-auto px-4 md:px-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
                    {stats.map(stat => (
                        <div key={stat.label}>
                            <p className="text-4xl font-bold text-primary">{stat.value}</p>
                            <p className="mt-2 text-muted-foreground">{t(stat.label)}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-16 md:py-24 lg:py-32">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('home.howItWorksTitle')}</h2>
                <p className="mt-4 text-lg text-muted-foreground">
                    {t('home.howItWorksSubtitle')}
                </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mt-12">
              <Card className="bg-card border-border shadow-xs">
                  <CardHeader>
                      <div className="flex items-center gap-4">
                          <div className="bg-primary/10 text-primary p-3 rounded-full">
                              <UserPlus className="h-6 w-6" />
                          </div>
                          <h3 className="text-xl font-semibold">{t('home.step1Title')}</h3>
                      </div>
                  </CardHeader>
                  <CardContent>
                      <p className="text-muted-foreground">
                          {t('home.step1Desc')}
                      </p>
                  </CardContent>
              </Card>
              <Card className="bg-card border-border shadow-xs">
                  <CardHeader>
                      <div className="flex items-center gap-4">
                          <div className="bg-primary/10 text-primary p-3 rounded-full">
                              <Search className="h-6 w-6" />
                          </div>
                          <h3 className="text-xl font-semibold">{t('home.step2Title')}</h3>
                      </div>
                  </CardHeader>
                  <CardContent>
                      <p className="text-muted-foreground">
                          {t('home.step2Desc')}
                      </p>
                  </CardContent>
              </Card>
              <Card className="bg-card border-border shadow-xs">
                  <CardHeader>
                      <div className="flex items-center gap-4">
                          <div className="bg-primary/10 text-primary p-3 rounded-full">
                              <MessageSquare className="h-6 w-6" />
                          </div>
                          <h3 className="text-xl font-semibold">{t('home.step3Title')}</h3>
                      </div>
                  </CardHeader>
                  <CardContent>
                      <p className="text-muted-foreground">
                          {t('home.step3Desc')}
                      </p>
                  </CardContent>
              </Card>
              <Card className="bg-card border-border shadow-xs">
                  <CardHeader>
                      <div className="flex items-center gap-4">
                          <div className="bg-primary/10 text-primary p-3 rounded-full">
                              <CheckCircle className="h-6 w-6" />
                          </div>
                          <h3 className="text-xl font-semibold">{t('home.step4Title')}</h3>
                      </div>
                  </CardHeader>
                  <CardContent>
                      <p className="text-muted-foreground">
                          {t('home.step4Desc')}
                      </p>
                  </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Why Tradenance Section */}
        <section id="why-tradenance" className="py-16 md:py-24 lg:py-32 bg-muted border-y border-border">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('home.whyP2PTitle')}</h2>
                <p className="mt-4 text-lg text-muted-foreground">
                    {t('home.whyP2PSubtitle')}
                </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mt-12">
                <Card className="bg-card border-border shadow-xs">
                    <CardHeader>
                        <div className="bg-primary/10 text-primary p-3 rounded-full w-max">
                            <Users className="h-8 w-8" />
                        </div>
                        <CardTitle className="mt-4">{t('home.directTradingTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">{t('home.directTradingDesc')}</p>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border shadow-xs">
                    <CardHeader>
                        <div className="bg-primary/10 text-primary p-3 rounded-full w-max">
                            <Landmark className="h-8 w-8" />
                        </div>
                        <CardTitle className="mt-4">{t('home.globalPaymentsTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">{t('home.globalPaymentsDesc')}</p>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border shadow-xs">
                    <CardHeader>
                        <div className="bg-primary/10 text-primary p-3 rounded-full w-max">
                            <Globe className="h-8 w-8" />
                        </div>
                        <CardTitle className="mt-4">{t('home.controlTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">{t('home.controlDesc')}</p>
                    </CardContent>
                </Card>
            </div>
          </div>
        </section>

        {/* Security Section */}
        <section id="security" className="py-16 md:py-24 lg:py-32">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('home.securityTitle')}</h2>
                <p className="mt-4 text-lg text-muted-foreground">
                    {t('home.securitySubtitle')}
                </p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 mt-12 items-start">
                <Card className="h-full bg-card border-border shadow-xs">
                    <CardHeader>
                        <div className="flex items-center gap-4">
                            <div className="bg-primary/10 text-primary p-3 rounded-full">
                                <Lock className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-semibold">{t('home.escrowTitle')}</h3>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            {t('home.escrowDesc')}
                        </p>
                    </CardContent>
                </Card>
                <Card className="h-full bg-card border-border shadow-xs">
                    <CardHeader>
                        <div className="flex items-center gap-4">
                            <div className="bg-primary/10 text-primary p-3 rounded-full">
                                <Gavel className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-semibold">{t('home.disputeTitle')}</h3>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            {t('home.disputeDesc')}
                        </p>
                    </CardContent>
                </Card>
            </div>
          </div>
        </section>

        {/* Supported Crypto Section */}
        <section id="supported-crypto" className="py-16 md:py-24 lg:py-32 bg-muted border-y border-border">
            <div className="container mx-auto px-4 md:px-6">
              <div className="text-center max-w-3xl mx-auto">
                  <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('home.supportedCoinsTitle')}</h2>
                  <p className="mt-4 text-lg text-muted-foreground">
                      {t('home.supportedCoinsDesc')}
                  </p>
              </div>
              <div className="mt-12 flex justify-center items-center gap-8 md:gap-12 flex-wrap">
                {SUPPORTED_CRYPTOS.map(crypto => (
                  <div key={crypto.name} className="flex flex-col items-center gap-3">
                    <CryptoLogo crypto={crypto.name} className="h-16 w-16"/>
                    <span className="font-semibold text-lg">{crypto.name}</span>
                  </div>
                ))}
              </div>
            </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
