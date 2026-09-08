"use client";

import { useRef, useState, type DragEvent } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";

type Status = "idle" | "uploading" | "creating" | "done" | "error";

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

      setStatus("done");
    } catch (err) {
      console.error(err);
      setError("Upload fallito. Riprova.");
      setStatus("error");
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
              {status === "done" && "Caricato"}
            </span>
          </div>
          {status === "uploading" && (
            <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
              <div className="h-full w-1/3 bg-neutral-900 animate-pulse rounded-full" />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
