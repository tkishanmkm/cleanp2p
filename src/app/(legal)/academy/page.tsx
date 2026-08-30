
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/constants';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const ceoImage = PlaceHolderImages.find(p => p.id === 'ceo-portrait');

export default function AcademyPage() {
  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="bg-primary text-primary-foreground rounded-lg p-8 md:p-12 text-center relative overflow-hidden">
        <div className="absolute -top-10 -left-10 w-48 h-48 bg-primary-foreground/10 rounded-full"></div>
        <div className="absolute -bottom-16 -right-10 w-64 h-64 bg-primary-foreground/10 rounded-full"></div>
        
        <div className="relative z-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Welcome to the {APP_NAME} Academy
          </h1>
          <p className="mt-6 text-lg md:text-xl max-w-3xl mx-auto text-primary-foreground/90">
            Empowering everyone to learn how to trade, earn, and grow in the global digital economy.
          </p>
          
          <blockquote className="mt-8 text-xl italic max-w-2xl mx-auto">
            "Financial freedom is the power to design your life without the constraints of money."
          </blockquote>
          
          <div className="mt-6 flex items-center justify-center gap-4">
             {ceoImage && (
                <Image
                    src={ceoImage.imageUrl}
                    alt="CEO Portrait"
                    width={60}
                    height={60}
                    data-ai-hint={ceoImage.imageHint}
                    className="rounded-full border-4 border-primary-foreground/20"
                />
             )}
            <div>
              <p className="font-semibold">Narayanharihari</p>
              <p className="text-sm text-primary-foreground/80">CEO, {APP_NAME}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Links Section */}
      <section>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-semibold text-lg mb-4">Quick Links</h3>
              <ul className="space-y-2">
                <li><Link href="/" className="text-muted-foreground hover:text-foreground">Home</Link></li>
                <li><Link href="/buy" className="text-muted-foreground hover:text-foreground">Marketplace</Link></li>
                <li><Link href="/wallets" className="text-muted-foreground hover:text-foreground">Wallet</Link></li>
                <li><Link href="#" className="text-muted-foreground hover:text-foreground">Visa Card</Link></li>
              </ul>
            </div>
             <div>
              <h3 className="font-semibold text-lg mb-4">Products</h3>
              <ul className="space-y-2">
                <li><Link href="/buy" className="text-muted-foreground hover:text-foreground">Buy Crypto</Link></li>
                <li><Link href="/sell" className="text-muted-foreground hover:text-foreground">Sell Crypto</Link></li>
                <li><Link href="/buy?paymentMethod=gift" className="text-muted-foreground hover:text-foreground">P2P Gift Card</Link></li>
                 <li><Link href="/guides" className="text-muted-foreground hover:text-foreground">Trading Guides</Link></li>
                  <li><Link href="/faq" className="text-muted-foreground hover:text-foreground">FAQ</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-4">Company</h3>
               <ul className="space-y-2">
                <li><Link href="/about" className="text-muted-foreground hover:text-foreground">About</Link></li>
                <li><Link href="/careers" className="text-muted-foreground hover:text-foreground">Careers</Link></li>
                <li><Link href="/press" className="text-muted-foreground hover:text-foreground">Press</Link></li>
              </ul>
            </div>
             <div>
              <h3 className="font-semibold text-lg mb-4">Legal</h3>
              <ul className="space-y-2">
                <li><Link href="/terms" className="text-muted-foreground hover:text-foreground">Terms</Link></li>
                <li><Link href="/policy" className="text-muted-foreground hover:text-foreground">Privacy</Link></li>
              </ul>
            </div>
          </div>
      </section>
    </div>
  );
}
