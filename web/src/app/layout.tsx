import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "bitchat — mesh chat",
  description:
    "Decentralized peer-to-peer messaging: bluetooth mesh for offline communication and the Nostr protocol for global reach. No accounts, no phone numbers, no central servers. It's the side-groupchat.",
  keywords: ["bitchat", "mesh chat", "nostr", "bluetooth mesh", "decentralized", "IRC"],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} bg-[#080808] font-sans text-white antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
