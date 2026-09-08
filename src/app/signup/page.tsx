import { AuthForm } from '@/components/auth/auth-form';
import { ModeToggle } from '@/components/mode-toggle';

export const metadata = {
  title: 'Sign Up | Paxones',
  description: 'Create a free account on Paxones.',
};

export default function SignupPage() {
  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 flex items-center justify-center p-4 transition-colors">
      <div className="absolute top-4 right-4 z-10">
        <ModeToggle />
      </div>
      <AuthForm mode="signup" />
    </div>
  );
}

