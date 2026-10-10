import type { Metadata, Viewport } from "next";
import {
  Inter,
  Instrument_Serif,
  JetBrains_Mono,
  Space_Grotesk,
  Fraunces,
  Playfair_Display,
  EB_Garamond,
  Space_Mono,
} from "next/font/google";
import "./globals.css";
import { AutoBackupLoop } from "@/components/backup/AutoBackupLoop";
import { CostPill } from "@/components/ai/CostPill";
import { Cheatsheet } from "@/components/shortcuts/Cheatsheet";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { BaseSync } from "@/components/sync/BaseSync";
import { DiscoveryAutoRefresh } from "@/components/sync/DiscoveryAutoRefresh";

// Curated font set. Adding new ones: register here, then add an entry to
// lib/fonts.ts. Keep the list small — every font is a network cost and a
// design choice.

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});
const playfair = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  style: ["normal", "italic"],
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const fontVars = [
  inter.variable,
  spaceGrotesk.variable,
  instrumentSerif.variable,
  fraunces.variable,
  playfair.variable,
  ebGaramond.variable,
  jetbrainsMono.variable,
  spaceMono.variable,
].join(" ");

export const metadata: Metadata = {
  title: "CV Maker",
  description: "Personal CV workshop",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CV Maker",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#15171c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={fontVars}>
        {children}
        <AutoBackupLoop />
        <CostPill />
        <Cheatsheet />
        <ServiceWorkerRegistrar />
        <BaseSync />
        <DiscoveryAutoRefresh />
      </body>
    </html>
  );
}
