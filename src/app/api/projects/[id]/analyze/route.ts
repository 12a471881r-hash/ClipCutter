import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { EFFECT_TYPES, type EffectType } from "@/lib/editingEffects";
import { CAPTION_STYLES, type CaptionStyle } from "@/lib/captions";
import {
  STYLE_PROFILES,
  SELECTION_CONFIG,
  buildGenreGuidanceBlock,
  resolveGenre,
  computeWeightedScore,
} from "@/lib/styleProfiles";

type Params = { params: Promise<{ id: string }> };

// La catena di fallback Gemini può accumulare attese (2s + 5s + 10s) prima
// di restituire un errore: serve margine oltre i 10s di default.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Word = { text: string; start: number; end: number };

const SYSTEM_PROMPT = `Sei un editor esperto di video short-form virali. Riceverai la trascrizione di un video con marcatori di tempo nel formato [mm:ss].

Il tuo compito non è tagliare intervalli a caso, ma capire il significato del discorso e proporre fino a 8 estratti CANDIDATI che funzionino come video verticali brevi (Shorts/Reels/TikTok). La selezione finale dei migliori viene fatta a valle sulla base dei punteggi che assegni, quindi proponi tutti i momenti che meritano davvero, senza riempire la lista con candidati deboli: se il video contiene solo 3 buoni momenti, proponine 3.

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

SELEZIONE DEI SEGMENTI (Fase 6): valuta ogni clip candidata su questi criteri prima di includerla nella risposta finale:
forza dell'hook, curiosità/interesse iniziale, completezza del pensiero, coerenza semantica, presenza di un payoff/conclusione, potenziale di engagement, chiarezza senza contesto esterno, durata appropriata al contenuto (non sempre la più lunga né la più corta), ridondanza rispetto alle altre clip scelte.

Regole aggiuntive per la selezione:
1. Non tagliare mai a metà una frase.
2. Preferisci l'inizio naturale di un pensiero.
3. Preferisci la fine naturale del pensiero/payoff — es. NON scegliere "Il problema è che molte persone…" se il pensiero continua subito dopo; preferisci includerlo fino alla sua conclusione naturale ("...fanno X, perché Y. Ed è proprio questo che porta a Z.").
4. Evita clip che richiedono troppo contesto precedente per essere capite.
5. Evita di proporre due clip quasi identiche tra loro (stesso segmento o stesso contenuto con minime variazioni) — se due candidate si sovrappongono molto, scegli solo la migliore delle due.
6. Non scegliere automaticamente le clip più lunghe.
7. Non scegliere automaticamente le clip più corte.
8. La durata deve emergere dal contenuto, non da un target fisso.
9. Valuta l'hook come dimensione separata dal resto (vedi hook_score sotto), non un'impressione generale unica.
10. Il payoff deve essere presente quando il contenuto lo permette.
11. Non inventare mai testo o contenuto non presente nella trascrizione.

Per ogni clip scelta, oltre a "score" (il punteggio complessivo), restituisci anche 4 sotto-punteggi separati da 0 a 100: "hook_score" (forza dell'aggancio iniziale), "coherence_score" (coerenza semantica e completezza del pensiero, chiarezza senza contesto esterno), "payoff_score" (presenza e forza di una conclusione/rivelazione), "engagement_score" (potenziale di coinvolgimento/curiosità/sorpresa). Aggiungi anche "reason": una frase che spiega perché questa clip ha ottenuto questi punteggi.

Rispondi SOLO con un oggetto JSON in questo formato esatto, senza testo aggiuntivo, markdown o spiegazioni:
{"content_genre":"A_educational|B_podcast|C_edit","clips":[{"segments":[{"start":<secondi numero>,"end":<secondi numero>}],"title":"...","hook":"...","score":<0-100 numero>,"hook_score":<0-100 numero>,"coherence_score":<0-100 numero>,"payoff_score":<0-100 numero>,"engagement_score":<0-100 numero>,"reason":"...","reasoning":"perché questa clip funziona, in una frase","effects":[{"type":"punch_zoom","at":<secondi numero>}],"caption_style":"karaoke|minimal|pop","loop":{"enabled":true/false,"loopScore":<0-100 numero>,"type":"semantic|sentence|question_answer|none","reason":"...","startSegment":"...","endSegment":"..."}}]}

${buildGenreGuidanceBlock()}`;

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

// Fase 6 (Smart Segment Selection) — helper di validazione/punteggio.
// Nessuna nuova chiamata AI: lavoriamo sui dati della stessa risposta.

function clampScore(value: unknown, fallback: number): number {
  // Attenzione: Number(null) === 0 e Number("") === 0, quindi un campo
  // assente/vuoto verrebbe letto come punteggio 0 (penalizzazione
  // ingiusta). Accettiamo solo numeri veri o stringhe numeriche.
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

/** Frazione di sovrapposizione temporale tra due set di segmenti (0-1),
 * calcolata sul più corto dei due: serve a scartare clip quasi identiche. */
function overlapRatio(a: ClipSegment[], b: ClipSegment[]): number {
  const totalOf = (segs: ClipSegment[]) =>
    segs.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);

  let shared = 0;
  for (const sa of a) {
    for (const sb of b) {
      shared += Math.max(0, Math.min(sa.end, sb.end) - Math.max(sa.start, sb.start));
    }
  }
  const shortest = Math.min(totalOf(a), totalOf(b));
  return shortest > 0 ? shared / shortest : 0;
}

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

    // Genere del contenuto: deciso dall'AI in base alla guida iniettata nel
    // prompt, validato contro i generi noti (fallback prudente altrimenti).
    // Determina lo stile sottotitoli di default e il tetto sugli effetti
    // per questo progetto — nessuna modifica al motore di rendering, solo
    // ai parametri con cui viene chiamato.
    const genre = resolveGenre(parsed.content_genre);
    const profile = STYLE_PROFILES[genre];
    await pool.query("UPDATE projects SET content_genre = $1 WHERE id = $2", [genre, id]);

    // ------------------------------------------------------------------
    // PASSO 1 — Validazione: costruiamo i candidati, scartando output
    // degeneri dell'AI. Nessun inserimento ancora: ordinamento e
    // deduplicazione devono avvenire PRIMA di scegliere, altrimenti si
    // tiene la clip che capita per prima invece della migliore.
    // ------------------------------------------------------------------
    type Candidate = {
      snapped: ClipSegment[];
      weightedScore: number;
      row: unknown[];
    };
    const candidates: Candidate[] = [];

    for (const clip of clips) {
      // Supporta sia il nuovo formato {segments:[{start,end},...]} sia,
      // per sicurezza, un eventuale vecchio formato piatto {start,end}.
      const rawSegments: ClipSegment[] =
        clip.segments ?? (clip.start !== undefined ? [{ start: clip.start, end: clip.end }] : []);

      if (!Array.isArray(rawSegments) || rawSegments.length === 0) continue;

      const snapped = rawSegments
        .filter(
          (seg) =>
            seg &&
            Number.isFinite(Number(seg.start)) &&
            Number.isFinite(Number(seg.end)) &&
            Number(seg.start) >= 0 &&
            Number(seg.start) < Number(seg.end)
        )
        .map((seg) =>
          snapToWordBoundary(project.transcript.words, Number(seg.start), Number(seg.end))
        )
        // Lo snap può, su input anomali, produrre un segmento degenere:
        // ricontrolliamo dopo la conversione.
        .filter((seg) => seg.end > seg.start);

      if (snapped.length === 0) {
        console.warn("Clip scartata: nessun segmento valido (start/end non coerenti)");
        continue;
      }

      const totalDuration = snapped.reduce((sum, s) => sum + (s.end - s.start), 0);
      if (
        totalDuration < SELECTION_CONFIG.minClipSeconds ||
        totalDuration > SELECTION_CONFIG.maxClipSeconds
      ) {
        console.warn(
          `Clip scartata: durata ${totalDuration.toFixed(1)}s fuori dai limiti di sicurezza (${SELECTION_CONFIG.minClipSeconds}-${SELECTION_CONFIG.maxClipSeconds}s)`
        );
        continue;
      }

      const envelopeStart = Math.min(...snapped.map((s) => s.start));
      const envelopeEnd = Math.max(...snapped.map((s) => s.end));
      const groundedHook = groundHook(clip.hook ?? null, project.transcript.words, snapped[0]);

      // Sotto-punteggi: se l'AI non li fornisce (o non sono numeri validi)
      // ricadiamo sul punteggio complessivo, così il comportamento resta
      // quello della fase precedente invece di rompersi.
      const baseScore = clampScore(clip.score, 50);
      const subScores = {
        hook: clampScore(clip.hook_score, baseScore),
        coherence: clampScore(clip.coherence_score, baseScore),
        payoff: clampScore(clip.payoff_score, baseScore),
        engagement: clampScore(clip.engagement_score, baseScore),
      };
      // Punteggio finale = media pesata secondo il genere. Così una clip con
      // hook forte ma payoff/coerenza deboli viene penalizzata anche se
      // l'AI le aveva dato uno "score" generoso.
      const weightedScore = Math.round(computeWeightedScore(profile, subScores));

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
        .slice(0, profile.maxEffectsPerClip);

      // Stile sottotitoli: usa quello proposto dall'AI per la singola clip
      // se valido, altrimenti il default del genere del progetto — mai un
      // valore hardcoded fisso indipendente dal contenuto.
      const captionStyle: CaptionStyle = CAPTION_STYLES.includes(clip.caption_style)
        ? clip.caption_style
        : profile.defaultCaptionStyle;

      // Motivazione: usiamo "reason" (nuovo, specifico sui punteggi) se
      // presente, altrimenti "reasoning" come nelle fasi precedenti. I
      // sotto-punteggi vengono accodati qui per tracciabilità, senza
      // aggiungere colonne al database.
      const reasonText = clip.reason ?? clip.reasoning ?? null;
      const reasoningWithScores = reasonText
        ? `${reasonText} [hook:${subScores.hook} coerenza:${subScores.coherence} payoff:${subScores.payoff} engagement:${subScores.engagement}]`
        : `[hook:${subScores.hook} coerenza:${subScores.coherence} payoff:${subScores.payoff} engagement:${subScores.engagement}]`;

      candidates.push({
        snapped,
        weightedScore,
        row: [
          id,
          envelopeStart,
          envelopeEnd,
          clip.title ?? null,
          groundedHook,
          weightedScore,
          JSON.stringify(snapped),
          reasoningWithScores,
          JSON.stringify(validEffects),
          JSON.stringify(loopData),
          captionStyle,
        ],
      });
    }

    // ------------------------------------------------------------------
    // PASSO 2 — Ordinamento per punteggio pesato (decrescente).
    // Finora il weightedScore veniva calcolato e salvato ma MAI usato per
    // scegliere: le clip venivano tenute nell'ordine in cui le restituiva
    // l'AI (tipicamente cronologico).
    // ------------------------------------------------------------------
    candidates.sort((a, b) => b.weightedScore - a.weightedScore);

    // ------------------------------------------------------------------
    // PASSO 3 — Deduplicazione DOPO l'ordinamento: ora "la prima" è
    // davvero la migliore, non la cronologicamente precedente.
    // ------------------------------------------------------------------
    const deduped: Candidate[] = [];
    for (const cand of candidates) {
      const duplicate = deduped.some(
        (kept) =>
          overlapRatio(kept.snapped, cand.snapped) > SELECTION_CONFIG.dedupOverlapThreshold
      );
      if (duplicate) {
        console.log(
          `Clip scartata (punteggio ${cand.weightedScore}): troppo simile a una già selezionata con punteggio più alto`
        );
        continue;
      }
      deduped.push(cand);
    }

    // ------------------------------------------------------------------
    // PASSO 4 — Limite finale. Se i candidati validi sono meno del limite
    // si restituiscono semplicemente quelli disponibili: non si inventano
    // clip per raggiungere il numero.
    // ------------------------------------------------------------------
    const selected = deduped.slice(0, SELECTION_CONFIG.maxClips);
    console.log(
      `Selezione clip: ${clips.length} proposte dall'AI → ${candidates.length} valide → ${deduped.length} dopo dedup → ${selected.length} selezionate (limite ${SELECTION_CONFIG.maxClips}); punteggi: ${selected.map((c) => c.weightedScore).join(", ")}`
    );

    // Se nessun candidato supera la validazione, NON cancelliamo nulla: il
    // progetto conserva le clip precedenti (se ce n'erano) e l'utente riceve
    // un errore esplicito, invece di ritrovarsi il progetto svuotato in
    // silenzio.
    if (selected.length === 0) {
      return NextResponse.json(
        {
          error:
            "L'analisi non ha prodotto clip valide. Riprova: se il problema persiste, il video potrebbe essere troppo corto o senza parlato sufficiente.",
        },
        { status: 422 }
      );
    }

    // Le clip vengono cancellate solo ORA che sappiamo di avere dei
    // sostituti validi.
    await pool.query("DELETE FROM clips WHERE project_id = $1", [id]);

    const saved = [];
    for (const cand of selected) {
      const { rows: clipRows } = await pool.query(
        `INSERT INTO clips (project_id, start_time, end_time, title, hook, score, segments, reasoning, effects, loop, caption_style)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        cand.row
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
