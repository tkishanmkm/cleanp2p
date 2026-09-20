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

    // Calculate scale factor so standard 302px hCaptcha width fits smoothly on all mobile viewports
    useEffect(() => {
      if (!containerRef.current) return;

      const updateScale = () => {
        if (!containerRef.current) return;
        const availableWidth = containerRef.current.clientWidth || containerRef.current.offsetWidth || window.innerWidth;
        const standardWidth = 302; // Standard hCaptcha widget width

        if (availableWidth > 0 && availableWidth < standardWidth) {
          const newScale = (availableWidth - 4) / standardWidth;
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
          className={`w-full max-w-[304px] min-h-[78px] flex items-center justify-center ${className}`}
        >
          <span className="text-xs text-slate-400">Loading security verification...</span>
        </div>
      );
    }

    const scaledHeight = Math.ceil(78 * scale);
    const scaledWidth = Math.ceil(302 * scale);

    return (
      <div
        ref={containerRef}
        className={`w-full max-w-[304px] flex justify-center items-center transition-all ${className}`}
        style={{
          minHeight: `${scaledHeight}px`,
          height: `${scaledHeight}px`,
          overflow: 'visible',
        }}
      >
        <div
          style={{
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top center',
            width: '302px',
            minWidth: '302px',
            height: '78px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
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
