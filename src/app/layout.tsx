import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Video Director | Vantage",
  description:
    "Vantage is the AI video director: it watches your long footage, finds the best moments and builds the shorts.",
  openGraph: {
    title: "AI Video Director | Vantage",
    description:
      "Vantage is the AI video director: it watches your long footage, finds the best moments and builds the shorts.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
