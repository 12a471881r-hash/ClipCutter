# ClipAI

MVP SaaS: carichi un video lungo, ottieni 3-5 clip verticali 9:16 con
sottotitoli bruciati, pronte per Shorts / Reels / TikTok.

Stack: Next.js 16 (App Router, `src/`) · TypeScript · Tailwind v4 ·
Supabase (Postgres + Storage) · AssemblyAI (trascrizione) · Gemini
(selezione clip) · FFmpeg (render). Deploy su Vercel.

## Pipeline

1. Upload del video → Supabase Storage, bucket `videos`
2. Creazione record in `projects`
3. Trascrizione con AssemblyAI (word-level timestamps)
4. Analisi con Gemini: seleziona 3-5 clip (start/end/title/hook/score)
5. Render FFmpeg per clip: taglio, `crop=ih*9/16:ih,scale=1080:1920`,
   sottotitoli da SRT (chunk di 6 parole), output 1080x1920 MP4 `+faststart`
6. MP4 caricato su Storage, URL salvato in `clips.video_url`

## Setup locale

```bash
nvm use            # Node 20 (vedi .nvmrc)
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
| `ASSEMBLYAI_API_KEY` | trascrizione |
| `GEMINI_API_KEY` | analisi / selezione clip |

## Database

Lo schema è in `db/schema.sql` (idempotente). `npm run db:migrate` lo
applica via `scripts/migrate.js`. Ad ogni modifica dello schema va
rieseguito lo stesso SQL sul progetto Supabase (SQL Editor).

Tabelle: `projects` (id, name, original_video_url, status, created_at,
transcript_job_id, transcript) e `clips` (id, project_id, start_time,
end_time, title, hook, score, video_url, created_at).

## Storage

Bucket `videos` **public**, con policy di `insert` per il ruolo `anon`
(l'upload del video sorgente avviene dal browser con la chiave anon).

## Deploy su Vercel

- Tutte le env var sopra vanno configurate nel progetto Vercel.
- `@ffmpeg-installer/ffmpeg` è in `serverExternalPackages` (`next.config.ts`):
  il binario statico non va bundlato.
- Le route `render` e `analyze` hanno `maxDuration = 60` (limite piano
  Hobby). Sul piano Pro si può alzare a 300.
- Il render scarica il video sorgente in `/tmp` prima di passarlo a
  FFmpeg (il binario statico va in crash leggendo da URL) e processa solo
  la singola clip breve, mai il video intero.

## Note

- Gemini free tier a volte risponde "high demand" su tutti i modelli:
  non è un bug, riprovare. La route prova in sequenza
  `gemini-3.6/3.7/3.8-flash` con attese 2s/5s/10s.
- Si usa Supabase Storage (non Vercel Blob) per un bug CORS lato Vercel Blob.
