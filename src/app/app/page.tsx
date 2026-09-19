"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { uploadVideo } from "@/lib/uploadVideo";
import {
  compressVideoIfNeeded,
  cancelCompression,
  CompressionCancelledError,
  DEFAULT_MAX_UPLOAD_BYTES,
  HARD_LIMIT_BYTES,
  type CompressionProgress,
  type CompressionOptions,
} from "@/lib/videoCompression";
import { Button } from "@/components/ui/button";

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

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
  const [compressing, setCompressing] = useState(false);
  const [compressPercent, setCompressPercent] = useState(0);
  const [sizes, setSizes] = useState<{ original: number; compressed: number } | null>(
    null
  );

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setError("Il file deve essere un video");
      return;
    }

    setError("");
    setSizes(null);
    let fileToUpload = file;

    // Il limite di 50MB è reale solo su Supabase Storage: su S3/R2
    // (objectStore.ts, se configurato) non esiste. Sotto i 50MB nessun
    // backend richiederebbe comunque la compressione, quindi controlliamo
    // il backend attivo solo quando serve davvero — sopra quella soglia.
    // /api/upload-url lo sa già; uploadVideo() più sotto farà una sua
    // chiamata separata per ottenere l'URL di upload effettivo (una
    // richiesta in più solo per i file grandi, ma evita di riusare un
    // presigned URL che potrebbe scadere se la compressione dura a lungo).
    // Se questa chiamata fallisce per qualunque motivo, si ricade sul
    // comportamento Supabase (il più conservativo), invariato rispetto a prima.
    let uploadThreshold: number = DEFAULT_MAX_UPLOAD_BYTES;
    let compressionOptions: CompressionOptions | undefined;

    if (file.size > DEFAULT_MAX_UPLOAD_BYTES) {
      try {
        const backendRes = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, type: file.type }),
        });
        if (backendRes.ok) {
          const backendData = await backendRes.json();
          if (backendData.mode === "s3") {
            // Nessun limite reale su S3/R2: la sola soglia che conta è
            // quella di sicurezza per la memoria del browser
            // (HARD_LIMIT_BYTES), condivisa con compressVideoIfNeeded.
            uploadThreshold = HARD_LIMIT_BYTES;
            compressionOptions = {
              maxUploadBytes: HARD_LIMIT_BYTES,
              targetGoalBytes: HARD_LIMIT_BYTES,
            };
          }
        }
      } catch (err) {
        console.warn(
          "Impossibile determinare il backend di storage, uso il limite Supabase (50MB):",
          err
        );
      }
    }

    if (file.size > uploadThreshold) {
      setCompressing(true);
      setCompressPercent(0);
      try {
        const result = await compressVideoIfNeeded(
          file,
          (p: CompressionProgress) => {
            setCompressPercent(p.percent);
          },
          compressionOptions
        );
        fileToUpload = result.file;
        if (result.wasCompressed) {
          setSizes({ original: result.originalBytes, compressed: result.compressedBytes });
        }
      } catch (err) {
        if (err instanceof CompressionCancelledError) {
          setCompressing(false);
          return;
        }
        console.error(err);
        setError((err as Error).message);
        setCompressing(false);
        return;
      }
      setCompressing(false);
    }

    setProgress(0);
    setUploading(true);

    try {
      const publicUrl = await uploadVideo(fileToUpload, setProgress);

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fileToUpload.name,
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

  function handleCancelCompression() {
    cancelCompression();
    setCompressing(false);
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
        onClick={() => !uploading && !compressing && inputRef.current?.click()}
        className="w-full max-w-md flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center cursor-pointer transition-colors hover:border-accent/50"
      >
        <UploadCloud className="size-8 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">
          {compressing
            ? `Ottimizzazione video... ${compressPercent}%`
            : uploading
              ? `Caricamento in corso... ${progress}%`
              : "Trascina qui il tuo video"}
        </p>
        {sizes && !compressing && (
          <p className="text-xs text-muted-foreground">
            Video ottimizzato: {formatMb(sizes.original)} → {formatMb(sizes.compressed)} (
            {Math.round((1 - sizes.compressed / sizes.original) * 100)}%)
          </p>
        )}
        {(compressing || uploading) && (
          <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${compressing ? compressPercent : progress}%` }}
            />
          </div>
        )}
        {compressing ? (
          <Button type="button" variant="outline" size="sm" onClick={handleCancelCompression}>
            Annulla
          </Button>
        ) : (
          <Button type="button" disabled={uploading}>
            {uploading ? "Attendere..." : "Carica video"}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          disabled={uploading || compressing}
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
