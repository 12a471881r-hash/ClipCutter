import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [
            "video/mp4",
            "video/quicktime",
            "video/webm",
            "video/x-matroska",
            "video/x-msvideo",
            "video/mpeg",
            "video/3gpp",
            "video/ogg",
          ],
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024, // 2GB
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Il progetto viene creato lato client dopo il completamento dell'upload.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Errore generazione token upload:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
