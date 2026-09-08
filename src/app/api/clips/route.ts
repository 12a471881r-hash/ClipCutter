import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { project_id, start_time, end_time, title, hook, score, video_url } = body;

  if (!project_id || start_time === undefined || end_time === undefined) {
    return NextResponse.json(
      { error: "project_id, start_time e end_time sono obbligatori" },
      { status: 400 }
    );
  }

  const { rows } = await pool.query(
    `INSERT INTO clips (project_id, start_time, end_time, title, hook, score, video_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      project_id,
      start_time,
      end_time,
      title ?? null,
      hook ?? null,
      score ?? null,
      video_url ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
