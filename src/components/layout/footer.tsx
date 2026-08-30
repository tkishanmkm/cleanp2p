"use client";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { APP_NAME } from "@/lib/constants";
import { useI18n } from "@/context/i18n-context";

export function Footer() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();

  const sections = [
    {
      title: t('footer.company'),
      links: [
        { label: t('footer.about'), href: "/about" },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { label: t('footer.terms'), href: "/terms" },
        { label: t('footer.privacy'), href: "/policy" },
      ],
    },
    {
      title: t('footer.support'),
      links: [
        { label: t('footer.contact'), href: "/contact" },
        { label: t('footer.faq'), href: "/faq" },
        { label: t('footer.dispute'), href: "/dispute-resolution" },
      ],
    },
  ];

  return (
    <footer className="border-t bg-background">
      <div className="container py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground max-w-xs">
              {t('footer.tagline')}
            </p>
          </div>
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="font-semibold text-foreground">{section.title}</h3>
              <ul className="mt-4 space-y-2">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 border-t pt-8 flex flex-col sm:flex-row items-center justify-between">
          <p className="text-sm text-muted-foreground">
            &copy; {currentYear} {APP_NAME}. {t('footer.copyright')}
          </p>
        </div>
      </div>
    </footer>
  );
}
