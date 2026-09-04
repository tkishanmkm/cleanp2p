
"use client";

import Link from "next/link";
import { useState } from "react";
import { Globe, Menu, ChevronDown, ArrowDownToLine, ArrowUpFromLine, PlusCircle, BookOpen, FileText, Shield, HelpCircle, User, Settings, LayoutDashboard, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LANGUAGES } from "@/lib/constants";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { ModeToggle } from "../mode-toggle";
import { useI18n } from "@/context/i18n-context";
import type { Language } from "@/lib/types";
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { DefaultAvatar } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';


const mobileNavLinks = [
  { href: "/buy", label: "Buy Coin" },
  { href: "/sell", label: "Sell Coin" },
  { href: "/wallets", label: "Wallet" },
  { href: "/contact", label: "Support" },
];

export function Header() {
  const { language, setLanguage } = useI18n();
  const { user, isUserLoading, signOut } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const selectedLanguage = LANGUAGES.flatMap(l => l.dialects || l).find(l => l.code === language) || LANGUAGES[0];


  const handleLanguageSelect = (language: Language) => {
    setLanguage(language.code);
  };
  
  const handleLogout = async () => {
    try {
      await signOut();
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/login');
    } catch (error) {
      toast({ variant: "destructive", title: "Logout Failed", description: "An error occurred during logout." });
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background shadow-xs">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-6 w-6" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col">
                  <SheetHeader className="border-b pb-6 mb-6">
                      <SheetTitle asChild>
                          <Link href="/">
                              <Logo />
                          </Link>
                      </SheetTitle>
                      <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
                  </SheetHeader>
                <nav className="flex flex-col gap-4">
                  {mobileNavLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="text-lg font-medium text-foreground hover:text-accent-foreground"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
                 <div className="mt-auto">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-start">
                            <Globe className="mr-2 h-4 w-4" />
                            <span>{selectedLanguage.nativeName}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            {LANGUAGES.map((lang) =>
                            lang.dialects ? (
                                <DropdownMenuSub key={lang.code}>
                                <DropdownMenuSubTrigger>
                                    <div className="flex flex-col items-start">
                                    <span className="font-medium">{lang.nativeName}</span>
                                    </div>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                    {lang.dialects.map((dialect) => (
                                        <DropdownMenuItem key={dialect.code} onClick={() => handleLanguageSelect(dialect)}>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{dialect.nativeName}</span>
                                        </div>
                                        </DropdownMenuItem>
                                    ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                                </DropdownMenuSub>
                            ) : (
                                <DropdownMenuItem key={lang.code} onClick={() => handleLanguageSelect(lang)}>
                                <div className="flex flex-col">
                                    <span className="font-medium">{lang.nativeName}</span>
                                </div>
                                </DropdownMenuItem>
                            )
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
              </SheetContent>
            </Sheet>
          
          {/* Logo */}
          <Link href="/">
            <Logo />
          </Link>
          
          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm ml-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                 <Button variant="ghost" className="font-medium text-foreground/80 transition-colors hover:text-foreground px-0">
                    Trade
                    <ChevronDown className="relative top-[1px] ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                        <Link href="/buy">
                            <ArrowDownToLine />
                            Buy Coin
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href="/sell">
                            <ArrowUpFromLine />
                            Sell Coin
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href="/ads/create">
                            <PlusCircle />
                            Create Ad
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
             <Link
                href="/wallets"
                className="font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                Wallet
              </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="font-medium text-foreground/80 transition-colors hover:text-foreground px-0">
                  Resources
                  <ChevronDown className="relative top-[1px] ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/faq">
                      <HelpCircle />
                      FAQ
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/guides">
                      <BookOpen />
                      Trading Guides
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/terms">
                      <FileText />
                      Terms of Service
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/policy">
                      <Shield />
                      Privacy Policy
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
             <Link
                href="/contact"
                className="font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                Support
              </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
            <ModeToggle />
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <Globe className="h-4 w-4" />
                   <span>{selectedLanguage.code.toUpperCase()}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {LANGUAGES.map((lang) => (
                  lang.dialects ? (
                    <DropdownMenuSub key={lang.code}>
                      <DropdownMenuSubTrigger>
                        <div className="flex flex-col items-start">
                          <span className="font-medium">{lang.nativeName}</span>
                          <span className="text-xs text-muted-foreground">{lang.name}</span>
                        </div>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          {lang.dialects.map(dialect => (
                            <DropdownMenuItem key={dialect.code} onClick={() => handleLanguageSelect(dialect)}>
                              <div className="flex flex-col">
                                  <span className="font-medium">{dialect.nativeName}</span>
                                  <span className="text-xs text-muted-foreground">{dialect.name}</span>
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  ) : (
                    <DropdownMenuItem key={lang.code} onClick={() => handleLanguageSelect(lang)}>
                      <div className="flex flex-col">
                          <span className="font-medium">{lang.nativeName}</span>
                          <span className="text-xs text-muted-foreground">{lang.name}</span>
                      </div>
                    </DropdownMenuItem>
                  )
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            
            {isUserLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" className="flex shrink-0 items-center gap-1.5 md:gap-2 p-1 h-auto rounded-md">
                    <Avatar className="h-8 w-8 shrink-0">
                      {user.photoURL ? (
                        <AvatarImage src={user.photoURL} alt={user.displayName || 'User Avatar'} />
                      ) : (
                        <AvatarFallback className="bg-transparent">
                          <DefaultAvatar />
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div className="hidden sm:block flex-shrink min-w-0 text-left">
                        {user.displayName ? (
                          <p className="font-semibold text-sm leading-tight truncate">{user.displayName}</p>
                        ) : (
                          <Skeleton className="h-4 w-16" />
                        )}
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user.displayName || 'My Account'}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" /><span>Dashboard</span></Link>
                  </DropdownMenuItem>
                   <DropdownMenuItem asChild>
                    <Link href="/profile"><User className="mr-2 h-4 w-4" /><span>Profile</span></Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings"><Settings className="mr-2 h-4 w-4" /><span>Settings</span></Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button variant="ghost" asChild className="text-foreground/80 px-2 font-semibold">
                  <Link href="/login">Log in</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">Join us</Link>
                </Button>
              </>
            )}

        </div>
      </div>
    </header>
  );
}
