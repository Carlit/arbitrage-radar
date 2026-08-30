import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arbitrage Radar",
  description: "Socle front Next.js 15 du MVP Arbitrage Radar",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <div className="min-h-screen bg-background">
          <header className="border-b border-zinc-200/80 bg-white/70 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/70">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
              <Link href="/" className="text-sm font-semibold tracking-wide text-zinc-950 dark:text-zinc-50">
                Arbitrage Radar
              </Link>
              <nav className="flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
                <Link href="/">Accueil</Link>
                <Link href="/auth">Auth</Link>
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
