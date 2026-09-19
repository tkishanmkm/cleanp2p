'use client';

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useTheme } from 'next-themes';

interface ResponsiveHCaptchaProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (err: any) => void;
  sitekey?: string;
  className?: string;
}

export interface ResponsiveHCaptchaRef {
  resetCaptcha: () => void;
  execute: () => void;
}

export const ResponsiveHCaptcha = forwardRef<ResponsiveHCaptchaRef, ResponsiveHCaptchaProps>(
  function ResponsiveHCaptcha({ onVerify, onExpire, onError, sitekey, className = '' }, ref) {
    const internalRef = useRef<HCaptcha | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [scale, setScale] = useState(1);

    const activeSiteKey =
      sitekey ||
      process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ||
      '35e2a6c0-e7ae-45a0-b636-b46e01a67aee';

    const currentTheme = resolvedTheme === 'dark' ? 'dark' : 'light';

    useImperativeHandle(ref, () => ({
      resetCaptcha: () => {
        try {
          internalRef.current?.resetCaptcha();
        } catch (_) {}
      },
      execute: () => {
        try {
          internalRef.current?.execute();
        } catch (_) {}
      },
    }));

    useEffect(() => {
      setMounted(true);
    }, []);

    // Calculate scale factor so standard 302px hCaptcha width fits container perfectly
    useEffect(() => {
      if (!containerRef.current) return;

      const updateScale = () => {
        if (!containerRef.current) return;
        const containerWidth = containerRef.current.offsetWidth;
        const standardWidth = 302; // Standard hCaptcha normal iframe width

        if (containerWidth > 0 && containerWidth < standardWidth) {
          const newScale = containerWidth / standardWidth;
          setScale(Math.min(1, Math.max(0.65, newScale)));
        } else {
          setScale(1);
        }
      };

      updateScale();
      const observer = new ResizeObserver(updateScale);
      observer.observe(containerRef.current);

      window.addEventListener('resize', updateScale);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', updateScale);
      };
    }, [mounted]);

    if (!mounted) {
      return (
        <div
          ref={containerRef}
          className={`w-full min-h-[78px] flex items-center justify-center rounded-xl bg-slate-50 dark:bg-[#07090e] border border-slate-200/80 dark:border-[#1e2640] ${className}`}
        >
          <span className="text-xs text-slate-400">Loading security verification...</span>
        </div>
      );
    }

    const scaledHeight = Math.round(78 * scale);

    return (
      <div
        ref={containerRef}
        className={`w-full flex justify-center items-center overflow-hidden transition-all ${className}`}
        style={{
          minHeight: `${scaledHeight}px`,
        }}
      >
        <div
          style={{
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'center center',
            width: '302px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <HCaptcha
            key={`hcaptcha-${currentTheme}`}
            ref={internalRef}
            sitekey={activeSiteKey}
            theme={currentTheme}
            size="normal"
            onVerify={(token) => {
              onVerify(token);
            }}
            onExpire={() => {
              if (onExpire) onExpire();
            }}
            onError={(err) => {
              if (onError) onError(err);
            }}
          />
        </div>
      </div>
    );
  }
);
