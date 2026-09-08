import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

// La catena di fallback Gemini può accumulare attese (2s + 5s + 10s) prima
// di restituire un errore: serve margine oltre i 10s di default.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Word = { text: string; start: number; end: number };

const SYSTEM_PROMPT = `Sei un editor esperto di video short-form. Riceverai la trascrizione di un video con marcatori di tempo nel formato [mm:ss].

Analizza il contenuto e seleziona da 3 a 5 estratti (clip) adatti a diventare video verticali brevi (Shorts/Reels/TikTok).

Privilegia: informazioni utili, momenti sorprendenti, storytelling, opinioni forti, curiosità, frasi ad alto potenziale di engagement.
Evita: introduzioni inutili, pause, ripetizioni, parti senza contesto, segmenti troppo brevi.
Ogni clip deve durare tra 20 e 60 secondi.

Rispondi SOLO con un oggetto JSON in questo formato esatto, senza testo aggiuntivo, markdown o spiegazioni:
{"clips":[{"start":<secondi numero>,"end":<secondi numero>,"title":"...","hook":"...","score":<0-100 numero>}]}`;

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configurata" },
        { status: 500 }
      );
    }

    const transcriptText = buildTimestampedTranscript(project.transcript.words);

    const { text: rawText, modelUsed } = await callGemini(
      apiKey,
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
      const { rows: clipRows } = await pool.query(
        `INSERT INTO clips (project_id, start_time, end_time, title, hook, score)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, clip.start, clip.end, clip.title ?? null, clip.hook ?? null, clip.score ?? null]
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
