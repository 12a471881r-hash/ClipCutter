// Fase 4 — Dynamic Captions. Generiamo sottotitoli in formato ASS (non SRT):
// solo ASS supporta evidenziazione parola-per-parola (\kf), animazioni (\t)
// e stili con nome multipli. libass è già compilato nel binario ffmpeg
// usato dal progetto.

export type CaptionStyle = "karaoke" | "minimal" | "pop";
export const CAPTION_STYLES: CaptionStyle[] = ["karaoke", "minimal", "pop"];

type Word = { text: string; start: number; end: number };
type Segment = { start: number; end: number };

const ACCENT_ASS = "&H005A12B0"; // #B0125A in formato &HAABBGGRR
const WHITE_ASS = "&H00FFFFFF";
const BLACK_ASS = "&H00000000";

function assTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/[{}]/g, "");
}

const HEADER = (styleLine: string) => `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const STYLE_LINES: Record<CaptionStyle, string> = {
  karaoke: `Style: Cap,Roboto,64,${ACCENT_ASS},${WHITE_ASS},${BLACK_ASS},${BLACK_ASS},-1,0,0,0,100,100,0,0,1,3,0,2,60,60,140,1`,
  minimal: `Style: Cap,Roboto,52,${WHITE_ASS},${WHITE_ASS},${BLACK_ASS},${BLACK_ASS},0,0,0,0,100,100,0,0,1,2,0,2,60,60,120,1`,
  pop: `Style: Cap,Anton,84,${ACCENT_ASS},${ACCENT_ASS},${BLACK_ASS},${BLACK_ASS},-1,0,0,0,100,100,0,0,1,3,0,2,60,60,160,1`,
};

// Raggruppa parole assegnando timestamp cumulativi sulla timeline del video
// DI USCITA (concatenato), non su quella del video originale — stessa
// logica della Fase 2 per i sottotitoli SRT, riusata qui.
function walkSegments(
  words: Word[],
  segments: Segment[],
  chunkSize: number
): { chunk: Word[]; startMs: number; endMs: number }[] {
  const out: { chunk: Word[]; startMs: number; endMs: number }[] = [];
  let cumulativeMs = 0;

  for (const seg of segments) {
    const segStartMs = seg.start * 1000;
    const segEndMs = seg.end * 1000;
    const relevant = words.filter(
      (w) => w.end > segStartMs && w.start < segEndMs && w.text?.trim()
    );

    for (let i = 0; i < relevant.length; i += chunkSize) {
      const chunk = relevant.slice(i, i + chunkSize);
      const startMs = cumulativeMs + Math.max(0, chunk[0].start - segStartMs);
      const endMs =
        cumulativeMs + Math.max(startMs + 1, chunk[chunk.length - 1].end - segStartMs);
      out.push({ chunk, startMs, endMs });
    }
    cumulativeMs += segEndMs - segStartMs;
  }
  return out;
}

/** true se ci sono parole nel range dei segmenti (altrimenti niente sottotitoli da generare). */
export function hasCaptionableWords(words: Word[], segments: Segment[]): boolean {
  return segments.some((seg) => {
    const s = seg.start * 1000;
    const e = seg.end * 1000;
    return words.some((w) => w.end > s && w.start < e && w.text?.trim());
  });
}

export function buildAss(words: Word[], segments: Segment[], style: CaptionStyle): string {
  const header = HEADER(STYLE_LINES[style]);
  const lines: string[] = [];

  if (style === "pop") {
    // Una parola per evento, con animazione di "punch-in" (scala rapida).
    const groups = walkSegments(words, segments, 1);
    for (const { chunk, startMs, endMs } of groups) {
      const text = escapeAssText(chunk[0].text.trim());
      const override =
        "{\\fscx60\\fscy60\\t(0,120,\\fscx112\\fscy112)\\t(120,220,\\fscx100\\fscy100)}";
      lines.push(`Dialogue: 0,${assTime(startMs)},${assTime(endMs)},Cap,,0,0,0,,${override}${text}`);
    }
  } else if (style === "karaoke") {
    // Blocchi di poche parole con riempimento colore sincronizzato (\kf,
    // durata in centesimi di secondo per ciascuna parola).
    const groups = walkSegments(words, segments, 5);
    for (const { chunk, startMs, endMs } of groups) {
      const text = chunk
        .map((w) => {
          const cs = Math.max(1, Math.round((w.end - w.start) / 10));
          return `{\\kf${cs}}${escapeAssText(w.text.trim())} `;
        })
        .join("");
      lines.push(`Dialogue: 0,${assTime(startMs)},${assTime(endMs)},Cap,,0,0,0,,${text.trim()}`);
    }
  } else {
    // minimal: blocchi statici, nessuna animazione — come lo stile originale.
    const groups = walkSegments(words, segments, 6);
    for (const { chunk, startMs, endMs } of groups) {
      const text = escapeAssText(chunk.map((w) => w.text.trim()).join(" "));
      lines.push(`Dialogue: 0,${assTime(startMs)},${assTime(endMs)},Cap,,0,0,0,,${text}`);
    }
  }

  return header + lines.join("\n");
}
