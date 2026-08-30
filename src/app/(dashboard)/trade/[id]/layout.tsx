
"use client";

// This layout provides a full-screen container for the trade page,
// which is constrained by the parent dashboard layout.
export default function TradePageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
        {children}
    </div>
  );
}
