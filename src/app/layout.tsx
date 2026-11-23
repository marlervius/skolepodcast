import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/source-serif-4";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";
import { PlayerProvider } from "@/context/PlayerContext";

export const metadata: Metadata = {
  title: { default: "Lytterom", template: "%s · Lytterom" },
  description: "Podkaster og undervisningsvideoer fra læreren din – rett på mobilen, uten innlogging.",
  applicationName: "Lytterom",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Lytterom", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#141311" },
  ],
};

// Setter lagret lys/mørk modus før første tegning, så siden ikke blinker.
const themeScript = `try{var t=localStorage.getItem("lytterom_theme_v1");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <PlayerProvider>
          <AppShell>{children}</AppShell>
        </PlayerProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
