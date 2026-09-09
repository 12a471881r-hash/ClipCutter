import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

// La catena di fallback Gemini può accumulare attese (2s + 5s + 10s) prima
// di restituire un errore: serve margine oltre i 10s di default.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Word = { text: string; start: number; end: number };

const SYSTEM_PROMPT = `Sei un editor esperto di video short-form virali. Riceverai la trascrizione di un video con marcatori di tempo nel formato [mm:ss].

Il tuo compito non è tagliare intervalli a caso, ma capire il significato del discorso e trovare 3-5 estratti che funzionino come video verticali brevi (Shorts/Reels/TikTok).

Per ogni clip, segui la struttura HOOK → CONTEXT → PAYOFF:
- HOOK: le primissime parole devono catturare l'attenzione (domanda, affermazione forte, curiosità).
- CONTEXT: il minimo necessario per capire la situazione.
- PAYOFF: la conclusione, la rivelazione, la battuta, l'insight — il motivo per cui vale guardare fino alla fine.

Regole:
- Ogni clip deve avere inizio e fine su un confine naturale di frase: non iniziare né finire a metà di un pensiero o con contesto mancante.
- Se ha senso, una clip può essere composta da PIÙ segmenti non consecutivi del video (es. una domanda posta a minuto 2 e la sua risposta a minuto 8): usali solo quando uniti insieme creano un racconto più forte, non di default.
- Privilegia: informazioni utili, momenti sorprendenti, storytelling, opinioni forti, curiosità, frasi ad alto potenziale di engagement.
- Evita: introduzioni inutili, pause, ripetizioni, segmenti troppo brevi o senza contesto.
- Ogni clip deve durare tra 20 e 60 secondi in totale (somma dei segmenti).

Rispondi SOLO con un oggetto JSON in questo formato esatto, senza testo aggiuntivo, markdown o spiegazioni:
{"clips":[{"segments":[{"start":<secondi numero>,"end":<secondi numero>}],"title":"...","hook":"...","score":<0-100 numero>,"reasoning":"perché questa clip funziona, in una frase"}]}`;

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
  const model = "llama-3.3-70b-versatile";
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

      const { rows: clipRows } = await pool.query(
        `INSERT INTO clips (project_id, start_time, end_time, title, hook, score, segments, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          id,
          envelopeStart,
          envelopeEnd,
          clip.title ?? null,
          clip.hook ?? null,
          clip.score ?? null,
          JSON.stringify(snapped),
          clip.reasoning ?? null,
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
