export type Segment = { start: number; end: number };

/**
 * Converte un istante nel video ORIGINALE nel corrispondente istante nel
 * video DI USCITA (dopo taglio+concatenazione dei segmenti). Ritorna null
 * se l'istante non ricade in nessun segmento scelto (es. un effetto
 * proposto dall'AI su una parte poi tagliata via).
 */
export function remapToOutputTime(originalTimeSec: number, segments: Segment[]): number | null {
  let cumulative = 0;
  for (const seg of segments) {
    if (originalTimeSec >= seg.start && originalTimeSec <= seg.end) {
      return cumulative + (originalTimeSec - seg.start);
    }
    cumulative += seg.end - seg.start;
  }
  return null;
}
