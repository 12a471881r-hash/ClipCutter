// CLIPCUTTER EDITING STYLE PROFILE — implementazione modulare.
//
// Ogni profilo è puro DATO (parametri + testo guida per l'AI), derivato dal
// documento "ClipCutter Editing Style Profile v1.0" (analisi di 5 clip di
// riferimento, Settembre 2026). L'AI di analisi identifica prima il genere
// del contenuto, poi applica le regole del profilo corrispondente.
//
// Per aggiornare il comportamento con nuove clip di riferimento: modifica i
// valori qui sotto (o aggiungi un nuovo genere). Il motore di rendering
// (captions.ts, editingEffects.ts, render route) NON va toccato: legge solo
// caption_style ed effects già decisi qui, resta genere-agnostico.

import type { CaptionStyle } from "./captions";

export type ContentGenre = "A_educational" | "B_podcast" | "C_edit";

export const GENRE_IDS: ContentGenre[] = ["A_educational", "B_podcast", "C_edit"];

export interface ScoreWeights {
  hook: number;
  coherence: number;
  payoff: number;
  engagement: number;
}

export interface StyleProfile {
  id: ContentGenre;
  label: string;
  // Stile sottotitoli di default per le clip di questo genere (l'AI può
  // comunque proporne uno diverso per una singola clip se ha una buona
  // ragione — vedi promptGuidance).
  defaultCaptionStyle: CaptionStyle;
  // Tetto sul numero di effetti punch-in/zoom per clip: i generi che si
  // affidano più alla varietà delle inquadrature reali che allo zoom
  // digitale ne ammettono di meno (vedi documento, sezione 5).
  maxEffectsPerClip: number;
  // Testo iniettato nel system prompt: guida hook/cutting/pacing/B-roll/
  // retention/loop per questo genere specifico.
  promptGuidance: string;
  // Fase 6 (Smart Segment Selection): peso di ciascun sotto-punteggio nel
  // calcolo del punteggio finale, coerente con le priorità del genere
  // (es. il genere B pesa di più hook/engagement, il genere A payoff/
  // coerenza). Deve sommare a 1.
  scoreWeights: ScoreWeights;
}

export const STYLE_PROFILES: Record<ContentGenre, StyleProfile> = {
  A_educational: {
    id: "A_educational",
    label: "Educational / solo-creator",
    defaultCaptionStyle: "minimal",
    maxEffectsPerClip: 4,
    promptGuidance: `GENERE A — Educational/solo-creator (spiegazione a singolo relatore, contenuto fattuale/didattico):
- Hook: costruisci un "curiosity gap" — enuncia il soggetto ma trattieni il dato/numero/fatto clou fino a ~2.5-3s dall'inizio della clip, poi rivelalo.
- Cutting/pacing: segmenti legati a un pensiero compiuto, non tagliare a metà idea. Va bene un segmento anche lungo se sta costruendo la suspense verso la rivelazione.
- Punch-in: usa il punch-in esattamente sul dato/numero/rivelazione, 2-4 volte per clip al massimo.
- Retention: il payoff informativo principale deve cadere al 70-90% della clip, non nell'ultimissimo istante — lascia un breve respiro dopo.
- Loop: opzionale, va benissimo chiudere con una risoluzione/rassicurazione invece di un loop letterale, soprattutto se l'inquadratura di apertura e chiusura si somigliano comunque.`,
    scoreWeights: { hook: 0.25, coherence: 0.3, payoff: 0.3, engagement: 0.15 },
  },
  B_podcast: {
    id: "B_podcast",
    label: "Podcast / Multicam",
    defaultCaptionStyle: "pop",
    maxEffectsPerClip: 1,
    promptGuidance: `GENERE B — Podcast/Multicam (conversazione tra più persone, botta e risposta, reazioni):
- Hook: non serve costruire un hook scritto ad hoc — l'energia della conversazione stessa (una domanda diretta, una reazione, un momento di tensione) è già il gancio: scegli il punto di ingresso "a freddo" più curioso.
- Cutting/pacing: segmenti anche brevi se il botta-e-risposta è serrato; un segmento può allungarsi durante un intervento lungo di una sola persona.
- Punch-in: usalo raramente (al massimo 1 per clip) — la varietà naturale tra i parlanti è già energia sufficiente.
- Retention: la clip funziona se cattura un picco della conversazione (una rivelazione, una reazione forte, una battuta) — non serve costruire tensione, basta scegliere il momento giusto.
- Loop: priorità bassa — va bene chiudere su una battuta o una reazione senza cercare un richiamo letterale all'inizio.`,
    scoreWeights: { hook: 0.35, coherence: 0.15, payoff: 0.2, engagement: 0.3 },
  },
  C_edit: {
    id: "C_edit",
    label: "Character / Tribute Edit",
    defaultCaptionStyle: "karaoke",
    maxEffectsPerClip: 2,
    promptGuidance: `GENERE C — Character/Tribute Edit (dichiarazione forte, emotiva o a forte carica personale, tipo intervista/confessione):
- Hook: domanda diretta e provocatoria, oppure una frase/affermazione dichiarativa forte come apertura — deve creare suspense su cosa segue.
- Cutting/pacing: preferisci segmenti brevi e frequenti quando il contenuto lo permette; se il video ha più "momenti" distinti nel discorso, valuta di combinarli (segmenti non consecutivi) per un ritmo più serrato.
- Punch-in: usane pochi (al massimo 2 per clip) e solo su parole/affermazioni ad alta carica emotiva — qui l'intensità viene soprattutto dalla forza del contenuto parlato stesso, non da effetti ripetuti.
- Retention: la dichiarazione/rivelazione emotiva è il centro della clip — tutto il resto deve portare lì.
- Loop: priorità alta — se l'inizio e la fine della clip possono richiamarsi semanticamente (stessa domanda, stesso tema), vale la pena costruire il loop; altrimenti non forzarlo.`,
    scoreWeights: { hook: 0.3, coherence: 0.15, payoff: 0.2, engagement: 0.35 },
  },
};

/** Blocco di testo con tutti i profili, da iniettare nel prompt AI: il
 * modello legge tutti e 3 i generi, decide quale si applica al contenuto
 * ricevuto, e ne segue le regole. */
export function buildGenreGuidanceBlock(): string {
  const blocks = GENRE_IDS.map((id) => STYLE_PROFILES[id].promptGuidance).join("\n\n");
  return `CLASSIFICAZIONE DEL GENERE: prima di scegliere le clip, individua quale dei 3 generi seguenti descrive meglio il contenuto di questa trascrizione, e applica le regole di quel genere nelle tue scelte (hook, ritmo dei segmenti, uso degli effetti, priorità del loop).

${blocks}

Indica il genere scelto nel campo "content_genre" della risposta (uno tra: "A_educational", "B_podcast", "C_edit").`;
}

export function resolveGenre(value: unknown): ContentGenre {
  return GENRE_IDS.includes(value as ContentGenre) ? (value as ContentGenre) : "A_educational";
}

/** Fase 6 (Smart Segment Selection): combina i 4 sotto-punteggi secondo i
 * pesi del profilo di genere. Usato per correggere/penalizzare un punteggio
 * complessivo che l'AI potrebbe aver sovrastimato (es. hook forte ma payoff
 * assente). */
export function computeWeightedScore(profile: StyleProfile, sub: ScoreWeights): number {
  const w = profile.scoreWeights;
  return sub.hook * w.hook + sub.coherence * w.coherence + sub.payoff * w.payoff + sub.engagement * w.engagement;
}
