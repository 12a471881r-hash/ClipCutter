// Compressione video lato client con ffmpeg.wasm. Usa il core "single
// thread" di proposito: non richiede gli header COOP/COEP (SharedArrayBuffer),
// che rischierebbero di rompere il resto dell'app (player Supabase, fetch
// verso servizi esterni). È più lento del core multi-thread ma più robusto.

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const TARGET_GOAL_BYTES = 44 * 1024 * 1024; // punto medio della finestra 40-48MB
const AUDIO_KBPS = 96;
// Floor puramente di sicurezza (evita bitrate 0/negativi), non di qualità:
// l'obiettivo primario è stare sotto 50MB, anche a scapito della qualità
// per video molto lunghi.
const MIN_VIDEO_KBPS = 80;
// Oltre questa soglia, ffmpeg.wasm rischia seriamente di esaurire la memoria
// del tab ed essere terminato dal browser (limite pratico, non solo lento):
// meglio avvisare chiaramente che tentare e far crashare la pagina.
const HARD_LIMIT_BYTES = 350 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
// Moltiplicatore sul bitrate target ad ogni tentativo successivo (più aggressivo).
const AGGRESSIVENESS = [1, 0.65, 0.4];

export class CompressionCancelledError extends Error {
  constructor() {
    super("Compressione annullata");
    this.name = "CompressionCancelledError";
  }
}
export class CompressionUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompressionUnsupportedError";
  }
}
export class CompressionTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompressionTooLargeError";
  }
}

export type CompressionProgress = {
  phase: "loading" | "compressing";
  percent: number;
  attempt: number;
};

export type CompressionResult = {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  wasCompressed: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegSingleton: any = null;
let cancelled = false;

export function isCompressionSupported(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly === "object";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFFmpeg(): Promise<any> {
  if (ffmpegSingleton?.loaded) return ffmpegSingleton;

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegSingleton = ffmpeg;
  return ffmpeg;
}

function getVideoMeta(
  file: File
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const meta = {
        duration: v.duration || 0,
        width: v.videoWidth || 1920,
        height: v.videoHeight || 1080,
      };
      URL.revokeObjectURL(v.src);
      resolve(meta);
    };
    v.onerror = () => resolve({ duration: 0, width: 1920, height: 1080 });
    v.src = URL.createObjectURL(file);
  });
}

export function cancelCompression() {
  cancelled = true;
  if (ffmpegSingleton) {
    try {
      ffmpegSingleton.terminate();
    } catch {
      // ignorato: terminate() può fallire se non c'è nulla in corso
    }
    ffmpegSingleton = null; // dopo terminate() va ricaricato da zero
  }
}

/**
 * Se il file è già <= 50MB lo restituisce invariato. Altrimenti lo comprime
 * nel browser (H.264/AAC/MP4, 1080p max) puntando a 40-48MB, riprovando con
 * impostazioni più aggressive fino a MAX_ATTEMPTS volte.
 */
export async function compressVideoIfNeeded(
  file: File,
  onProgress?: (p: CompressionProgress) => void
): Promise<CompressionResult> {
  if (file.size <= MAX_UPLOAD_BYTES) {
    return {
      file,
      originalBytes: file.size,
      compressedBytes: file.size,
      wasCompressed: false,
    };
  }

  if (!isCompressionSupported()) {
    throw new CompressionUnsupportedError(
      "Questo browser non supporta la compressione video (serve WebAssembly). Prova con Chrome, Firefox o Safari aggiornati, oppure comprimi il video manualmente prima di caricarlo."
    );
  }

  if (file.size > HARD_LIMIT_BYTES) {
    throw new CompressionTooLargeError(
      `Il file è troppo grande (${(file.size / 1024 / 1024).toFixed(0)} MB) per essere compresso in modo affidabile nel browser: rischierebbe di esaurire la memoria della pagina. Comprimilo con un programma esterno (es. HandBrake) prima di caricarlo.`
    );
  }

  cancelled = false;
  onProgress?.({ phase: "loading", percent: 0, attempt: 1 });

  let ffmpeg;
  try {
    ffmpeg = await loadFFmpeg();
  } catch {
    throw new CompressionUnsupportedError(
      "Impossibile caricare il motore di compressione (verifica la connessione)."
    );
  }
  if (cancelled) throw new CompressionCancelledError();

  const meta = await getVideoMeta(file);
  const { fetchFile } = await import("@ffmpeg/util");

  const inputName = "input" + (file.name.match(/\.\w+$/)?.[0] || ".mp4");
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  if (cancelled) throw new CompressionCancelledError();

  let outputData: Uint8Array | null = null;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    if (cancelled) throw new CompressionCancelledError();

    const factor = AGGRESSIVENESS[attempt - 1];
    const totalKbps =
      meta.duration > 0
        ? Math.floor((TARGET_GOAL_BYTES * 8) / meta.duration / 1000) * factor
        : 1500 * factor; // durata ignota: bitrate fisso prudente
    const videoKbps = Math.max(MIN_VIDEO_KBPS, Math.round(totalKbps - AUDIO_KBPS));

    const outputName = `output-${attempt}.mp4`;
    const args = [
      "-i",
      inputName,
      ...(meta.height > 1080 ? ["-vf", "scale=-2:1080"] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-b:v",
      `${videoKbps}k`,
      "-maxrate",
      `${Math.round(videoKbps * 1.3)}k`,
      "-bufsize",
      `${Math.round(videoKbps * 2)}k`,
      "-c:a",
      "aac",
      "-b:a",
      `${AUDIO_KBPS}k`,
      "-movflags",
      "+faststart",
      "-y",
      outputName,
    ];

    const onProgressEvent = ({ progress }: { progress: number }) => {
      onProgress?.({
        phase: "compressing",
        percent: Math.min(99, Math.max(0, Math.round(progress * 100))),
        attempt,
      });
    };
    ffmpeg.on("progress", onProgressEvent);

    try {
      await ffmpeg.exec(args);
    } catch (err) {
      if (cancelled) throw new CompressionCancelledError();
      console.error("ffmpeg.exec fallito:", err);
      throw new Error(
        "Compressione fallita: il video potrebbe usare un formato non supportato o il browser è a corto di memoria."
      );
    } finally {
      ffmpeg.off("progress", onProgressEvent);
    }

    if (cancelled) throw new CompressionCancelledError();

    outputData = (await ffmpeg.readFile(outputName)) as Uint8Array;
    if (outputData.byteLength <= MAX_UPLOAD_BYTES) break;
  }

  if (!outputData) {
    throw new Error("Compressione fallita dopo tutti i tentativi.");
  }

  if (outputData.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Anche con la massima compressione il video resta a ${(outputData.byteLength / 1024 / 1024).toFixed(0)} MB, sopra il limite di 50MB — probabilmente è troppo lungo. Prova ad accorciarlo o a comprimerlo manualmente con qualità più bassa.`
    );
  }

  onProgress?.({ phase: "compressing", percent: 100, attempt });

  const compressedFile = new File(
    [outputData as BlobPart],
    file.name.replace(/\.\w+$/, "") + "-compresso.mp4",
    { type: "video/mp4" }
  );

  return {
    file: compressedFile,
    originalBytes: file.size,
    compressedBytes: compressedFile.size,
    wasCompressed: true,
  };
}
