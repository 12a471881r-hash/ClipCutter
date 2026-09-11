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

function zoomExpr(atSec: number, cfg: EffectConfig): string {
  // Impulso triangolare: 1 (nessuno zoom) fuori dalla finestra, sale fino a
  // peakZoom esattamente al centro (atSec).
  return `(1+${(cfg.peakZoom - 1).toFixed(3)}*max(0\\,1-abs(t-${atSec.toFixed(2)})/${cfg.halfWidth}))`;
}

/**
 * Costruisce la catena di filtri ffmpeg (scale+crop) per gli effetti dati.
 * Gli "at" devono essere già nella timeline di USCITA (dopo remapToOutputTime).
 * L'output resta sempre 1080x1920: lo zoom è solo apparente.
 */
export function buildEffectsFilterChain(effects: ClipEffect[]): string {
  const capped = effects.slice(0, MAX_EFFECTS_PER_CLIP);
  return capped
    .map((e) => {
      const cfg = EFFECT_CONFIG[e.type];
      if (!cfg) return null;
      const z = zoomExpr(e.at, cfg);
      return `scale=w='1080*${z}':h='1920*${z}':eval=frame,crop=1080:1920`;
    })
    .filter((f): f is string => f !== null)
    .join(",");
}
