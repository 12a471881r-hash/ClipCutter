"use client";

import { useRef, useState, type CSSProperties, type DragEvent } from "react";
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

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function FormatGlyph() {
  return (
    <svg width="72" height="32" viewBox="0 0 72 32" fill="none" aria-hidden="true">
      <rect x="0.5" y="6.5" width="27" height="19" rx="2" stroke="var(--v-border-strong)" />
      <path d="M33 16H41" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M37 12.5L41 16L37 19.5" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="47.5" y="0.5" width="15" height="31" rx="2" stroke="var(--v-primary)" strokeWidth="1.5" />
    </svg>
  );
}

// Variabili CSS di questa pagina soltanto (stessa identità della landing,
// vedi src/app/page.tsx): non tocca globals.css, quindi non cambia nulla
// altrove nell'app.
const vantageVars = {
  "--v-bg": "#070707",
  "--v-surface": "#111111",
  "--v-fg": "#F5F3EE",
  "--v-fg-muted": "#969696",
  "--v-primary": "#FF2D95",
  "--v-accent": "#FF7A00",
  "--v-border": "rgba(245,243,238,0.12)",
  "--v-border-strong": "rgba(245,243,238,0.3)",
  "--v-font-sans": "'Archivo', sans-serif",
  "--v-font-mono": "'Space Mono', monospace",
} as CSSProperties;

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
  const [isDragging, setIsDragging] = useState(false);

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
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div style={vantageVars} className="app-v-scope min-h-screen bg-[var(--v-bg)] text-[var(--v-fg)]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .app-v-scope { font-family: var(--v-font-sans); }
        .app-v-scope .v-mono { font-family: var(--v-font-mono); }
        @keyframes app-v-fade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes app-v-pulse { 0%,100% { opacity:.35; transform:scale(.85); } 50% { opacity:1; transform:scale(1); } }
        @keyframes app-v-scan { 0% { transform: translateX(-110%); opacity: 0; } 18%,82% { opacity: .9; } 100% { transform: translateX(410%); opacity: 0; } }
        .app-v-scope .v-fade-el { opacity: 0; animation: app-v-fade .7s cubic-bezier(.22,1,.36,1) .05s both; }
        .app-v-scope .v-fade-el.d2 { animation-delay: .15s; }
        .app-v-scope .v-pulse-el { animation: app-v-pulse 2.8s ease-in-out infinite; }
        .app-v-scope .v-scan-el { animation: app-v-scan 5.5s linear infinite; }
        .app-v-scope .app-upload-zone {
          position: relative; overflow: hidden;
          box-shadow: inset 0 0 55px color-mix(in oklab, var(--v-bg) 65%, transparent);
        }
        .app-v-scope .app-upload-zone::before {
          content: ""; position: absolute; inset: 0;
          background-image: linear-gradient(var(--v-border) 1px, transparent 1px), linear-gradient(90deg, var(--v-border) 1px, transparent 1px);
          background-size: 42px 42px; mask-image: radial-gradient(circle at center, black, transparent 78%);
          opacity: .5; transition: opacity .5s ease; pointer-events: none;
        }
        .app-v-scope .app-upload-zone:hover::before { opacity: .8; }
        .app-v-scope .app-upload-zone::after {
          content: ""; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none;
          background: linear-gradient(115deg, transparent 20%, var(--v-primary), var(--v-accent), transparent 80%) border-box;
          border: 1px solid transparent; mask: linear-gradient(black 0 0) padding-box, linear-gradient(black 0 0); mask-composite: exclude;
          opacity: .18; transition: opacity .8s cubic-bezier(.16,1,.3,1);
        }
        .app-v-scope .app-upload-zone:hover::after, .app-v-scope .app-upload-zone[data-dragging="true"]::after { opacity: .62; }
        .app-v-scope .app-upload-zone[data-dragging="true"] { transform: scale(1.008); border-color: var(--v-primary); }
        @media (prefers-reduced-motion: reduce) {
          .app-v-scope .v-fade-el, .app-v-scope .v-pulse-el, .app-v-scope .v-scan-el { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-8 px-6 py-20">
        <div className="v-fade-el max-w-md space-y-4 text-center">
          <FormatGlyph />
          <h1 className="text-4xl font-black uppercase tracking-tight text-balance">
            I tuoi video, tagliati per i social.
          </h1>
          <p className="text-balance text-sm text-[var(--v-fg-muted)]">
            Carica un video lungo. ClipAI trova i momenti migliori e li trasforma in clip verticali pronte da pubblicare.
          </p>
        </div>

        <div
          data-dragging={isDragging}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
          }}
          onDrop={handleDrop}
          onClick={() => !uploading && !compressing && inputRef.current?.click()}
          className="app-upload-zone v-fade-el d2 flex w-full max-w-md cursor-pointer flex-col items-center justify-center gap-5 rounded-lg border border-[var(--v-border-strong)] bg-[var(--v-surface)]/70 px-8 py-14 text-center backdrop-blur-md transition-transform duration-500"
        >
          <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className="v-scan-el h-full w-1/3 bg-gradient-to-r from-transparent via-[var(--v-primary)] to-[var(--v-accent)]" />
          </div>
          <div className="relative flex size-16 items-center justify-center rounded-full border border-[var(--v-primary)]/35 bg-[var(--v-bg)]/60 shadow-[0_0_40px_rgba(255,45,149,0.24)]">
            <UploadCloud className="size-7 text-[var(--v-primary)]" strokeWidth={1.5} />
            <span className="v-pulse-el absolute inset-2 -z-10 rounded-full bg-[var(--v-primary)]/15" />
          </div>
          <p className="relative v-mono text-[11px] uppercase tracking-[0.12em] text-[var(--v-fg-muted)]">
            {compressing
              ? `Ottimizzazione video... ${compressPercent}%`
              : uploading
                ? `Caricamento in corso... ${progress}%`
                : "Trascina qui il tuo video"}
          </p>
          {sizes && !compressing && (
            <p className="relative v-mono text-[9px] uppercase tracking-[0.1em] text-[var(--v-fg-muted)]">
              Video ottimizzato: {formatMb(sizes.original)} → {formatMb(sizes.compressed)} (
              {Math.round((1 - sizes.compressed / sizes.original) * 100)}%)
            </p>
          )}
          {(compressing || uploading) && (
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--v-border)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)] transition-all"
                style={{ width: `${compressing ? compressPercent : progress}%` }}
              />
            </div>
          )}
          {compressing ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCancelCompression();
              }}
              className="v-mono relative rounded-full border border-[var(--v-border-strong)] px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-[var(--v-fg)] transition-all hover:border-transparent hover:bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] hover:text-[#0a0a0a]"
            >
              Annulla
            </button>
          ) : (
            <button
              type="button"
              disabled={uploading}
              className="v-mono relative rounded-full border border-transparent bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] px-6 py-2.5 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a] transition-opacity disabled:opacity-50"
            >
              {uploading ? "Attendere..." : "Carica video"}
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="sr-only"
            disabled={uploading || compressing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {error && <p className="relative text-sm text-[var(--v-primary)]">{error}</p>}
        </div>
      </main>
    </div>
  );
}
