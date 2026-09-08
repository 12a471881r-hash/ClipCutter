import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getObjectStore,
  OBJECT_STORE_BUCKET,
  objectStorePublicUrl,
  isObjectStoreConfigured,
} from "@/lib/objectStore";

export const dynamic = "force-dynamic";

// Restituisce un URL PUT pre-firmato per caricare il video sorgente
// direttamente dal browser su uno storage S3-compatibile (Backblaze B2,
// Cloudflare R2, ...), senza il limite di 50 MB di Supabase. Se lo storage
// non è configurato, il client ripiega su Supabase.
export async function POST(req: NextRequest) {
  try {
    if (!isObjectStoreConfigured()) {
      return NextResponse.json({ mode: "supabase" });
    }

    const { name, type } = await req.json();
    const safeName = String(name ?? "video")
      .replace(/[^\w.-]+/g, "_")
      .slice(-120);
    const key = `videos/${Date.now()}-${safeName}`;

    const uploadUrl = await getSignedUrl(
      getObjectStore(),
      new PutObjectCommand({
        Bucket: OBJECT_STORE_BUCKET,
        Key: key,
        ContentType: type || "video/mp4",
      }),
      { expiresIn: 3600 }
    );

    return NextResponse.json({
      mode: "s3",
      uploadUrl,
      publicUrl: objectStorePublicUrl(key),
    });
  } catch (error) {
    console.error("Errore POST /api/upload-url:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
