import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth";
import { SalesProvider } from "@/lib/sales/store";
import { AppShell } from "@/components/shell/app-shell";
import { lookScript } from "@/lib/look";

export const metadata: Metadata = {
  title: "Smart GPL",
  description: "Production et ventes GPL : inventaires journaliers, commandes, expéditions, bouteilles par marque et grossistes.",
};

export const viewport: Viewport = { themeColor: "#e8ebe8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline script applies the saved look before the first paint; <html>
    // then differs from the server render, hence suppressHydrationWarning.
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: lookScript }} />
      </head>
      <body>
        <AuthProvider>
          <StoreProvider>
            <SalesProvider>
              <AppShell>{children}</AppShell>
            </SalesProvider>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
