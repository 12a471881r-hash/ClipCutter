// Fase 5 — Trend Editing. Ogni effetto è un impulso di zoom (scale+crop,
// output sempre 1080x1920) attivo solo in una piccola finestra di tempo
// attorno al momento scelto dall'AI. Per seguire un nuovo trend in futuro
// basta aggiungere una entry a EFFECT_CONFIG — il motore di rendering non
// cambia.

export type EffectType = "punch_zoom" | "pattern_interrupt" | "subtle_zoom";
export const EFFECT_TYPES: EffectType[] = ["punch_zoom", "pattern_interrupt", "subtle_zoom"];

export type ClipEffect = { type: EffectType; at: number };

type EffectConfig = { halfWidth: number; peakZoom: number };

const EFFECT_CONFIG: Record<EffectType, EffectConfig> = {
  // push-in/zoom leggero su un momento di rilievo
  punch_zoom: { halfWidth: 0.35, peakZoom: 1.12 },
  // scatto più rapido e marcato, per riprendere l'attenzione
  pattern_interrupt: { halfWidth: 0.12, peakZoom: 1.22 },
  // zoom lento e impercettibile, per dare vita a un'inquadratura statica
  subtle_zoom: { halfWidth: 3.0, peakZoom: 1.05 },
};

// Non applicare effetti a raffica: tetto di sicurezza indipendente da
// quanti ne propone l'AI.
const MAX_EFFECTS_PER_CLIP = 4;

function zoomExpr(atSec: number, cfg: EffectConfig, fps: number): string {
  // Stesso impulso triangolare di prima, ma espresso in numero di frame
  // (variabile "on" di zoompan) invece che in secondi ("t"): su questo
  // binario ffmpeg, "t" non è utilizzabile nelle dimensioni di scale/crop
  // (vedi nota sopra), ma zoompan lavora nativamente per frame.
  const atFrame = (atSec * fps).toFixed(1);
  const hwFrames = (cfg.halfWidth * fps).toFixed(1);
  const peak = (cfg.peakZoom - 1).toFixed(3);
  const x = `(1-abs(on-${atFrame})/${hwFrames})`;
  const positiveX = `((${x}+abs(${x}))/2)`;
  return `(1+${peak}*${positiveX})`;
}

/**
 * Costruisce la catena di filtri ffmpeg per gli effetti dati. Gli "at"
 * devono essere già nella timeline di USCITA (dopo remapToOutputTime).
 *
 * Implementazione: filtro "zoompan" nativo di ffmpeg (pensato apposta per
 * zoom/pan animati), con d=1 per non alterare durata/velocità del video
 * (1 frame in -> 1 frame out). Evitato deliberatamente "scale" con w/h
 * dinamici basati su "t": su questo binario ffmpeg fallisce sempre con
 * "self-referencing" o errori di inizializzazione, anche con un solo lato
 * dinamico — è una limitazione nota di questa build, non del nostro codice.
 * zoompan usa "on" (numero di frame di uscita) al posto di "t", quindi
 * serve il framerate per convertire i nostri istanti in secondi.
 */
export function buildEffectsFilterChain(effects: ClipEffect[], fps: number): string {
  const capped = effects.slice(0, MAX_EFFECTS_PER_CLIP);
  return capped
    .map((e) => {
      const cfg = EFFECT_CONFIG[e.type];
      if (!cfg) return null;
      const z = zoomExpr(e.at, cfg, fps);
      return `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${fps}`;
    })
    .filter((f): f is string => f !== null)
    .join(",");
}
