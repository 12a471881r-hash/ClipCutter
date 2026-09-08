# ClipAI

MVP SaaS: carichi un video lungo, ottieni 3-5 clip verticali 9:16 con
sottotitoli bruciati, pronte per Shorts / Reels / TikTok.

Stack: Next.js 16 (App Router, `src/`) · TypeScript · Tailwind v4 ·
Supabase (Postgres + storage clip) · storage S3-compatibile per i video
sorgente (Backblaze B2 / Cloudflare R2) · AssemblyAI (trascrizione) ·
Gemini/Groq (selezione clip) · FFmpeg (render). Deploy su Vercel.

## Pipeline

1. Upload del video → storage S3 via URL PUT pre-firmato (diretto dal
   browser, nessun limite 50 MB). Se lo storage S3 non è configurato,
   ripiega su Supabase Storage (resumable/TUS, max 50 MB su free tier).
2. Creazione record in `projects`
3. Trascrizione con AssemblyAI (word-level timestamps)
4. Analisi con Gemini: seleziona 3-5 clip (start/end/title/hook/score)
5. Render FFmpeg per clip: taglio, `crop=ih*9/16:ih,scale=1080:1920`,
   sottotitoli da SRT (chunk di 6 parole), output 1080x1920 MP4 `+faststart`
6. MP4 caricato su Storage, URL salvato in `clips.video_url`

## Setup locale

```bash
nvm use            # Node 22 (vedi .nvmrc)
npm install
cp .env.example .env   # e compila i valori
npm run db:migrate     # applica db/schema.sql
npm run dev
```

### Variabili d'ambiente

Vedi `.env.example`. Servono:

| Variabile | Uso |
| --- | --- |
| `DATABASE_URL` (o `POSTGRES_URL`) | Postgres Supabase, connection string pooled (`:6543`) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL progetto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | chiave anon, usata dal client per l'upload |
| `SUPABASE_SERVICE_ROLE_KEY` | usata lato server per l'upload delle clip renderizzate |
| `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` | storage S3-compatibile per i video sorgente (opzionale: senza, fallback su Supabase 50 MB) |
| `S3_PUBLIC_BASE_URL` | URL pubblico di lettura del bucket, senza slash finale |
| `NEXT_PUBLIC_MAX_UPLOAD_MB` | opzionale: limite upload lato client, default 50 |
| `ASSEMBLYAI_API_KEY` | trascrizione |
| `ASSEMBLYAI_SPEECH_MODEL` | opzionale: `nano` per trascrizioni più veloci; vuoto = `best` |
| `GEMINI_API_KEY` | analisi / selezione clip |
| `GROQ_API_KEY` | opzionale: se presente è il provider **primario** dell'analisi (più veloce/stabile di Gemini free); Gemini resta come fallback. [console.groq.com](https://console.groq.com) |

## Database

Lo schema è in `db/schema.sql` (idempotente). `npm run db:migrate` lo
applica via `scripts/migrate.js`. Ad ogni modifica dello schema va
rieseguito lo stesso SQL sul progetto Supabase (SQL Editor).

Tabelle: `projects` (id, name, original_video_url, status, created_at,
transcript_job_id, transcript) e `clips` (id, project_id, start_time,
end_time, title, hook, score, video_url, created_at).

## Storage

**Video sorgente → storage S3-compatibile** (Supabase free tier ha un
limite fisso di 50 MB per file). Consigliato **Backblaze B2**: 10 GB
gratis, nessuna carta richiesta.

### Backblaze B2

1. Crea l'account su backblaze.com → *B2 Cloud Storage*
2. *Buckets* → *Create a Bucket* → nome `clipcutter-videos`, **Public**
3. *App Keys* → *Add a New Application Key* → limitala al bucket, *Read and
   Write* → annota `keyID` (`S3_ACCESS_KEY_ID`) e `applicationKey`
   (`S3_SECRET_ACCESS_KEY`)
4. Nella pagina del bucket leggi l'**Endpoint** (es.
   `s3.us-west-004.backblazeb2.com`): `S3_ENDPOINT` =
   `https://s3.us-west-004.backblazeb2.com`, `S3_REGION` = `us-west-004`
5. `S3_PUBLIC_BASE_URL` = `https://f004.backblazeb2.com/file/clipcutter-videos`
   (il numero `f004` corrisponde alla regione `004`)
6. Bucket → *CORS Rules* → *Add* (o via CLI): consenti `PUT` e `GET`
   dall'origine dell'app (dominio Vercel + `http://localhost:3000`)
7. Su Vercel imposta le var `S3_*` e (opzionale) `NEXT_PUBLIC_MAX_UPLOAD_MB=500`,
   poi **Redeploy**

In alternativa **Cloudflare R2** (stesso codice, ma richiede una carta
anche sul piano gratuito): `S3_ENDPOINT` =
`https://<account_id>.r2.cloudflarestorage.com`, `S3_REGION` = `auto`,
`S3_PUBLIC_BASE_URL` = URL del dominio `r2.dev`.

Senza le var `S3_*` l'upload ripiega automaticamente su Supabase (bucket
`videos` **public**, policy `insert` per il ruolo `anon`, max 50 MB).

**Clip renderizzate → Supabase Storage**, bucket `videos` (file piccoli,
sotto i 50 MB).

## Deploy su Vercel

- Tutte le env var sopra vanno configurate nel progetto Vercel.
- `@ffmpeg-installer/ffmpeg` è in `serverExternalPackages` (`next.config.ts`):
  il binario statico non va bundlato.
- Le route `render` e `analyze` hanno `maxDuration = 60` (limite piano
  Hobby). Sul piano Pro si può alzare a 300.
- Il render scarica il video sorgente in `/tmp` (in streaming) prima di
  passarlo a FFmpeg (il binario statico va in crash leggendo da URL) e
  processa solo la singola clip breve, mai il video intero. Sorgenti
  oltre ~600 MB vengono rifiutati (limiti `/tmp` e memoria della function).

## Note

- Gemini free tier a volte risponde "high demand" su tutti i modelli:
  non è un bug, riprovare. La route prova in sequenza
  `gemini-3.6/3.7/3.8-flash` con attese 2s/5s/10s, poi — se `GROQ_API_KEY`
  è configurata — ripiega su Groq (`llama-3.3-70b-versatile`, free tier).
- Si usa Supabase Storage (non Vercel Blob) per un bug CORS lato Vercel Blob.
