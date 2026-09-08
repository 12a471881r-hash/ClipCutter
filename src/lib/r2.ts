import { S3Client } from "@aws-sdk/client-s3";

// Cloudflare R2 è S3-compatibile. Usiamo l'endpoint dell'account e region
// "auto". Le credenziali sono un API token R2 con permessi di lettura/scrittura
// oggetti sul bucket.
let client: S3Client | null = null;

export function getR2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // aws-sdk >= 3.729 aggiunge di default un checksum CRC32 che finisce
      // nell'URL pre-firmato ma non nel PUT del browser -> R2 rifiuta.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export const R2_BUCKET = process.env.R2_BUCKET!;

// URL pubblico di lettura del bucket (dominio r2.dev o custom domain), senza
// slash finale. Es. https://pub-xxxxx.r2.dev
export const R2_PUBLIC_BASE_URL = (
  process.env.R2_PUBLIC_BASE_URL ?? ""
).replace(/\/$/, "");

export function r2PublicUrl(key: string): string {
  return `${R2_PUBLIC_BASE_URL}/${key}`;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_BASE_URL
  );
}
