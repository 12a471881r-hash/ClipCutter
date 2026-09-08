import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const project = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
  if (project.rows.length === 0) {
    return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
  }

  const clips = await pool.query(
    "SELECT * FROM clips WHERE project_id = $1 ORDER BY start_time",
    [id]
  );

  return NextResponse.json({ ...project.rows[0], clips: clips.rows });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of ["name", "original_video_url", "status"] as const) {
    if (body[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE projects SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { rowCount } = await pool.query("DELETE FROM projects WHERE id = $1", [id]);

  if (rowCount === 0) {
    return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
