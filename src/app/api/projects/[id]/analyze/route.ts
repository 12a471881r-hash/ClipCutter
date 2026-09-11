import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { EFFECT_TYPES, type EffectType } from "@/lib/editingEffects";

type Params = { params: Promise<{ id: string }> };

// La catena di fallback Gemini può accumulare attese (2s + 5s + 10s) prima
// di restituire un errore: serve margine oltre i 10s di default.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Word = { text: string; start: number; end: number };

const SYSTEM_PROMPT = `Sei un editor esperto di video short-form virali. Riceverai la trascrizione di un video con marcatori di tempo nel formato [mm:ss].

Il tuo compito non è tagliare intervalli a caso, ma capire il significato del discorso e trovare 3-5 estratti che funzionino come video verticali brevi (Shorts/Reels/TikTok).

Per ogni clip, segui la struttura HOOK → CONTEXT → PAYOFF:
- HOOK: il PRIMO segmento della clip deve catturare l'attenzione nei primi istanti. Se la frase più forte del discorso non è all'inizio cronologico del contenuto scelto, puoi METTERLA COME PRIMO SEGMENTO comunque, anche se nel video originale viene dopo — poi fai seguire gli altri segmenti (es. il contesto iniziale) in modo che il tutto resti comprensibile.
- CONTEXT: il minimo necessario per capire la situazione.
- PAYOFF: la conclusione, la rivelazione, la battuta, l'insight — il motivo per cui vale guardare fino alla fine.

IMPORTANTE sull'hook: il campo "hook" deve essere una frase PRESA LETTERALMENTE dalla trascrizione, corrispondente al primo segmento della clip. Non inventare mai una frase che non sia stata realmente detta nel video.

EFFETTI (opzionale): puoi proporre da 0 a massimo 4 momenti in cui un piccolo effetto visivo rafforzerebbe la clip. Tipi disponibili:
- "punch_zoom": leggero push-in su un momento di rilievo o una rivelazione.
- "pattern_interrupt": scatto più marcato per riprendere l'attenzione dopo un tratto piatto.
- "subtle_zoom": zoom lento e impercettibile su un'inquadratura statica lunga.
Usali solo dove il contenuto lo giustifica davvero — una clip può benissimo non averne nessuno. "at" deve essere un istante (in secondi, tempo ASSOLUTO nel video originale) che ricade dentro uno dei segmenti scelti per la clip.

LOOP (opzionale): dopo aver scelto i segmenti, valuta se il finale della clip può ricollegarsi naturalmente all'inizio, così che ripetendola (come fanno in automatico TikTok/Reels) sembri un loop voluto e non un taglio brusco. Collegamenti validi:
- continuità di frase (il finale porta naturalmente a rileggere l'inizio come continuazione)
- domanda → risposta → ritorno alla domanda
- frase finale che richiama semanticamente l'inizio
- struttura circolare naturale del discorso
NON forzare un loop se peggiora il contenuto: in quel caso enabled=false, type="none". "startSegment" ed "endSegment" devono essere frasi PRESE LETTERALMENTE dalla trascrizione (mai inventate), quelle su cui si basa il collegamento.

Regole:
- Ogni clip deve avere inizio e fine su un confine naturale di frase: non iniziare né finire a metà di un pensiero o con contesto mancante.
- L'ordine dei segmenti nell'array NON deve essere per forza cronologico: usalo per mettere l'hook più forte per primo quando aiuta la clip.
- Se ha senso, una clip può essere composta da PIÙ segmenti non consecutivi del video (es. una domanda posta a minuto 2 e la sua risposta a minuto 8): usali solo quando uniti insieme creano un racconto più forte, non di default.
- Privilegia: informazioni utili, momenti sorprendenti, storytelling, opinioni forti, curiosità, frasi ad alto potenziale di engagement.
- Evita: introduzioni inutili, pause, ripetizioni, segmenti troppo brevi o senza contesto.
- Ogni clip deve durare tra 20 e 60 secondi in totale (somma dei segmenti).

Rispondi SOLO con un oggetto JSON in questo formato esatto, senza testo aggiuntivo, markdown o spiegazioni:
{"clips":[{"segments":[{"start":<secondi numero>,"end":<secondi numero>}],"title":"...","hook":"...","score":<0-100 numero>,"reasoning":"perché questa clip funziona, in una frase","effects":[{"type":"punch_zoom","at":<secondi numero>}],"loop":{"enabled":true/false,"loopScore":<0-100 numero>,"type":"semantic|sentence|question_answer|none","reason":"...","startSegment":"...","endSegment":"..."}}]}`;

function buildTimestampedTranscript(words: Word[]): string {
  let result = "";
  let lastMarker = -10000;
  for (const w of words) {
    if (w.start - lastMarker >= 5000) {
      const seconds = Math.floor(w.start / 1000);
      const mm = Math.floor(seconds / 60);
      const ss = (seconds % 60).toString().padStart(2, "0");
      result += `\n[${mm}:${ss}] `;
      lastMarker = w.start;
    }
    result += w.text + " ";
  }
  return result.trim();
}

// Evita di tagliare a metà parola: sposta il confine proposto dall'AI
// sull'inizio/fine della parola più vicina della trascrizione reale.
function snapToWordBoundary(
  words: Word[],
  proposedStartSec: number,
  proposedEndSec: number
): { start: number; end: number } {
  if (words.length === 0) return { start: proposedStartSec, end: proposedEndSec };

  const startMs = proposedStartSec * 1000;
  const endMs = proposedEndSec * 1000;

  let snappedStartMs = words[0].start;
  for (const w of words) {
    if (w.start <= startMs) snappedStartMs = w.start;
    else break;
  }

  let snappedEndMs = words[words.length - 1].end;
  for (const w of words) {
    if (w.end >= endMs) {
      snappedEndMs = w.end;
      break;
    }
  }

  return { start: snappedStartMs / 1000, end: snappedEndMs / 1000 };
}

type ClipSegment = { start: number; end: number };

// Fase 3 (AI Hook): il campo "hook" deve essere davvero presente nel video.
// Verifichiamo che le parole dell'hook dichiarato si sovrappongano abbastanza
// a quelle realmente pronunciate nel primo segmento; se no, lo sostituiamo
// con le parole vere di quel segmento — mai fidarsi ciecamente del testo AI.
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

function groundHook(hookText: string | null, words: Word[], firstSegment: ClipSegment): string | null {
  const segStartMs = firstSegment.start * 1000;
  const segEndMs = firstSegment.end * 1000;
  const actualWords = words
    .filter((w) => w.end > segStartMs && w.start < segEndMs)
    .map((w) => w.text);
  const actualText = actualWords.join(" ");
  if (actualWords.length === 0) return hookText;

  if (hookText) {
    const hookWords = normalizeWords(hookText);
    const actualSet = new Set(normalizeWords(actualText));
    const overlap = hookWords.filter((w) => actualSet.has(w)).length;
    const ratio = hookWords.length > 0 ? overlap / hookWords.length : 0;
    if (ratio >= 0.4) return hookText;
  }

  // Hook non verificabile nel testo reale: usiamo le prime parole vere del
  // primo segmento invece di rischiare di mostrare una frase inventata.
  return actualWords.slice(0, 12).join(" ") || hookText;
}

// Provati in ordine, con attesa progressiva tra un tentativo e l'altro in
// caso di sovraccarico (429 / "high demand"): modelli diversi hanno quote
// separate, quindi passare al successivo spesso risolve da solo.
const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
const RETRY_DELAYS_MS = [2000, 5000, 10000];

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userText: string
): Promise<{ text: string; modelUsed: string }> {
  let lastError: Error = new Error("Nessun modello Gemini disponibile");

  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? `Errore modello ${model}`);
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) throw new Error(`Risposta vuota dal modello ${model}`);
      return { text, modelUsed: model };
    } catch (err) {
      lastError = err as Error;
      console.error(`Gemini (${model}) fallito:`, lastError.message);

      const delay = RETRY_DELAYS_MS[i];
      const hasNextModel = i < GEMINI_MODELS.length - 1;
      if (delay && hasNextModel) {
        console.log(`Attendo ${delay}ms prima del modello successivo...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Fallback gratuito quando Gemini è sovraccarico su tutti i modelli: Groq
// ha un free tier generoso, API compatibile OpenAI e supporta output JSON.
// Usato solo se GROQ_API_KEY è configurata.
async function callGroq(
  apiKey: string,
  systemPrompt: string,
  userText: string
): Promise<{ text: string; modelUsed: string }> {
  const model = "openai/gpt-oss-120b";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Errore Groq (${model})`);
  }
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`Risposta vuota da Groq (${model})`);
  return { text, modelUsed: `groq/${model}` };
}

async function selectClips(
  systemPrompt: string,
  userText: string
): Promise<{ text: string; modelUsed: string }> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  // Se Groq è configurato lo usiamo per primo: è più veloce e il suo free
  // tier è più stabile di quello di Gemini (che va spesso in "high demand").
  if (groqKey) {
    try {
      return await callGroq(groqKey, systemPrompt, userText);
    } catch (err) {
      console.error("Groq fallito:", (err as Error).message);
      if (!geminiKey) throw err;
      console.log("Passo a Gemini...");
    }
  }

  if (geminiKey) {
    return await callGemini(geminiKey, systemPrompt, userText);
  }

  throw new Error("Nessun provider AI configurato (GEMINI_API_KEY o GROQ_API_KEY)");
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    const { rows } = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
    }
    const project = rows[0];

    if (!project.transcript?.words) {
      return NextResponse.json(
        { error: "Trascrizione non disponibile per questo progetto" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "Nessun provider AI configurato (GEMINI_API_KEY o GROQ_API_KEY)" },
        { status: 500 }
      );
    }

    const transcriptText = buildTimestampedTranscript(project.transcript.words);

    const { text: rawText, modelUsed } = await selectClips(
      SYSTEM_PROMPT,
      transcriptText
    );
    console.log(`Analisi completata con modello: ${modelUsed}`);

    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const clips = parsed.clips ?? [];

    await pool.query("DELETE FROM clips WHERE project_id = $1", [id]);

    const saved = [];
    for (const clip of clips) {
      // Supporta sia il nuovo formato {segments:[{start,end},...]} sia,
      // per sicurezza, un eventuale vecchio formato piatto {start,end}.
      const rawSegments: ClipSegment[] =
        clip.segments ?? (clip.start !== undefined ? [{ start: clip.start, end: clip.end }] : []);

      if (rawSegments.length === 0) continue;

      const snapped = rawSegments.map((seg) =>
        snapToWordBoundary(project.transcript.words, seg.start, seg.end)
      );
      const envelopeStart = Math.min(...snapped.map((s) => s.start));
      const envelopeEnd = Math.max(...snapped.map((s) => s.end));
      const groundedHook = groundHook(clip.hook ?? null, project.transcript.words, snapped[0]);

      // Validazione del loop: type tra i 4 ammessi, score clampato 0-100,
      // startSegment/endSegment verificati contro le parole vere (stesso
      // controllo anti-invenzione già usato per l'hook) sul primo e ultimo
      // segmento scelto. Se assente o malformato, niente loop.
      const LOOP_TYPES = ["semantic", "sentence", "question_answer", "none"];
      const rawLoop = clip.loop ?? {};
      const loopType = LOOP_TYPES.includes(rawLoop.type) ? rawLoop.type : "none";
      const loopData = {
        enabled: Boolean(rawLoop.enabled) && loopType !== "none",
        loopScore: Math.max(0, Math.min(100, Number(rawLoop.loopScore) || 0)),
        type: loopType,
        reason: typeof rawLoop.reason === "string" ? rawLoop.reason : null,
        startSegment: groundHook(rawLoop.startSegment ?? null, project.transcript.words, snapped[0]),
        endSegment: groundHook(
          rawLoop.endSegment ?? null,
          project.transcript.words,
          snapped[snapped.length - 1]
        ),
      };

      // Teniamo solo effetti di tipo valido il cui "at" ricade davvero
      // dentro uno dei segmenti scelti (altrimenti sarebbe un effetto su
      // una parte di video che la clip non contiene nemmeno).
      const validEffects = (Array.isArray(clip.effects) ? clip.effects : [])
        .filter(
          (e: { type?: string; at?: number }) =>
            EFFECT_TYPES.includes(e.type as EffectType) &&
            typeof e.at === "number" &&
            snapped.some((seg) => e.at! >= seg.start && e.at! <= seg.end)
        )
        .slice(0, 4);

      const { rows: clipRows } = await pool.query(
        `INSERT INTO clips (project_id, start_time, end_time, title, hook, score, segments, reasoning, effects, loop)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          id,
          envelopeStart,
          envelopeEnd,
          clip.title ?? null,
          groundedHook,
          clip.score ?? null,
          JSON.stringify(snapped),
          clip.reasoning ?? null,
          JSON.stringify(validEffects),
          JSON.stringify(loopData),
        ]
      );
      saved.push(clipRows[0]);
    }

    return NextResponse.json({ clips: saved });
  } catch (error) {
    console.error("Errore POST /api/projects/[id]/analyze:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
