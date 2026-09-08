import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2, R2_BUCKET, r2PublicUrl, isR2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

// Restituisce un URL PUT pre-firmato per caricare il video sorgente
// direttamente dal browser su Cloudflare R2 (nessun limite 50 MB come
// Supabase). Se R2 non è configurato, il client ripiega su Supabase.
export async function POST(req: NextRequest) {
  try {
    if (!isR2Configured()) {
      return NextResponse.json({ mode: "supabase" });
    }

    const { name, type } = await req.json();
    const safeName = String(name ?? "video")
      .replace(/[^\w.-]+/g, "_")
      .slice(-120);
    const key = `videos/${Date.now()}-${safeName}`;

    const uploadUrl = await getSignedUrl(
      getR2(),
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ContentType: type || "video/mp4",
      }),
      { expiresIn: 3600 }
    );

    return NextResponse.json({
      mode: "r2",
      uploadUrl,
      publicUrl: r2PublicUrl(key),
    });
  } catch (error) {
    console.error("Errore POST /api/upload-url:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
