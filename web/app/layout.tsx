import "./globals.css";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SiteHeader } from "./components/SiteHeader";

export const metadata = {
  title: "Bicameral — the Floor",
  description:
    "An AI trading agent that lives entirely inside a smart contract. Watch it think, live, on DreamDEX Event Contracts.",
};

export const viewport = {
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
