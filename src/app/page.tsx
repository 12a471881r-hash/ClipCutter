"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { uploadVideo } from "@/lib/uploadVideo";
import { Button } from "@/components/ui/button";

function FormatGlyph() {
  return (
    <svg width="72" height="32" viewBox="0 0 72 32" fill="none" aria-hidden="true">
      <rect x="0.5" y="6.5" width="27" height="19" rx="2" className="stroke-foreground/30" />
      <path d="M33 16H41" className="stroke-accent" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M37 12.5L41 16L37 19.5" className="stroke-accent" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="47.5" y="0.5" width="15" height="31" rx="2" className="stroke-accent" strokeWidth="1.5" />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setError("Il file deve essere un video");
      return;
    }

    // Limite di sicurezza lato client. Con Supabase (free) sono 50 MB fissi;
    // con Cloudflare R2 configurato si può alzare via NEXT_PUBLIC_MAX_UPLOAD_MB.
    const maxMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 50);
    if (file.size > maxMb * 1024 * 1024) {
      setError(
        `Video troppo grande (${(file.size / 1024 / 1024).toFixed(0)} MB). ` +
          `Il limite attuale è ${maxMb} MB — comprimi il video o riducine la durata.`
      );
      return;
    }

    setError("");
    setProgress(0);
    setUploading(true);

    try {
      const publicUrl = await uploadVideo(file, setProgress);

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          original_video_url: publicUrl,
        }),
      });

      if (!res.ok) throw new Error("Errore nella creazione del progetto");
      const project = await res.json();

      router.push(`/project/${project.id}?autorun=1`);
    } catch (err) {
      console.error(err);
      setError("Upload fallito. Controlla la connessione e riprova.");
      setUploading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 gap-8">
      <div className="text-center space-y-4 max-w-md">
        <FormatGlyph />
        <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
          I tuoi video, tagliati per i social.
        </h1>
        <p className="text-muted-foreground text-balance">
          Carica un video lungo. ClipAI trova i momenti migliori e li trasforma in clip verticali pronte da pubblicare.
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="w-full max-w-md flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center cursor-pointer transition-colors hover:border-accent/50"
      >
        <UploadCloud className="size-8 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">
          {uploading
            ? `Caricamento in corso... ${progress}%`
            : "Trascina qui il tuo video"}
        </p>
        {uploading && (
          <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        <Button type="button" disabled={uploading}>
          {uploading ? "Attendere..." : "Carica video"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
