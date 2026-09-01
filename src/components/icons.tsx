import React from 'react';

export function PaxonesLogo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#0052FF"/>
      <path d="M10 8H18C21.3137 8 24 10.6863 24 14C24 17.3137 21.3137 20 18 20H14V24H10V8ZM14 12V16H18C19.1046 16 20 15.1046 20 14C20 12.8954 19.1046 12 18 12H14Z" fill="white"/>
    </svg>
  );
}

export function BtcLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#F7931A"/>
      <path d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-.13 4.532c-.138.344-.488.86-1.275.665.027.018-1.256-.313-1.256-.313l-.858 1.98 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.47.127.926.243 1.373.351l-.701 2.81 1.728.431.716-2.868c2.948.558 5.166.333 6.098-2.333.752-2.147-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.539c-.535 2.148-4.148.987-5.32.696l.95-3.805c1.171.293 4.918.872 4.37 3.109zm.535-5.567c-.487 1.953-3.495.961-4.47.718l.86-3.45c.976.243 4.108.697 3.61 2.732z" fill="white"/>
    </svg>
  );
}

export function EthLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#627EEA"/>
      <path d="M16 4L15.67 5.113V20.158L16 20.487L22.998 16.353L16 4Z" fill="white" fillOpacity="0.6"/>
      <path d="M16 4L9 16.353L16 20.487V12.822V4Z" fill="white"/>
      <path d="M16 21.821L15.77 22.1V27.671L16 28L23.003 18.006L16 21.821Z" fill="white" fillOpacity="0.6"/>
      <path d="M16 28V21.821L9 18.006L16 28Z" fill="white"/>
    </svg>
  );
}

export function LtcLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#345D9D"/>
      <path d="M10.63 22.17l.95-3.56-1.58.59.53-1.98 1.58-.59 2.5-9.38h4.21l-1.8 6.75 1.58-.59-.53 1.98-1.58.59-.97 3.62h7.82l-.65 2.55H10.63z" fill="white"/>
    </svg>
  );
}

export function UsdtLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#26A17B"/>
      <path d="M17.922 17.383c-.11.008-.667.043-1.922.043-1.042 0-1.722-.032-1.928-.043-3.64-.17-6.368-.822-6.368-1.61 0-.787 2.728-1.44 6.368-1.61.206-.01 0.886-.042 1.928-.042 1.255 0 1.812.035 1.922.042 3.64.17 6.368.823 6.368 1.61 0 .788-2.728 1.44-6.368 1.61zm0-4.526v-2.072h4.868V7.5H9.21v3.285h4.868v2.072c-4.43.21-7.768 1.15-7.768 2.298 0 1.147 3.338 2.087 7.768 2.298v6.047h3.844v-6.047c4.43-.211 7.768-1.151 7.768-2.298 0-1.148-3.338-2.088-7.768-2.298z" fill="white"/>
    </svg>
  );
}

export function DefaultAvatar({ className = "h-8 w-8", ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="12" className="text-muted-foreground/30 fill-current" />
      <path
        d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"
        className="text-muted-foreground fill-current"
      />
    </svg>
  );
}

