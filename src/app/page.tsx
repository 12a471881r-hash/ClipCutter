"use client";

import { useRef, useState, type DragEvent } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";

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

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-10">
      <div className="text-center space-y-3">
        <span className="text-sm font-medium tracking-widest text-neutral-500 uppercase">
          ClipAI
        </span>
        <h1 className="text-3xl sm:text-4xl font-semibold text-neutral-900">
          Trasforma i tuoi video in Shorts automaticamente.
        </h1>
      </div>

      {showDropzone ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="w-full max-w-xl flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-8 py-16 text-center cursor-pointer transition-colors hover:border-neutral-400 hover:bg-neutral-100"
        >
          <p className="text-neutral-600">Trascina qui il tuo video</p>
          <span className="inline-flex items-center rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">
            Carica video
          </span>
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
        <div className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white px-8 py-10 space-y-4">
          <div className="flex justify-between text-sm text-neutral-500">
            <span>Nome file</span>
            <span className="text-neutral-900 font-medium truncate max-w-[60%]">
              {fileName}
            </span>
          </div>
          <div className="flex justify-between text-sm text-neutral-500">
            <span>Dimensione</span>
            <span className="text-neutral-900 font-medium">
              {formatBytes(fileSize)}
            </span>
          </div>
          {duration !== null && duration > 0 && (
            <div className="flex justify-between text-sm text-neutral-500">
              <span>Durata</span>
              <span className="text-neutral-900 font-medium">
                {formatDuration(duration)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm text-neutral-500">
            <span>Stato</span>
            <span className="text-neutral-900 font-medium">
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
          </div>
          {(status === "uploading" ||
            status === "transcribing" ||
            status === "analyzing" ||
            status === "rendering") && (
            <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
              <div className="h-full w-1/3 bg-neutral-900 animate-pulse rounded-full" />
            </div>
          )}
          {(status === "rendering" || status === "completed") &&
            clips.length > 0 && (
              <div className="pt-2 space-y-3">
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    className="rounded-xl border border-neutral-200 p-4 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-neutral-900">
                        {clip.title ?? "Clip senza titolo"}
                      </p>
                      {clip.score !== null && (
                        <span className="text-xs font-medium text-neutral-500">
                          Score {clip.score}
                        </span>
                      )}
                    </div>
                    {clip.hook && (
                      <p className="text-sm text-neutral-600">{clip.hook}</p>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-neutral-400">
                        {formatDuration(Number(clip.start_time))} –{" "}
                        {formatDuration(Number(clip.end_time))}
                      </p>
                      {clip.video_url ? (
                        <a
                          href={clip.video_url}
                          download
                          className="text-xs font-medium text-neutral-900 underline"
                        >
                          Scarica
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-400">
                          In lavorazione...
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </main>
  );
}
