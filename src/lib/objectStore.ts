import { S3Client } from "@aws-sdk/client-s3";

// Storage S3-compatibile per i video sorgente, per aggirare il limite di
// 50 MB di Supabase Storage (free tier). Funziona con qualunque provider S3:
//
//   Backblaze B2 (nessuna carta richiesta, 10 GB gratis)
//     S3_ENDPOINT        = https://s3.us-west-004.backblazeb2.com
//     S3_REGION          = us-west-004
//     S3_PUBLIC_BASE_URL = https://f004.backblazeb2.com/file/<bucket>
//
//   Cloudflare R2 (richiede una carta anche per il piano gratuito)
//     S3_ENDPOINT        = https://<account_id>.r2.cloudflarestorage.com
//     S3_REGION          = auto
//     S3_PUBLIC_BASE_URL = https://pub-xxxx.r2.dev

let client: S3Client | null = null;

export function getObjectStore(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      // aws-sdk >= 3.729 aggiunge di default un checksum CRC32 che finisce
      // nell'URL pre-firmato ma non nel PUT del browser: R2 e B2 lo rifiutano.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export const OBJECT_STORE_BUCKET = process.env.S3_BUCKET!;

// URL pubblico di lettura del bucket, senza slash finale.
export const OBJECT_STORE_PUBLIC_BASE_URL = (
  process.env.S3_PUBLIC_BASE_URL ?? ""
).replace(/\/$/, "");

export function objectStorePublicUrl(key: string): string {
  return `${OBJECT_STORE_PUBLIC_BASE_URL}/${key}`;
}

export function isObjectStoreConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY &&
      process.env.S3_BUCKET &&
      process.env.S3_PUBLIC_BASE_URL
  );
}
