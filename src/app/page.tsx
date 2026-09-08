"use client";

import { useRef, useState, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardRow } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type Status =
  | "idle"
  | "uploading"
  | "creating"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "analyzed"
  | "rendering"
  | "completed"
  | "error";

type Clip = {
  id: number;
  start_time: string;
  end_time: string;
  title: string | null;
  hook: string | null;
  score: number | null;
  video_url?: string | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(videoEl.src);
      resolve(videoEl.duration || 0);
    };
    videoEl.onerror = () => resolve(0);
    videoEl.src = URL.createObjectURL(file);
  });
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [renderIndex, setRenderIndex] = useState(0);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setError("Il file deve essere un video");
      setStatus("error");
      return;
    }

    setError("");
    setFileName(file.name);
    setFileSize(file.size);
    setDuration(null);
    setStatus("uploading");

    try {
      const videoDuration = await getVideoDuration(file);
      setDuration(videoDuration);

      const filePath = `${Date.now()}-${file.name}`;
      const supabase = getSupabaseClient();
      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("videos").getPublicUrl(filePath);

      setStatus("creating");

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

      setStatus("transcribing");
      await pollTranscription(project.id);

      setStatus("analyzing");
      const analyzeRes = await fetch(`/api/projects/${project.id}/analyze`, {
        method: "POST",
      });
      if (!analyzeRes.ok) throw new Error("Errore nell'analisi AI");
      const analyzeData = await analyzeRes.json();
      const selectedClips: Clip[] = analyzeData.clips ?? [];
      setClips(selectedClips);
      setStatus("rendering");

      for (let i = 0; i < selectedClips.length; i++) {
        setRenderIndex(i + 1);
        try {
          const renderRes = await fetch(`/api/clips/${selectedClips[i].id}/render`, {
            method: "POST",
          });
          if (renderRes.ok) {
            const renderData = await renderRes.json();
            selectedClips[i] = { ...selectedClips[i], video_url: renderData.video_url };
            setClips([...selectedClips]);
          }
        } catch (renderErr) {
          console.error(renderErr);
        }
      }

      setStatus("completed");
    } catch (err) {
      console.error(err);
      setError("Upload fallito. Riprova.");
      setStatus("error");
    }
  }

  async function pollTranscription(projectId: number) {
    const startRes = await fetch(`/api/projects/${projectId}/transcribe`, {
      method: "POST",
    });
    if (!startRes.ok) throw new Error("Errore avvio trascrizione");

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const statusRes = await fetch(`/api/projects/${projectId}/transcribe`);
      if (!statusRes.ok) throw new Error("Errore controllo trascrizione");
      const data = await statusRes.json();

      if (data.status === "completed") {
        setStatus("transcribed");
        return;
      }
      if (data.status === "error") {
        throw new Error(data.error ?? "Trascrizione fallita");
      }
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const showDropzone = status === "idle" || status === "error";
  const isBusy =
    status === "uploading" ||
    status === "transcribing" ||
    status === "analyzing" ||
    status === "rendering";

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

      {showDropzone ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="w-full max-w-md flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center cursor-pointer transition-colors hover:border-accent/50"
        >
          <UploadCloud className="size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">Trascina qui il tuo video</p>
          <Button type="button">Carica video</Button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <Card className="w-full max-w-md px-7 py-8 space-y-5">
          <CardRow>
            <span className="text-muted-foreground">Nome file</span>
            <span className="font-medium truncate max-w-[60%]">{fileName}</span>
          </CardRow>
          <CardRow>
            <span className="text-muted-foreground">Dimensione</span>
            <span className="font-medium">{formatBytes(fileSize)}</span>
          </CardRow>
          {duration !== null && duration > 0 && (
            <CardRow>
              <span className="text-muted-foreground">Durata</span>
              <span className="font-medium">{formatDuration(duration)}</span>
            </CardRow>
          )}
          <CardRow>
            <span className="text-muted-foreground">Stato</span>
            <span className="font-medium">
              {status === "uploading" && "Caricamento in corso..."}
              {status === "creating" && "Creazione progetto..."}
              {status === "transcribing" && "Trascrizione in corso..."}
              {status === "transcribed" && "Trascrizione completata"}
              {status === "analyzing" && "Analisi AI in corso..."}
              {status === "analyzed" && `${clips.length} clip selezionate`}
              {status === "rendering" &&
                `Generazione clip ${renderIndex}/${clips.length}...`}
              {status === "completed" && "Completato"}
            </span>
          </CardRow>

          {isBusy && <Progress indeterminate />}

          {(status === "rendering" || status === "completed") &&
            clips.length > 0 && (
              <div className="pt-1 space-y-3">
                {clips.map((clip) => (
                  <Card key={clip.id} className="p-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{clip.title ?? "Clip senza titolo"}</p>
                      {clip.score !== null && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {clip.score}
                        </span>
                      )}
                    </div>
                    {clip.hook && (
                      <p className="text-sm text-muted-foreground">{clip.hook}</p>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-muted-foreground">
                        {formatDuration(Number(clip.start_time))} –{" "}
                        {formatDuration(Number(clip.end_time))}
                      </p>
                      {clip.video_url ? (
                        <a
                          href={clip.video_url}
                          download
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          Scarica
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          In lavorazione...
                        </span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
        </Card>
      )}
    </main>
  );
}
