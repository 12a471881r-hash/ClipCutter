import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM projects ORDER BY created_at DESC"
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Errore GET /api/projects:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
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
  } catch (error) {
    console.error("Errore POST /api/projects:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
