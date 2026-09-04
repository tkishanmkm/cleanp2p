import React from 'react';

export function HdDashboardIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
      <circle cx="6.5" cy="7.5" r="0.9" fill="currentColor" />
      <circle cx="17.5" cy="16.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function HdWalletsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M15 12h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z" />
      <circle cx="18" cy="15" r="1" fill="currentColor" />
      <path d="M7 7h6" />
    </svg>
  );
}

export function HdBuyCoinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v7.5" />
      <path d="m8.5 11.5 3.5 3.5 3.5-3.5" />
      <path d="M8 17h8" strokeWidth="2.2" />
    </svg>
  );
}

export function HdSellCoinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 17V9.5" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
      <path d="M8 7h8" strokeWidth="2.2" />
    </svg>
  );
}

export function HdTransferIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h12a3 3 0 0 1 3 3v1" />
      <path d="m13 5 3 3-3 3" />
      <path d="M20 16H8a3 3 0 0 1-3-3v-1" />
      <path d="m11 19-3-3 3-3" />
    </svg>
  );
}

export function HdCreateAdIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11V9a2 2 0 0 1 2-2h2l5-3v14l-5-3H5a2 2 0 0 1-2-2v-1z" />
      <path d="M8 14v3a2 2 0 0 0 2 2" />
      <path d="M18 7v6" strokeWidth="2.2" />
      <path d="M15 10h6" strokeWidth="2.2" />
    </svg>
  );
}

export function HdMyAdsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 8h10" />
      <path d="M7 12h5" />
      <path d="M7 16h4" />
      <circle cx="16.5" cy="14.5" r="2.5" />
      <path d="m15.5 14.5 1 1 2-2" strokeWidth="1.8" />
    </svg>
  );
}

export function HdMyTradesIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

export function HdSupportIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 1 18 0v4a3 3 0 0 1-3 3h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h2a7 7 0 1 0-14 0h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3v-4z" />
      <path d="M18 19v1a2 2 0 0 1-2 2h-3" />
      <circle cx="12" cy="22" r="1" fill="currentColor" />
    </svg>
  );
}
