import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { pool } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildAss, hasCaptionableWords, CAPTION_STYLES, type CaptionStyle } from "@/lib/captions";
import { buildEffectsFilterChain, type ClipEffect } from "@/lib/editingEffects";
import { remapToOutputTime } from "@/lib/timeline";

// Oltre questa dimensione il video sorgente non entra nei limiti di /tmp
// (512 MB) e della memoria della function su Vercel: meglio fermarsi con
// un errore chiaro che far crashare il render.
const MAX_SOURCE_BYTES = 600 * 1024 * 1024;

// Fase 2 — Automatic Editing: soglie per la rimozione automatica delle pause
// (basata sui vuoti tra parole nella trascrizione, nessuna analisi audio
// extra necessaria) e limiti di sicurezza sul numero di sotto-segmenti.
const MIN_PAUSE_MS = 900;
const MIN_SUBSEGMENT_SEC = 1.5;
const MAX_SUBSEGMENTS = 12;

const ffmpegPath = ffmpegInstaller.path;

// Download del video + ffmpeg: operazione lunga. 60s è il massimo su Vercel
// Hobby; alzare a 300 se il progetto passa al piano Pro.
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
type Word = { text: string; start: number; end: number };
type Segment = { start: number; end: number };

// Divide un segmento nei punti dove la trascrizione mostra un vuoto tra
// parole più lungo di MIN_PAUSE_MS (pausa/silenzio) — nessuna analisi audio
// separata: riusa i timestamp già disponibili di AssemblyAI.
function splitOnPauses(words: Word[], segment: Segment): Segment[] {
  const startMs = segment.start * 1000;
  const endMs = segment.end * 1000;
  const relevant = words
    .filter((w) => w.end > startMs && w.start < endMs)
    .sort((a, b) => a.start - b.start);

  if (relevant.length < 2) return [segment];

  const parts: Segment[] = [];
  let curStartSec = segment.start;

  for (let i = 0; i < relevant.length - 1; i++) {
    const gap = relevant[i + 1].start - relevant[i].end;
    if (gap > MIN_PAUSE_MS) {
      const cutSec = relevant[i].end / 1000;
      if (cutSec - curStartSec >= MIN_SUBSEGMENT_SEC) {
        parts.push({ start: curStartSec, end: cutSec });
        curStartSec = relevant[i + 1].start / 1000;
      }
    }
  }
  parts.push({ start: curStartSec, end: segment.end });
  return parts;
}

// Applica lo split-pause a tutti i segmenti scelti dall'AI e limita il
// numero totale di pezzi (concat troppo frammentata rende il video a scatti
// e allunga inutilmente il comando ffmpeg).
function prepareSegments(words: Word[], segments: Segment[]): Segment[] {
  let all = segments.flatMap((seg) => splitOnPauses(words, seg));
  if (all.length > MAX_SUBSEGMENTS) {
    // Se troppo frammentato, meglio rinunciare allo split-pause che avere
    // un video irriconoscibile a scatti: torniamo ai segmenti originali.
    all = segments;
  }
  return all;
}

// Un -i per segmento (con -ss/-t propri) invece di un filtro trim unico:
// così ogni pezzo usa il fast-seek nativo di ffmpeg anche se i segmenti
// sono sparsi lontano tra loro nel video originale.
function buildFfmpegArgs(
  inputPath: string,
  segments: Segment[],
  vf: string,
  outputPath: string
): string[] {
  const args: string[] = [];
  for (const seg of segments) {
    args.push("-ss", String(seg.start), "-t", String(Math.max(0.1, seg.end - seg.start)), "-i", inputPath);
  }
  const concatInputs = segments.map((_, i) => `[${i}:v][${i}:a]`).join("");
  const filterComplex = `${concatInputs}concat=n=${segments.length}:v=1:a=1[vcat][acat];[vcat]${vf}[vout]`;

  args.push(
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[acat]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    // Senza -crf esplicito libx264 usa il default 23, che su testo e volti a
    // 1080x1920 perde dettaglio evitabile. 20 è un buon compromesso
    // qualità/tempo di encode (il budget della function è 60s).
    "-crf", "20",
    // Garantisce la riproducibilità su tutti i player mobile: senza questo,
    // un sorgente 4:2:2/4:4:4 produrrebbe un MP4 che molti dispositivi non
    // riescono a decodificare.
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "-y",
    outputPath
  );
  return args;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg (${code}): ${stderr.slice(-1500)}`));
    });
    proc.on("error", reject);
  });
}

// Legge in UNA SOLA passata risoluzione e framerate del sorgente ("ffmpeg -i"
// stampa sempre le info dello stream in stderr). Prima erano due processi
// ffmpeg separati per gli stessi dati: spreco dentro un budget di 60s già
// stretto. Serve a: Fase 7 (decidere se fare upscale) e Fase 5 (zoompan
// lavora per numero di frame, quindi serve il framerate reale).
type VideoInfo = { width: number; height: number } | null;

function probeVideoInfo(
  filePath: string
): Promise<{ resolution: VideoInfo; fps: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", filePath]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      const resMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
      resolve({
        resolution: resMatch
          ? { width: Number(resMatch[1]), height: Number(resMatch[2]) }
          : null,
        fps: fpsMatch ? Number(fpsMatch[1]) : null,
      });
    });
    proc.on("error", () => resolve({ resolution: null, fps: null }));
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  let assPath = "";
  let outputPath = "";
  let inputPath = "";
  // Cronometro per fase: serve a distinguere nei log un timeout (nessuna
  // riga "total") da un errore vero, e a capire quale fase consuma il
  // budget di maxDuration.
  const tStart = Date.now();

  try {
    const { id } = await params;

    let requestedStyle: CaptionStyle | null = null;
    try {
      const body = await req.json();
      if (body?.caption_style && CAPTION_STYLES.includes(body.caption_style)) {
        requestedStyle = body.caption_style;
      }
    } catch {
      // corpo assente o non JSON: usiamo lo stile salvato sulla clip
    }

    const { rows } = await pool.query(
      `SELECT clips.*, projects.original_video_url AS project_video_url,
              projects.transcript AS project_transcript
       FROM clips JOIN projects ON projects.id = clips.project_id
       WHERE clips.id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Clip non trovata" }, { status: 404 });
    }
    const clip = rows[0];

    if (!clip.project_video_url) {
      return NextResponse.json(
        { error: "Video originale mancante per questo progetto" },
        { status: 400 }
      );
    }

    const captionStyle: CaptionStyle = requestedStyle ?? clip.caption_style ?? "karaoke";

    const words: Word[] = clip.project_transcript?.words ?? [];
    // Retrocompatibilità: clip create prima della Fase 1 (senza colonna
    // "segments" popolata) usano ancora start_time/end_time.
    const baseSegments: Segment[] =
      clip.segments && Array.isArray(clip.segments) && clip.segments.length > 0
        ? clip.segments
        : [{ start: Number(clip.start_time), end: Number(clip.end_time) }];

    const segments = prepareSegments(words, baseSegments);

    const tmpDir = os.tmpdir();
    inputPath = path.join(tmpDir, `${id}-${Date.now()}-input.mp4`);
    assPath = path.join(tmpDir, `${id}-${Date.now()}.ass`);
    outputPath = path.join(tmpDir, `${id}-${Date.now()}.mp4`);

    // Scarichiamo prima il video in locale: leggere direttamente da URL
    // manda in crash il binario ffmpeg statico bundled in alcuni ambienti.
    // Lo scriviamo in streaming per non tenere l'intero file in memoria.
    const videoRes = await fetch(clip.project_video_url);
    if (!videoRes.ok || !videoRes.body) {
      throw new Error("Impossibile scaricare il video originale");
    }
    const declaredSize = Number(videoRes.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        { error: "Video originale troppo grande per il render su questo piano" },
        { status: 413 }
      );
    }
    await pipeline(
      Readable.fromWeb(videoRes.body as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(inputPath)
    );
    const tDownloaded = Date.now();
    const sourceMb = (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1);
    console.log(
      `[render ${id}] download: ${tDownloaded - tStart}ms (${sourceMb} MB)`
    );

    // Fase 7 (Quality Enhancement): scaling di qualità (lanczos) + lieve
    // sharpening SOLO quando il sorgente è sotto i 1920px di altezza, cioè
    // quando stiamo davvero facendo un upscale verso 1080x1920. Se il
    // sorgente è già in risoluzione pari o superiore, nessuna elaborazione
    // extra: darebbe solo più tempo di render senza alcun beneficio reale.
    const { resolution, fps: probedFps } = await probeVideoInfo(inputPath);
    const tProbed = Date.now();
    console.log(
      `[render ${id}] probe: ${tProbed - tDownloaded}ms (${
        resolution ? `${resolution.width}x${resolution.height}` : "risoluzione ignota"
      }, ${probedFps ?? "fps ignoto → default 25"})`
    );
    const needsUpscale = resolution !== null && resolution.height < 1920;
    const scaleFlags = needsUpscale ? ":flags=lanczos" : "";
    const enhanceFilter = needsUpscale ? ",unsharp=5:5:0.8:5:5:0.0" : "";

    // Se non ci sono parole nei segmenti (clip su musica/intro, timestamp AI
    // leggermente fuori range, ...) saltiamo il filtro subtitles: un file
    // sottotitoli vuoto fa fallire ffmpeg. Meglio una clip senza sottotitoli
    // che niente.
    let vf = `crop=ih*9/16:ih,scale=1080:1920${scaleFlags}${enhanceFilter}`;

    // Fase 5 (Trend Editing): rimappiamo gli effetti (tempo assoluto nel
    // video originale) sulla timeline di uscita concatenata, scartando
    // quelli che ricadevano in parti poi tagliate via dallo split-pause.
    const rawEffects: ClipEffect[] = Array.isArray(clip.effects) ? clip.effects : [];
    const remappedEffects: ClipEffect[] = rawEffects
      .map((e) => {
        const remapped = remapToOutputTime(e.at, segments);
        if (remapped === null) {
          // L'effetto era stato validato in analyze contro i segmenti PRIMA
          // dello split delle pause; qui i segmenti sono quelli DOPO. Se
          // l'istante cadeva in una pausa poi rimossa, l'effetto sparisce:
          // senza questo log l'utente vedeva semplicemente meno zoom del
          // previsto, senza alcuna spiegazione.
          console.warn(
            `[render ${id}] effetto "${e.type}" scartato: l'istante ${e.at}s del video originale cade in una parte rimossa dallo split delle pause`
          );
          return null;
        }
        return { type: e.type, at: remapped };
      })
      .filter((e): e is ClipEffect => e !== null);

    const effectsChain = buildEffectsFilterChain(remappedEffects, probedFps ?? 25);
    if (effectsChain) vf += `,${effectsChain}`;
    if (hasCaptionableWords(words, segments)) {
      const ass = buildAss(words, segments, captionStyle);
      fs.writeFileSync(assPath, ass, "utf8");
      const escapedAss = assPath.replace(/:/g, "\\:").replace(/'/g, "\\'");
      const fontsDir = path.join(process.cwd(), "src", "assets", "fonts");
      const escapedFontsDir = fontsDir.replace(/:/g, "\\:").replace(/'/g, "\\'");
      vf += `,subtitles='${escapedAss}':fontsdir='${escapedFontsDir}'`;
    } else {
      console.warn(`Clip ${id}: nessuna parola nel range, render senza sottotitoli`);
      assPath = "";
    }

    const tEncodeStart = Date.now();
    try {
      await runFfmpeg(buildFfmpegArgs(inputPath, segments, vf, outputPath));
    } catch (ffmpegError) {
      console.error(
        `[render ${id}] ERRORE FFMPEG dopo ${Date.now() - tEncodeStart}ms:`,
        (ffmpegError as Error).message
      );
      throw ffmpegError;
    }
    const tEncoded = Date.now();
    console.log(
      `[render ${id}] encode: ${tEncoded - tEncodeStart}ms (${segments.length} segmenti, ${remappedEffects.length} effetti, sottotitoli: ${assPath ? "sì" : "no"})`
    );

    const fileBuffer = fs.readFileSync(outputPath);
    const supabaseAdmin = getSupabaseAdmin();
    const storagePath = `clips/${id}-${Date.now()}.mp4`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("videos")
      .upload(storagePath, fileBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });
    if (uploadError) {
      console.error(`[render ${id}] ERRORE STORAGE:`, uploadError.message);
      throw uploadError;
    }
    console.log(
      `[render ${id}] upload: ${Date.now() - tEncoded}ms (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)`
    );

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("videos").getPublicUrl(storagePath);

    await pool.query("UPDATE clips SET video_url = $1 WHERE id = $2", [
      publicUrl,
      id,
    ]);

    console.log(`[render ${id}] TOTAL: ${Date.now() - tStart}ms`);
    return NextResponse.json({ video_url: publicUrl, segments_used: segments.length });
  } catch (error) {
    // Se nei log manca del tutto questa riga E manca "TOTAL", la function è
    // stata uccisa per timeout (maxDuration), non è un errore applicativo.
    console.error(
      `Errore POST /api/clips/[id]/render dopo ${Date.now() - tStart}ms:`,
      error
    );
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  } finally {
    if (assPath && fs.existsSync(assPath)) fs.unlinkSync(assPath);
    if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}
