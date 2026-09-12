import React from 'react';

/**
 * Bespoke, futuristic vector symbols for navigation icons.
 * Each icon features a distinct geometric design with custom precision angles and micro-nodes.
 */

// 1. Dashboard: Futuristic nexus matrix grid with central data core
export function HdDashboardIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer rhomboid telemetry frame */}
      <path d="M12 2.5L20.5 7.5V16.5L12 21.5L3.5 16.5V7.5L12 2.5Z" strokeWidth="1.8" />
      {/* Internal tri-axis connector */}
      <path d="M12 12L20.5 7.5" strokeWidth="1.5" strokeOpacity="0.7" />
      <path d="M12 12L3.5 7.5" strokeWidth="1.5" strokeOpacity="0.7" />
      <path d="M12 12V21.5" strokeWidth="1.5" strokeOpacity="0.7" />
      {/* Central quantum core */}
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

// 2. Wallets: Cryptographic vault vault-cell with digital key nodes
export function HdWalletsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Vault chamber octagonal shield */}
      <path d="M7 3H17L21 7V17L17 21H7L3 17V7L7 3Z" strokeWidth="1.8" />
      {/* Biometric interlocking lock bars */}
      <path d="M9 8H15" strokeWidth="1.6" />
      <path d="M8 12H16" strokeWidth="1.6" />
      <path d="M9 16H15" strokeWidth="1.6" />
      {/* Dual quantum node pins */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

// 3. Buy Coin: Inward converging vortex matrix with digital acquisition chevron
export function HdBuyCoinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer concentric ingress arcs */}
      <path d="M4 12A8 8 0 0 1 18 6.5" strokeWidth="1.8" />
      <path d="M20 12A8 8 0 0 1 6 17.5" strokeWidth="1.8" />
      {/* Central ingress arrow node */}
      <path d="M12 4V14" strokeWidth="2" />
      <path d="M8.5 10.5L12 14L15.5 10.5" strokeWidth="2" />
      {/* Ingress receptor base */}
      <path d="M8 18.5H16" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// 4. Sell Coin: Outward egress beam with ascending momentum crest
export function HdSellCoinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer concentric egress arcs */}
      <path d="M20 12A8 8 0 0 1 6 17.5" strokeWidth="1.8" />
      <path d="M4 12A8 8 0 0 1 18 6.5" strokeWidth="1.8" />
      {/* Ascending beam */}
      <path d="M12 20V10" strokeWidth="2" />
      <path d="M8.5 13.5L12 10L15.5 13.5" strokeWidth="2" />
      {/* Launch threshold crest */}
      <path d="M8 5.5H16" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// 5. Transfer: Intertwined cybernetic hyperloops with node exchanges
export function HdTransferIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Dual orbital flux tracks */}
      <path d="M3 8.5C3 6.5 5 5 7.5 5H18.5L15 2" strokeWidth="1.8" />
      <circle cx="18.5" cy="5" r="1.5" fill="currentColor" />
      <path d="M21 15.5C21 17.5 19 19 16.5 19H5.5L9 22" strokeWidth="1.8" />
      <circle cx="5.5" cy="19" r="1.5" fill="currentColor" />
      {/* Center cross-bridge pulse */}
      <path d="M10 11L14 13" strokeWidth="1.5" strokeDasharray="1.5 2" />
    </svg>
  );
}

// 6. Create Ad: Radiating holographic beacon with pulse emitter
export function HdCreateAdIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Signal emitter spire */}
      <path d="M12 3V9" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
      {/* Radiating broadcast wings */}
      <path d="M6 7C4.5 9 4 11 4 13" strokeWidth="1.6" />
      <path d="M18 7C19.5 9 20 11 20 13" strokeWidth="1.6" />
      <path d="M12 15V21" strokeWidth="2" />
      {/* Bottom spark nodes */}
      <path d="M7 21H17" strokeWidth="2" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

// 7. My Ads: Quad-cell registry ledger with active verification beacon
export function HdMyAdsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Angular ledger plate */}
      <path d="M4 4H20V16L16 20H4V4Z" strokeWidth="1.8" />
      {/* Micro-inscriptions */}
      <path d="M8 8H16" strokeWidth="1.6" />
      <path d="M8 12H13" strokeWidth="1.6" />
      {/* Corner origami fold indicator */}
      <path d="M16 16V20L20 16H16Z" fill="currentColor" fillOpacity="0.3" strokeWidth="1.5" />
      <circle cx="8" cy="16" r="1.2" fill="currentColor" />
    </svg>
  );
}

// 8. My Trades: Interlocking cryptographic helix gears
export function HdMyTradesIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Dual orbiting exchange arcs */}
      <path d="M12 3C7 3 3 7 3 12C3 14 3.7 15.8 5 17.2L3 21H7.5L8.5 19.5" strokeWidth="1.7" />
      <path d="M12 21C17 21 21 17 21 12C21 10 20.3 8.2 19 6.8L21 3H16.5L15.5 4.5" strokeWidth="1.7" />
      {/* Escrow handshake junction */}
      <path d="M9.5 12.5L11.5 14.5L15 10" strokeWidth="2" />
    </svg>
  );
}

// 9. Support: Quantum neural interface / 24/7 harmonic pulse node
export function HdSupportIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Harmonic aura rings */}
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
      {/* Neural wavelength transceiver */}
      <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16" strokeWidth="1.7" />
      <path d="M12 16V20" strokeWidth="2" />
      {/* Direct communication node */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M9 19.5H15" strokeWidth="1.8" />
    </svg>
  );
}

// 10. User Register / Genesis: Identity biometric node with cryptographic key
export function HdUserRegisterIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* User avatar biometric crest */}
      <circle cx="10" cy="8" r="4" strokeWidth="1.8" />
      <path d="M3 20C3 16 6.5 14 10 14C11.8 14 13.5 14.6 14.8 15.6" strokeWidth="1.8" />
      {/* Dynamic genesis spark node */}
      <path d="M19 8V14" strokeWidth="2" />
      <path d="M16 11H22" strokeWidth="2" />
    </svg>
  );
}

// 11. Market Search / Radar: Quantum focal lens with sweeping telemetry reticle
export function HdMarketSearchIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer sensor aperture */}
      <circle cx="11" cy="11" r="7.5" strokeWidth="1.8" />
      {/* Focal reticle crosshair */}
      <path d="M11 7V10" strokeWidth="1.6" />
      <path d="M11 12V15" strokeWidth="1.6" />
      <path d="M7 11H10" strokeWidth="1.6" />
      <path d="M12 11H15" strokeWidth="1.6" />
      <circle cx="11" cy="11" r="1.2" fill="currentColor" />
      {/* Precision telemetry handle */}
      <path d="M16.5 16.5L21.5 21.5" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// 12. Peer Link / Encrypted Chat: Dual telemetry signal waveforms with encrypted packet bridge
export function HdPeerChatIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Main geometric chat chamber */}
      <path d="M3 5.5H17C18.1 5.5 19 6.4 19 7.5V14.5C19 15.6 18.1 16.5 17 16.5H8L3 20.5V5.5Z" strokeWidth="1.8" />
      {/* Interlinked pulse nodes */}
      <circle cx="8" cy="11" r="1.2" fill="currentColor" />
      <circle cx="11" cy="11" r="1.2" fill="currentColor" />
      <circle cx="14" cy="11" r="1.2" fill="currentColor" />
      {/* Secondary broadcast echo */}
      <path d="M21 9V17C21 18.1 20.1 19 19 19H12" strokeWidth="1.5" strokeOpacity="0.6" />
    </svg>
  );
}

// 13. Settlement Seal: Hexagonal proof-of-settlement seal with dual-check verification
export function HdSettlementSealIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Hexagonal cryptographic token seal */}
      <path d="M12 2.5L20.5 7.5V16.5L12 21.5L3.5 16.5V7.5L12 2.5Z" strokeWidth="1.8" />
      {/* Verification check chevron */}
      <path d="M8 12L10.8 14.8L16 9.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 14. Direct Trading: Decentralized peer mesh network
export function HdDirectTradingIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Tri-nodal peer constellation */}
      <circle cx="12" cy="4" r="2.5" fill="currentColor" fillOpacity="0.2" strokeWidth="1.8" />
      <circle cx="4.5" cy="17.5" r="2.5" fill="currentColor" fillOpacity="0.2" strokeWidth="1.8" />
      <circle cx="19.5" cy="17.5" r="2.5" fill="currentColor" fillOpacity="0.2" strokeWidth="1.8" />
      {/* Interconnecting mesh flux beams */}
      <path d="M10 6L6.5 15.5" strokeWidth="1.6" />
      <path d="M14 6L17.5 15.5" strokeWidth="1.6" />
      <path d="M7 17.5H17" strokeWidth="1.6" />
      {/* Center nexus nexus */}
      <circle cx="12" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

// 15. Global Payments: Multi-asset dimensional currency portal
export function HdGlobalPaymentsIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Multi-layered payment vault columns */}
      <path d="M3 20H21" strokeWidth="2" />
      <path d="M4 17H20" strokeWidth="1.5" />
      <path d="M12 3L20 8H4L12 3Z" strokeWidth="1.8" />
      <path d="M7 8V17" strokeWidth="1.6" />
      <path d="M12 8V17" strokeWidth="1.6" />
      <path d="M17 8V17" strokeWidth="1.6" />
      {/* Central asset node */}
      <circle cx="12" cy="12.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

// 16. Total Control: Self-sovereign cryptographic key sphere
export function HdTotalControlIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer sovereign celestial globe */}
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
      {/* Orbital coordinate meridian rings */}
      <ellipse cx="12" cy="12" rx="4.5" ry="9" strokeWidth="1.5" />
      <path d="M3 12H21" strokeWidth="1.5" />
      {/* Autonomous key core */}
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

// 17. Escrow Vault: Automated smart escrow vault lock
export function HdEscrowVaultIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Upper hardened shackle with micro-grooves */}
      <path d="M7 10V6.5C7 3.8 9.2 1.5 12 1.5C14.8 1.5 17 3.8 17 6.5V10" strokeWidth="2" />
      {/* Heavy armored vault body */}
      <path d="M4 10H20V21.5H4V10Z" strokeWidth="1.8" />
      {/* Core biometric scanner & keyway */}
      <circle cx="12" cy="15" r="2" fill="currentColor" />
      <path d="M12 17V19.5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// 18. Dispute Matrix: Neutral arbiter precision equilibrium scales
export function HdDisputeMatrixIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Vertical equilibrium pillar */}
      <path d="M12 3V21" strokeWidth="2" />
      <path d="M8 21H16" strokeWidth="2" />
      {/* Cross balance beam */}
      <path d="M4 7H20" strokeWidth="1.8" />
      {/* Left balance pan */}
      <path d="M4 7L2 13H6L4 7Z" strokeWidth="1.5" />
      {/* Right balance pan */}
      <path d="M20 7L18 13H22L20 7Z" strokeWidth="1.5" />
      {/* Top fulcrum node */}
      <circle cx="12" cy="3.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

// 19. Guide Book: Trading knowledge and strategy ledger
export function HdGuideBookIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeWidth="1.8" />
      <path d="M6.5 2H20V22H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z" strokeWidth="1.8" />
      <path d="M9 7H16" strokeWidth="1.6" />
      <path d="M9 11H14" strokeWidth="1.6" />
    </svg>
  );
}

// 20. Protocol Terms: Smart contract governance manifest
export function HdTermsPolicyIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" strokeWidth="1.8" />
      <path d="M14 2V8H20" strokeWidth="1.8" />
      <path d="M8 13H16" strokeWidth="1.6" />
      <path d="M8 17H13" strokeWidth="1.6" />
    </svg>
  );
}

// 21. Security Shield: Cryptographic armor matrix
export function HdSecurityShieldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2L20 6V12C20 17 16.5 21.5 12 22.5C7.5 21.5 4 17 4 12V6L12 2Z" strokeWidth="1.8" />
      <circle cx="12" cy="11" r="2.2" fill="currentColor" />
      <path d="M12 13.5V17" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// 22. Profile: Unique holographic biometric identity core with orbital crest
export function HdProfileIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Hexagonal biometric perimeter shield */}
      <path d="M12 2.8L19.5 7.1V16.9L12 21.2L4.5 16.9V7.1L12 2.8Z" strokeWidth="1.6" />
      {/* Central neural user node */}
      <circle cx="12" cy="9.5" r="3" strokeWidth="1.8" />
      <path d="M7.5 17.5C8.5 15.2 10.1 14.2 12 14.2C13.9 14.2 15.5 15.2 16.5 17.5" strokeWidth="1.8" strokeLinecap="round" />
      {/* Top telemetry spark */}
      <circle cx="12" cy="4.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

// 23. Settings: Unique quantum gear with cryptographic calibration nodes
export function HdSettingsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Hexagonal precision tooth frame */}
      <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" strokeWidth="1.8" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" strokeWidth="1.6" />
      {/* Central quantum aperture */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

// 24. Tickets / Support Dispatch: Dynamic cryptographic ticket voucher with antenna pulse
export function HdTicketsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Cryptographic ticket coupon chamber with side notches */}
      <path d="M3 8C4.5 8 5.5 7 5.5 5.5V4H18.5V5.5C18.5 7 19.5 8 21 8V16C19.5 16 18.5 17 18.5 18.5V20H5.5V18.5C5.5 17 4.5 16 3 16V8Z" strokeWidth="1.7" />
      {/* Perforation dashed line */}
      <path d="M9 4V20" strokeWidth="1.5" strokeDasharray="2 2" />
      {/* Dynamic assistance beacon */}
      <circle cx="14.5" cy="12" r="2" strokeWidth="1.6" />
      <path d="M14.5 8.5V9.5" strokeWidth="1.5" />
      <path d="M14.5 14.5V15.5" strokeWidth="1.5" />
      <circle cx="6.5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

