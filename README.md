# ClipAI

MVP SaaS: carichi un video lungo, ottieni 3-5 clip verticali 9:16 con
sottotitoli bruciati, pronte per Shorts / Reels / TikTok.

Stack: Next.js 16 (App Router, `src/`) · TypeScript · Tailwind v4 ·
Supabase (Postgres + storage clip) · Cloudflare R2 (storage video
sorgente) · AssemblyAI (trascrizione) · Gemini/Groq (selezione clip) ·
FFmpeg (render). Deploy su Vercel.

## Pipeline

1. Upload del video → Cloudflare R2 via URL PUT pre-firmato (diretto dal
   browser, nessun limite 50 MB). Se R2 non è configurato, ripiega su
   Supabase Storage (resumable/TUS, max 50 MB su free tier).
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
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Cloudflare R2, storage video sorgente (opzionale: senza, fallback su Supabase 50 MB) |
| `R2_PUBLIC_BASE_URL` | URL pubblico del bucket R2 (dominio `r2.dev` o custom), senza slash finale |
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

**Video sorgente → Cloudflare R2** (consigliato: Supabase free tier ha un
limite fisso di 50 MB per file).

1. Cloudflare → R2 → crea un bucket (es. `clipcutter-videos`)
2. R2 → *Manage R2 API Tokens* → crea un token con *Object Read & Write*
   sul bucket → `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`. L'Account ID
   è in alto nella dashboard R2 → `R2_ACCOUNT_ID`
3. Bucket → *Settings* → *Public access* → abilita il dominio `r2.dev`
   → copia l'URL in `R2_PUBLIC_BASE_URL` (senza slash finale)
4. Bucket → *Settings* → *CORS policy* → aggiungi:

   ```json
   [
     {
       "AllowedOrigins": ["https://<tuo-dominio-vercel>", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
5. Su Vercel imposta le 5 var `R2_*` e (opzionale) `NEXT_PUBLIC_MAX_UPLOAD_MB=500`

Senza le var `R2_*` l'upload ripiega automaticamente su Supabase (bucket
`videos` **public**, con policy `insert` per il ruolo `anon`).

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
