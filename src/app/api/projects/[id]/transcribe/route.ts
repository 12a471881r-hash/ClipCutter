import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2/transcript";

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    const { rows } = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
    }
    const project = rows[0];

    if (!project.original_video_url) {
      return NextResponse.json(
        { error: "Il progetto non ha un video associato" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ASSEMBLYAI_API_KEY non configurata" },
        { status: 500 }
      );
    }

    const res = await fetch(ASSEMBLYAI_BASE, {
      method: "POST",
      headers: {
        authorization: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ audio_url: project.original_video_url }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Errore nella richiesta ad AssemblyAI");
    }

    await pool.query(
      "UPDATE projects SET transcript_job_id = $1, status = 'analisi' WHERE id = $2",
      [data.id, id]
    );

    return NextResponse.json({ job_id: data.id });
  } catch (error) {
    console.error("Errore POST /api/projects/[id]/transcribe:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    const { rows } = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
    }
    const project = rows[0];

    if (project.transcript) {
      return NextResponse.json({ status: "completed", transcript: project.transcript });
    }

    if (!project.transcript_job_id) {
      return NextResponse.json(
        { error: "Nessuna trascrizione avviata per questo progetto" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ASSEMBLYAI_API_KEY non configurata" },
        { status: 500 }
      );
    }

    const res = await fetch(`${ASSEMBLYAI_BASE}/${project.transcript_job_id}`, {
      headers: { authorization: apiKey },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Errore nel controllo dello stato AssemblyAI");
    }

    if (data.status === "completed") {
      const transcript = { text: data.text, words: data.words };
      await pool.query("UPDATE projects SET transcript = $1 WHERE id = $2", [
        JSON.stringify(transcript),
        id,
      ]);
      return NextResponse.json({ status: "completed", transcript });
    }

    if (data.status === "error") {
      await pool.query("UPDATE projects SET status = 'errore' WHERE id = $1", [id]);
      return NextResponse.json(
        { status: "error", error: data.error },
        { status: 200 }
      );
    }

    return NextResponse.json({ status: data.status });
  } catch (error) {
    console.error("Errore GET /api/projects/[id]/transcribe:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
