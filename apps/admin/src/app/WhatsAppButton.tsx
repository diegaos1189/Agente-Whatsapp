"use client";

export function WhatsAppButton({ href, children, style }: { href: string; children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <a href={href} style={style}>
      {children}
    </a>
  );
}
