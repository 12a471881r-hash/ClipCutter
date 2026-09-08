import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { pool } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const ffmpegPath = ffmpegInstaller.path;

type Params = { params: Promise<{ id: string }> };
type Word = { text: string; start: number; end: number };

function srtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    s
  ).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
}

function buildSrt(words: Word[], startSec: number, endSec: number): string {
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  const relevant = words.filter((w) => w.start >= startMs && w.start < endMs);

  const CHUNK_SIZE = 6;
  const chunks: Word[][] = [];
  for (let i = 0; i < relevant.length; i += CHUNK_SIZE) {
    chunks.push(relevant.slice(i, i + CHUNK_SIZE));
  }

  return chunks
    .map((chunk, i) => {
      const start = chunk[0].start - startMs;
      const end = chunk[chunk.length - 1].end - startMs;
      const text = chunk.map((w) => w.text).join(" ");
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`;
    })
    .join("\n");
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

export async function POST(_req: NextRequest, { params }: Params) {
  let srtPath = "";
  let outputPath = "";
  let inputPath = "";

  try {
    const { id } = await params;

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

    const startSec = Number(clip.start_time);
    const endSec = Number(clip.end_time);
    const duration = endSec - startSec;
    const words: Word[] = clip.project_transcript?.words ?? [];

    const tmpDir = os.tmpdir();
    inputPath = path.join(tmpDir, `${id}-${Date.now()}-input.mp4`);
    srtPath = path.join(tmpDir, `${id}-${Date.now()}.srt`);
    outputPath = path.join(tmpDir, `${id}-${Date.now()}.mp4`);

    // Scarichiamo prima il video in locale: leggere direttamente da URL
    // manda in crash il binario ffmpeg statico bundled in alcuni ambienti.
    const videoRes = await fetch(clip.project_video_url);
    if (!videoRes.ok) {
      throw new Error("Impossibile scaricare il video originale");
    }
    fs.writeFileSync(inputPath, Buffer.from(await videoRes.arrayBuffer()));

    fs.writeFileSync(srtPath, buildSrt(words, startSec, endSec), "utf8");
    const escapedSrt = srtPath.replace(/:/g, "\\:").replace(/'/g, "\\'");

    await runFfmpeg([
      "-y",
      "-ss",
      String(startSec),
      "-i",
      inputPath,
      "-t",
      String(duration),
      "-vf",
      `crop=ih*9/16:ih,scale=1080:1920,subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2'`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const fileBuffer = fs.readFileSync(outputPath);
    const supabaseAdmin = getSupabaseAdmin();
    const storagePath = `clips/${id}-${Date.now()}.mp4`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("videos")
      .upload(storagePath, fileBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("videos").getPublicUrl(storagePath);

    await pool.query("UPDATE clips SET video_url = $1 WHERE id = $2", [
      publicUrl,
      id,
    ]);

    return NextResponse.json({ video_url: publicUrl });
  } catch (error) {
    console.error("Errore POST /api/clips/[id]/render:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  } finally {
    if (srtPath && fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
    if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}
