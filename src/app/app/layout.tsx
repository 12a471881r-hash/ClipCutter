import type { Metadata } from "next";
import type { ReactNode } from "react";

// Metadata invariato: è lo stesso che si trovava nel layout root prima
// che la landing prendesse il posto di "/". Il resto del layout globale
// (html/body, font, globals.css) resta quello definito in src/app/layout.tsx.
export const metadata: Metadata = {
  title: "ClipAI — Trasforma i tuoi video in Shorts automaticamente",
  description: "Carica un video lungo e ottieni automaticamente clip verticali pronte per i social.",
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return children;
}
