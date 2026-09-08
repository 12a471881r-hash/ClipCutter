import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const { rows } = await pool.query(
    "SELECT * FROM projects ORDER BY created_at DESC"
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, original_video_url } = body;

  if (!name) {
    return NextResponse.json({ error: "name è obbligatorio" }, { status: 400 });
  }

  const { rows } = await pool.query(
    `INSERT INTO projects (name, original_video_url, status)
     VALUES ($1, $2, 'upload') RETURNING *`,
    [name, original_video_url ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
