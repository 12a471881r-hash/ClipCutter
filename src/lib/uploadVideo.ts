import { getSupabaseClient } from "@/lib/supabaseClient";
import { uploadResumable } from "@/lib/uploadResumable";

function putWithProgress(
  url: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload fallito (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Errore di rete durante l'upload"));
    xhr.send(file);
  });
}

/**
 * Carica il video sorgente e restituisce l'URL pubblico.
 * Usa Cloudflare R2 se configurato (nessun limite 50 MB), altrimenti
 * Supabase Storage (upload resumable).
 */
export async function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type }),
  });
  if (!res.ok) throw new Error("Impossibile ottenere l'URL di upload");
  const data = await res.json();

  if (data.mode === "r2") {
    await putWithProgress(data.uploadUrl, file, onProgress);
    return data.publicUrl as string;
  }

  // Fallback Supabase
  const filePath = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const supabase = getSupabaseClient();
  try {
    await uploadResumable("videos", filePath, file, onProgress);
  } catch (err) {
    console.warn("Upload resumable fallito, provo quello semplice:", err);
    onProgress?.(0);
    const { error } = await supabase.storage
      .from("videos")
      .upload(filePath, file, { cacheControl: "3600", upsert: true });
    if (error) throw error;
  }
  return supabase.storage.from("videos").getPublicUrl(filePath).data.publicUrl;
}
