import * as tus from "tus-js-client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Le nuove chiavi "publishable" (sb_publishable_...) NON sono JWT: vanno solo
// nell'header apikey. L'header Authorization richiede invece un JWT vero,
// quindi qui serve ancora la vecchia SUPABASE_ANON_KEY (formato eyJ...).
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const ANON_JWT = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Supabase impone chunk da esattamente 6 MB (tranne l'ultimo).
const CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * Upload resumable (protocollo TUS) verso Supabase Storage.
 *
 * A differenza di `supabase.storage.upload()` (una singola richiesta), spezza
 * il file in chunk da 6 MB e riprova/riprende i chunk falliti: necessario per
 * i video lunghi su connessioni instabili, dove la richiesta unica muore con
 * errori tipo ERR_SSL_BAD_RECORD_MAC / "Failed to fetch".
 */
export function uploadResumable(
  bucket: string,
  objectName: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${ANON_JWT}`,
        apikey: PUBLISHABLE_KEY,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: bucket,
        objectName,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onError: reject,
      onProgress: (sent, total) => {
        if (onProgress && total) onProgress(Math.round((sent / total) * 100));
      },
      onSuccess: () => resolve(),
    });

    // Riprende un upload interrotto in precedenza per lo stesso file, se c'è.
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}
