
import { ArrowLeftRight, Gavel, Lock, ShieldCheck, Star, Wand2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';

const guides = [
  {
    icon: Wand2,
    title: `Welcome to ${APP_NAME}`,
    description: `Get to know the ${APP_NAME} platform and how it empowers users.`,
    href: '/guides/welcome'
  },
  {
    icon: ArrowLeftRight,
    title: 'Your First Trade',
    description: 'Learn how to complete your first trade step by step.',
    href: '/guides/first-trade'
  },
  {
    icon: ShieldCheck,
    title: 'Trade Safely',
    description: 'Discover essential tips and tools to help you trade securely and avoid common risks.',
    href: '/guides/safety'
  },
  {
    icon: Lock,
    title: 'Understanding Escrow',
    description: `Learn how our secure escrow system protects you during every trade.`,
    href: '/guides/escrow'
  },
  {
    icon: Gavel,
    title: 'Dispute Resolution',
    description: 'Understand the dispute process and how our moderators ensure fair outcomes.',
    href: '/dispute-resolution'
  },
  {
    icon: Star,
    title: 'Building Your Reputation',
    description: 'Learn how to get positive feedback and become a trusted trader on the platform.',
    href: '/guides/reputation'
  }
]

export default function GuidesPage() {
  return (
    <div className="max-w-4xl mx-auto">
       <div className="text-center mb-12">
            <h1 className="text-4xl font-bold tracking-tight">Trading Guides & Safety</h1>
            <p className="mt-4 text-lg text-muted-foreground">
                Your security is our top priority. Follow these essential guides to ensure a safe and smooth trading
                experience on {APP_NAME}.
            </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {guides.map((guide) => (
                <Link href={guide.href} key={guide.title}>
                    <Card className="h-full hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1">
                        <CardHeader>
                            <div className="bg-primary/10 text-primary p-3 rounded-lg w-max mb-4">
                                <guide.icon className="h-8 w-8" />
                            </div>
                            <CardTitle>{guide.title}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <CardDescription>{guide.description}</CardDescription>
                        </CardContent>
                    </Card>
                </Link>
            ))}
        </div>
        
        <div className="mt-12 p-6 border-l-4 border-destructive bg-destructive/10 text-destructive rounded-r-lg">
            <h3 className="mt-0 font-bold text-lg">The Golden Rule: Stay on {APP_NAME}</h3>
            <p className="!text-destructive/90 mt-2">
                <strong>NEVER</strong> communicate, negotiate, or trade with anyone outside of the {APP_NAME} platform. Our
                secure escrow and moderation can only protect you if the entire transaction happens here. Anyone asking you to
                use Telegram, WhatsApp, or any other app is likely trying to scam you.
            </p>
        </div>
    </div>
  );
}
