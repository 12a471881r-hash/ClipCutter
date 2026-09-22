"use client";

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from "react";
import Link from "next/link";
import { ArrowRight, Film, Menu, Plus, Sparkles, UploadCloud, WandSparkles, X } from "lucide-react";

// ============================================================================
// Landing "/" — Vantage / Director.
//
// Questa pagina è isolata dal resto dell'app: palette, font e animazioni
// sono definiti qui (variabili CSS inline + un <style> scoped a questo
// componente) e non toccano src/app/globals.css, usato da /app. Nessuna
// logica di upload/compressione/backend è presente in questo file.
//
// ASSETS — unico punto da modificare per cambiare immagini/video della
// pagina. Ogni voce ha "src" (poster/immagine, percorso in /public) e,
// opzionale, "video" (url mp4/webm): se "video" è valorizzato, <Media>
// mostra un <video> invece di un <img>, usando "src" come poster.
// ============================================================================

const HERO_IMAGE = "/director-frame.jpg";

const ASSETS = {
  hero: { src: HERO_IMAGE, video: "" },
  finalCut: { src: HERO_IMAGE, video: "" },
  moments: { src: HERO_IMAGE, video: "" },
  momentThumbs: [HERO_IMAGE, HERO_IMAGE, HERO_IMAGE],
  cuts: [HERO_IMAGE, HERO_IMAGE, HERO_IMAGE, HERO_IMAGE, HERO_IMAGE, HERO_IMAGE],
};

const pipeline = ["Source", "Analyzing", "Hook found", "Building story", "Directing", "Final cut"];

const scores = [
  { label: "Hook", value: 98, entranceKey: "metricHook" },
  { label: "Retention", value: 91, entranceKey: "metricRetention" },
  { label: "Emotion", value: 87, entranceKey: "metricEmotion" },
  { label: "Clarity", value: 94, entranceKey: "metricClarity" },
  { label: "Payoff", value: 95, entranceKey: "metricPayoff" },
] as const;

const workflow = [
  { n: "01", title: "Find", copy: "Find the best moments." },
  { n: "02", title: "Shape", copy: "Build the story." },
  { n: "03", title: "Direct", copy: "Direct pace and style." },
  { n: "04", title: "Polish", copy: "Polish the result." },
  { n: "05", title: "Release", copy: "Ready for the feed." },
];

const moments = [
  { n: "01", title: "The contrarian take", score: 94 },
  { n: "02", title: "The breakthrough", score: 91 },
  { n: "03", title: "The unexpected answer", score: 89 },
];

const modes = [
  { name: "Auto", copy: "The Director chooses the approach." },
  { name: "Viral", copy: "Maximum retention." },
  { name: "Story", copy: "Story first." },
  { name: "Authority", copy: "Clean and authoritative." },
  { name: "Energy", copy: "Fast and expressive." },
  { name: "Cinematic", copy: "Atmosphere and rhythm." },
  { name: "Raw", copy: "Minimal intervention." },
];

const markers = ["Hook", "Context", "Peak", "Payoff", "Loop"];
const cutsGrid = ["Hook", "Context", "Peak", "Payoff", "Loop", "Alt cut"];

// ============================================================================
// ENTRANCE — coreografia di ingresso hero+director, portata da Figma
// (get_motion_context sul nodo 6:4, file 7SxZVLXI764peF6aPyUwbm).
// Figma la marca come loop infinito su una timeline di 3000ms; qui viene
// riprodotta UNA sola volta, quando la sezione entra in vista (un loop
// continuo di testo che scivola in scena ogni 3s sarebbe fastidioso su un
// sito vero). Delay/durate sono ricavati moltiplicando per 3000 i "times"
// restituiti da Figma; le curve (easeOut per l'opacità, [0.22,1,0.36,1]
// per i movimenti) sono le stesse del file sorgente.
// ============================================================================
type EntranceSpec = {
  fadeDelay: number;
  fadeDur: number;
  move?: { axis: "y" | "x" | "scale"; from: number; delay: number; duration: number };
};

const ENTRANCE = {
  eyebrow: { fadeDelay: 0, fadeDur: 360, move: { axis: "y", from: 30, delay: 0, duration: 600 } },
  bigTitle: { fadeDelay: 150, fadeDur: 420, move: { axis: "y", from: 50, delay: 150, duration: 700 } },
  description: { fadeDelay: 400, fadeDur: 360, move: { axis: "y", from: 30, delay: 400, duration: 600 } },
  directorEyebrow: { fadeDelay: 1300, fadeDur: 400, move: { axis: "y", from: 40, delay: 1300, duration: 550 } },
  scoreDisplay: { fadeDelay: 1500, fadeDur: 400, move: { axis: "scale", from: 0.85, delay: 1500, duration: 600 } },
  metricHook: { fadeDelay: 1400, fadeDur: 400, move: { axis: "x", from: -30, delay: 1400, duration: 500 } },
  metricRetention: { fadeDelay: 1500, fadeDur: 400, move: { axis: "x", from: -30, delay: 1500, duration: 500 } },
  metricEmotion: { fadeDelay: 1600, fadeDur: 400, move: { axis: "x", from: -30, delay: 1600, duration: 500 } },
  metricClarity: { fadeDelay: 1700, fadeDur: 400, move: { axis: "x", from: -30, delay: 1700, duration: 500 } },
  metricPayoff: { fadeDelay: 1800, fadeDur: 400, move: { axis: "x", from: -30, delay: 1800, duration: 500 } },
  directorsNote: { fadeDelay: 2000, fadeDur: 500, move: { axis: "y", from: 25, delay: 2000, duration: 600 } },
  storyArc: { fadeDelay: 2300, fadeDur: 500 },
} as const satisfies Record<string, EntranceSpec>;

// Prima che la sezione entri in vista: stato "0%" del keyframe, fermo (niente
// animazione ancora avviata, così non c'è nessun flash a piena opacità).
// Una volta "active", applica le due animazioni (fade + eventuale
// movimento) con i delay/durate/curve calcolati sopra, una sola volta
// (animation-fill-mode "both" mantiene lo stato finale).
function entranceStyle(spec: EntranceSpec, active: boolean): CSSProperties {
  if (!active) {
    const transform = !spec.move
      ? undefined
      : spec.move.axis === "scale"
        ? `scale(${spec.move.from})`
        : spec.move.axis === "y"
          ? `translateY(${spec.move.from}px)`
          : `translateX(${spec.move.from}px)`;
    return { opacity: 0, transform };
  }
  const animations = [`v-fade ${spec.fadeDur}ms cubic-bezier(0,0,0.58,1) ${spec.fadeDelay}ms both`];
  const vars: Record<string, string> = {};
  if (spec.move) {
    const keyframe =
      spec.move.axis === "y" ? "v-slide-y" : spec.move.axis === "x" ? "v-slide-x" : "v-scale-in";
    animations.push(`${keyframe} ${spec.move.duration}ms cubic-bezier(0.22,1,0.36,1) ${spec.move.delay}ms both`);
    vars["--v-from"] = spec.move.axis === "scale" ? `${spec.move.from}` : `${spec.move.from}px`;
  }
  return { animation: animations.join(", "), ...(vars as CSSProperties) };
}

function Media({
  asset,
  alt,
  className,
}: {
  asset: { src: string; video?: string };
  alt: string;
  className?: string;
}) {
  if (asset.video) {
    return (
      <video className={className} poster={asset.src} src={asset.video} autoPlay muted loop playsInline />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- img semplice per poter scambiare facilmente con <video>
  return <img src={asset.src} alt={alt} className={className} />;
}

// Variabili CSS della landing, applicate solo al wrapper di questa pagina.
const vantageVars = {
  "--v-bg": "#070707",
  "--v-surface": "#111111",
  "--v-surface-2": "#181818",
  "--v-fg": "#F5F3EE",
  "--v-fg-muted": "#969696",
  "--v-primary": "#FF2D95",
  "--v-accent": "#FF7A00",
  "--v-border": "rgba(245,243,238,0.12)",
  "--v-border-strong": "rgba(245,243,238,0.3)",
  "--v-font-sans": "'Archivo', sans-serif",
  "--v-font-mono": "'Space Mono', monospace",
  "--v-font-display": "'Instrument Serif', serif",
} as CSSProperties;

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pipelineScopeRef = useRef<HTMLDivElement>(null);
  const scoresRef = useRef<HTMLUListElement>(null);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [entrancePlayed, setEntrancePlayed] = useState(false);

  // Dropzone interattiva: upload reale (solo anteprima locale, via blob URL —
  // questa landing non carica nulla su alcun backend, è una demo) o "Carica
  // demo" con l'asset placeholder. isTransitioning pilota l'animazione di
  // uscita della dropzone prima di mostrare la vista "analisi".
  const [isDragging, setIsDragging] = useState(false);
  const [analysisActive, setAnalysisActive] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [sourceName, setSourceName] = useState("DEMO_SOURCE.MOV");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rilascia l'object URL creato per l'anteprima quando il componente si
  // smonta, oltre che ogni volta che ne viene creato uno nuovo (sotto).
  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cleanup all'unmount
  }, []);

  const startAnalysis = (file?: File) => {
    if (file && file.size > 2 * 1024 * 1024 * 1024) {
      setUploadError("File too large. Maximum size is 2GB.");
      return;
    }
    if (file && !file.type.startsWith("video/")) {
      setUploadError("Choose an MP4 or MOV video file.");
      return;
    }

    setUploadError("");
    if (file) {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setSourceUrl(URL.createObjectURL(file));
      setSourceName(file.name);
    } else {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setSourceUrl(null);
      setSourceName("DEMO_SOURCE.MOV");
    }
    setIsTransitioning(true);
    window.setTimeout(() => {
      setAnalysisActive(true);
      setIsTransitioning(false);
    }, 420);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) startAnalysis(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) startAnalysis(file);
  };

  // La coreografia di ingresso (hero+director) parte una sola volta, non
  // appena la sezione inizia a entrare in vista.
  useEffect(() => {
    const el = pipelineScopeRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setEntrancePlayed(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Le score bar si riempiono una sola volta, quando entrano in vista.
  useEffect(() => {
    const el = scoresRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setScoresRevealed(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div style={vantageVars} className="v-scope min-h-screen overflow-hidden bg-[var(--v-bg)] text-[var(--v-fg)]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Instrument+Serif:ital@0;1&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .v-scope { font-family: var(--v-font-sans); }
        .v-scope .v-mono { font-family: var(--v-font-mono); }
        .v-scope .v-display { font-family: var(--v-font-display); }

        @keyframes v-scan { 0% { transform: translateX(-110%); opacity: 0; } 18%,82% { opacity: .9; } 100% { transform: translateX(410%); opacity: 0; } }
        @keyframes v-pulse { 0%,100% { opacity:.35; transform:scale(.85);} 50% { opacity:1; transform:scale(1);} }
        @keyframes v-shift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes v-reveal { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes v-tag-in { to { opacity: 1; } }
        @keyframes v-drift { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

        /* Coreografia di ingresso hero+director (da Figma, vedi ENTRANCE) */
        @keyframes v-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes v-slide-y { from { transform: translateY(var(--v-from, 0)); } to { transform: translateY(0); } }
        @keyframes v-slide-x { from { transform: translateX(var(--v-from, 0)); } to { transform: translateX(0); } }
        @keyframes v-scale-in { from { transform: scale(var(--v-from, 1)); } to { transform: scale(1); } }

        /* Headline parola-per-parola + dropzone interattiva + vista analisi */
        @keyframes v-headline-word-reveal { from { opacity: 0; transform: translate3d(0, 0.42em, 0) rotateX(-14deg); } to { opacity: 1; transform: translate3d(0, 0, 0) rotateX(0); } }
        @keyframes v-vertical-scan { 0% { transform: translateY(-1px); opacity: 0; } 15%,85% { opacity: .85; } 100% { transform: translateY(340px); opacity: 0; } }
        @keyframes v-upload-exit { from { opacity: 1; transform: translate3d(0,0,0) scale(1); } to { opacity: 0; transform: translate3d(0,-8px,0) scale(.985); } }
        @keyframes v-analysis-enter { from { opacity: 0; transform: translate3d(0,16px,0) scale(.985); } to { opacity: 1; transform: translate3d(0,0,0) scale(1); } }
        @keyframes v-analysis-piece-enter { from { opacity: 0; transform: translate3d(var(--v-piece-x, 0), 12px, 0) scale(.985); } to { opacity: 1; transform: translate3d(0,0,0) scale(1); } }

        .v-scope .v-headline-word { transform-origin: 50% 100%; backface-visibility: hidden; animation: v-headline-word-reveal .95s cubic-bezier(.16,1,.3,1) both; animation-delay: var(--v-word-delay, 0ms); }
        .v-scope .v-vertical-scan { animation: v-vertical-scan 4.2s cubic-bezier(.4,0,.2,1) infinite; box-shadow: 0 0 22px var(--v-primary); }
        .v-scope .v-upload-exit { animation: v-upload-exit .42s cubic-bezier(.4,0,.2,1) both; will-change: transform, opacity; }
        .v-scope .v-analysis-enter { animation: v-analysis-enter .8s cubic-bezier(.16,1,.3,1) both; will-change: transform, opacity; }
        .v-scope .v-analysis-source-enter { --v-piece-x: -12px; animation: v-analysis-piece-enter .75s .08s cubic-bezier(.16,1,.3,1) both; }
        .v-scope .v-analysis-connector-enter { animation: v-analysis-piece-enter .65s .22s cubic-bezier(.16,1,.3,1) both; }
        .v-scope .v-analysis-short-enter { --v-piece-x: 12px; animation: v-analysis-piece-enter .75s .3s cubic-bezier(.16,1,.3,1) both; }
        .v-scope .v-analysis-pipeline-enter { animation: v-analysis-piece-enter .7s .42s cubic-bezier(.16,1,.3,1) both; }
        .v-scope .v-upload-grid {
          background-image: linear-gradient(var(--v-border) 1px, transparent 1px), linear-gradient(90deg, var(--v-border) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: radial-gradient(circle at center, black, transparent 78%);
        }
        .v-scope .v-upload-zone {
          box-shadow: inset 0 0 55px color-mix(in oklab, var(--v-bg) 65%, transparent);
          will-change: transform, opacity;
        }
        .v-scope .v-upload-zone::after {
          content: ""; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none;
          background: linear-gradient(115deg, transparent 20%, var(--v-primary), var(--v-accent), transparent 80%) border-box;
          border: 1px solid transparent;
          mask: linear-gradient(black 0 0) padding-box, linear-gradient(black 0 0);
          mask-composite: exclude;
          opacity: 0.18;
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .v-scope .v-upload-zone:hover::after, .v-scope .v-upload-zone[data-dragging="true"]::after { opacity: 0.62; }
        .v-scope .v-upload-zone[data-dragging="true"] {
          transform: scale(1.01);
          box-shadow: 0 0 42px color-mix(in oklab, var(--v-primary) 18%, transparent), inset 0 0 55px color-mix(in oklab, var(--v-primary) 6%, transparent);
        }
        .v-scope .v-cinematic-shimmer { position: relative; isolation: isolate; }
        .v-scope .v-cinematic-shimmer::after {
          content: attr(data-text); position: absolute; inset: 0;
          background-image: linear-gradient(100deg, transparent 36%, color-mix(in oklab, var(--v-fg) 72%, transparent) 50%, transparent 64%);
          background-clip: text; -webkit-background-clip: text; color: transparent; pointer-events: none; opacity: 0;
          animation: v-shift 7.5s 1.4s cubic-bezier(0.45, 0, 0.25, 1) infinite;
          will-change: transform, opacity;
        }

        .v-scope .v-scan-el { animation: v-scan 5.5s linear infinite; }
        .v-scope .v-pulse-el { animation: v-pulse 2.8s ease-in-out infinite; }
        .v-scope .v-reveal-el { opacity: 0; animation: v-reveal .7s cubic-bezier(.22,1,.36,1) both; animation-delay: var(--v-delay, 0ms); }
        .v-scope .v-gradient-word {
          background-image: linear-gradient(100deg, var(--v-primary), var(--v-accent), var(--v-primary));
          background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
          animation: v-shift 9s ease-in-out infinite;
        }
        .v-scope .v-tag-el {
          opacity: 0;
          animation: v-tag-in .9s cubic-bezier(.22,1,.36,1) forwards, v-drift 6s ease-in-out infinite;
          animation-delay: var(--v-delay, 0ms), var(--v-delay, 0ms);
        }
        .v-scope .v-gradient-tab { position: relative; }
        .v-scope .v-gradient-tab::after {
          content: ""; position: absolute; inset-inline: 0; bottom: -6px; height: 1px;
          background-image: linear-gradient(90deg, var(--v-primary), var(--v-accent));
          transform: scaleX(0); transform-origin: left; transition: transform .35s ease;
        }
        .v-scope .v-gradient-tab:hover::after, .v-scope .v-gradient-tab[data-active="true"]::after { transform: scaleX(1); }

        @media (prefers-reduced-motion: reduce) {
          .v-scope .v-scan-el, .v-scope .v-pulse-el, .v-scope .v-reveal-el, .v-scope .v-gradient-word,
          .v-scope .v-tag-el, .v-scope .v-anim, .v-scope .v-headline-word, .v-scope .v-vertical-scan,
          .v-scope .v-upload-exit, .v-scope .v-analysis-enter, .v-scope .v-analysis-source-enter,
          .v-scope .v-analysis-connector-enter, .v-scope .v-analysis-short-enter, .v-scope .v-analysis-pipeline-enter,
          .v-scope .v-cinematic-shimmer::after {
            animation: none !important; opacity: 1 !important; transform: none !important;
          }
        }
      `}</style>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--v-border)] bg-[var(--v-bg)]/85 px-4 backdrop-blur-md sm:px-7">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5 text-[var(--v-primary)]">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="font-black uppercase tracking-tight">Vantage</span>
          <span className="v-mono hidden text-[10px] uppercase text-[var(--v-fg-muted)] sm:inline">/ Director</span>
        </div>
        <nav
          aria-label="Primary navigation"
          className="v-mono hidden items-center gap-7 text-[10px] uppercase tracking-[0.14em] text-[var(--v-fg-muted)] lg:flex"
        >
          <a className="v-gradient-tab text-[var(--v-fg)]" data-active="true" href="#studio">01 Studio</a>
          <a className="v-gradient-tab hover:text-[var(--v-fg)]" href="#director">02 Director</a>
          <a className="v-gradient-tab hover:text-[var(--v-fg)]" href="#workflow">03 Workflow</a>
          <a className="v-gradient-tab hover:text-[var(--v-fg)]" href="#moments">04 Moments</a>
          <a className="v-gradient-tab hover:text-[var(--v-fg)]" href="#modes">05 Modes</a>
        </nav>
        <div className="v-mono flex items-center gap-3 text-[9px] uppercase text-[var(--v-fg-muted)]">
          <span className="v-pulse-el size-1.5 rounded-full bg-[var(--v-accent)]" />
          <span className="hidden sm:inline">Director online</span>
          <Link
            href="/app"
            className="hidden rounded-full border border-[var(--v-border-strong)] px-4 py-2 text-[10px] uppercase tracking-[0.14em] text-[var(--v-fg)] transition-all hover:border-transparent hover:bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] hover:text-[#0a0a0a] sm:inline-flex"
          >
            Start a project
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex size-9 items-center justify-center rounded-full border border-[var(--v-border)] text-[var(--v-fg)] transition-all hover:border-transparent hover:bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] hover:text-[#0a0a0a] lg:hidden"
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="v-mono fixed inset-x-0 top-16 z-20 flex flex-col border-b border-[var(--v-border)] bg-[var(--v-bg)] px-4 py-2 text-sm uppercase tracking-[0.14em] lg:hidden">
          {[
            ["#studio", "01 Studio"],
            ["#director", "02 Director"],
            ["#workflow", "03 Workflow"],
            ["#moments", "04 Moments"],
            ["#modes", "05 Modes"],
          ].map(([href, label]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)} className="border-b border-[var(--v-border)] py-3">
              {label}
            </a>
          ))}
          <Link href="/app" onClick={() => setMenuOpen(false)} className="py-3 text-[var(--v-primary)]">
            Start a project →
          </Link>
        </div>
      )}

      {/* HERO — source video becomes a vertical short */}
      <div ref={pipelineScopeRef}>
        <section id="studio" className="mx-auto min-h-[calc(100svh-4rem)] max-w-[1600px] px-4 pb-14 pt-10 sm:px-7 lg:px-10 lg:pt-14">
          <div className="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
            <div className="relative z-10">
              <p
                className="v-anim v-mono text-[10px] uppercase tracking-[0.28em] text-[var(--v-primary)]"
                style={entranceStyle(ENTRANCE.eyebrow, entrancePlayed)}
              >
                AI video director / studio 01
              </p>
              <h1 className="mt-6 uppercase leading-[0.82]" aria-label="Find the moment.">
                <span className="block text-5xl font-black sm:text-7xl lg:text-[6.4rem]" aria-hidden="true">
                  {["Find", "the"].map((word, index) => (
                    <span
                      key={word}
                      className="v-headline-word mr-[0.22em] inline-block last:mr-0"
                      style={{ "--v-word-delay": `${index * 75}ms` } as CSSProperties}
                    >
                      {word}
                    </span>
                  ))}
                </span>
                <span className="mt-1 block text-6xl font-black sm:text-8xl lg:text-[7.6rem]" aria-hidden="true">
                  <span
                    className="v-gradient-word v-cinematic-shimmer v-headline-word inline-block"
                    data-text="moment."
                    style={{ "--v-word-delay": "230ms" } as CSSProperties}
                  >
                    moment.
                  </span>
                </span>
              </h1>
              <p
                className="v-anim mt-8 max-w-lg text-sm leading-relaxed text-[var(--v-fg-muted)] sm:text-base"
                style={entranceStyle(ENTRANCE.description, entrancePlayed)}
              >
                Upload a long video. The Director watches it, finds the best moments and builds the Shorts.
              </p>
              <div className="v-mono mt-8 flex items-center gap-3 text-[9px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                <span className="h-px w-14 bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)]" />
                {analysisActive ? "The director is watching" : "Ready for source"}
              </div>
            </div>

            <div className="relative min-h-[420px] sm:min-h-[500px]">
              <div className="absolute -inset-8 -z-10 bg-[radial-gradient(circle_at_50%_45%,rgba(255,45,149,0.16),transparent_62%)]" />
              {!analysisActive ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload a video by dragging it here or selecting a file"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
                  }}
                  onDrop={handleDrop}
                  data-dragging={isDragging}
                  className={`v-upload-zone group relative flex min-h-[420px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-[var(--v-border)] bg-[var(--v-surface)]/65 px-6 text-center backdrop-blur-md transition-[transform,opacity,border-color] duration-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--v-primary)] data-[dragging=true]:border-[var(--v-primary)] sm:min-h-[500px] ${isTransitioning ? "v-upload-exit pointer-events-none" : ""}`}
                >
                  <div className="v-upload-grid absolute inset-0 opacity-50 transition-opacity duration-500 group-hover:opacity-80" />
                  <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
                    <div className="v-scan-el h-full w-1/3 bg-gradient-to-r from-transparent via-[var(--v-primary)] to-[var(--v-accent)]" />
                  </div>
                  <div className="relative flex size-20 items-center justify-center rounded-full border border-[var(--v-primary)]/35 bg-[var(--v-bg)]/60 shadow-[0_0_40px_rgba(255,45,149,0.24)] transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-105">
                    <UploadCloud className="size-8 text-[var(--v-primary)] transition-colors group-hover:text-[var(--v-accent)]" />
                    <span className="v-pulse-el absolute inset-2 -z-10 rounded-full bg-[var(--v-primary)]/15" />
                  </div>
                  <p className="relative mt-7 text-2xl font-black uppercase">Drop your footage</p>
                  <p className="v-mono relative mt-3 text-[9px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                    Drag &amp; drop / MP4, MOV &bull; max 2GB
                  </p>
                  <div className="relative mt-8 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="inline-flex items-center gap-2 rounded-none border border-[var(--v-primary)]/50 bg-transparent px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--v-primary)] shadow-[0_0_28px_rgba(255,45,149,0.24)] transition-all hover:border-transparent hover:bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] hover:text-[#0a0a0a]"
                    >
                      <Film size={14} /> Upload video
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        startAnalysis();
                      }}
                      className="v-mono inline-flex items-center gap-2 rounded-none border border-[var(--v-border-strong)] bg-transparent px-6 py-2.5 text-[10px] uppercase tracking-[0.16em] text-[var(--v-fg)] transition-all hover:border-transparent hover:bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] hover:text-[#0a0a0a]"
                    >
                      <WandSparkles size={14} /> Try a demo
                    </button>
                  </div>
                  {uploadError && <p className="relative mt-5 text-xs text-[var(--v-primary)]">{uploadError}</p>}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/*"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                  <span className="v-mono absolute left-4 top-4 text-[8px] uppercase tracking-[0.18em] text-[var(--v-fg-muted)]">
                    Input / waiting
                  </span>
                  <span className="v-mono absolute bottom-4 right-4 text-[8px] uppercase tracking-[0.18em] text-[var(--v-fg-muted)]">
                    Secure local preview
                  </span>
                </div>
              ) : (
                <div className="v-analysis-enter pt-3">
                  <div className="v-mono mb-5 flex items-center justify-between border-b border-[var(--v-border)] pb-4 text-[9px] uppercase tracking-[0.16em] text-[var(--v-fg-muted)]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="v-pulse-el size-1.5 shrink-0 rounded-full bg-[var(--v-primary)]" />
                      <span className="truncate">Live / {sourceName}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAnalysisActive(false)}
                      className="text-[9px] uppercase tracking-[0.16em] text-[var(--v-fg-muted)] transition-colors hover:text-[var(--v-fg)]"
                    >
                      New source
                    </button>
                  </div>
                  <div className="grid items-center gap-5 sm:grid-cols-[1.75fr_auto_0.62fr]">
                    <figure className="v-analysis-source-enter">
                      <div className="relative aspect-video overflow-hidden rounded-lg border border-[var(--v-border)] bg-[var(--v-surface)] p-[1.5px]">
                        <div className="relative h-full overflow-hidden rounded-[7px] bg-[var(--v-surface)]">
                          {sourceUrl ? (
                            <video src={sourceUrl} className="h-full w-full object-cover" autoPlay muted loop playsInline />
                          ) : (
                            <Media asset={ASSETS.hero} alt="Director reviewing long-form footage" className="h-full w-full object-cover" />
                          )}
                          <div className="v-vertical-scan absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--v-primary)] to-[var(--v-accent)]" />
                          <div className="v-mono absolute left-3 top-3 rounded-full border border-[var(--v-border-strong)] bg-[var(--v-bg)]/75 px-3 py-1 text-[8px] uppercase tracking-[0.16em] backdrop-blur-sm">
                            Source / analyzing
                          </div>
                          <div className="v-mono absolute bottom-3 right-3 text-[8px] uppercase text-[var(--v-fg)]/70">00:42:17 / 00:58:00</div>
                        </div>
                        <div className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-br from-[var(--v-primary)] via-[var(--v-primary)]/30 to-[var(--v-accent)] opacity-40" />
                      </div>
                      <figcaption className="v-mono mt-3 text-[8px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                        Original footage
                      </figcaption>
                    </figure>
                    <div className="v-analysis-connector-enter hidden flex-col items-center gap-2 sm:flex">
                      <span className="h-8 w-px bg-gradient-to-b from-transparent to-[var(--v-primary)]" />
                      <ArrowRight className="size-4 text-[var(--v-accent)]" />
                      <span className="h-8 w-px bg-gradient-to-t from-transparent to-[var(--v-accent)]" />
                    </div>
                    <figure className="v-analysis-short-enter mx-auto w-36 sm:w-full">
                      <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-[var(--v-primary)]/45 bg-[var(--v-surface)]">
                        {sourceUrl ? (
                          <video src={sourceUrl} className="h-full w-full object-cover" autoPlay muted loop playsInline />
                        ) : (
                          <Media
                            asset={ASSETS.finalCut}
                            alt="Vertical short preview"
                            className="h-full w-full scale-[1.6] object-cover object-[62%_38%]"
                          />
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[var(--v-bg)] to-transparent" />
                        <div className="v-mono absolute left-2 top-2 rounded-full border border-[var(--v-border-strong)] bg-[var(--v-bg)]/75 px-2 py-0.5 text-[7px] uppercase">
                          Final cut
                        </div>
                        <div className="v-mono absolute bottom-3 left-2 text-[7px] uppercase text-[var(--v-fg)]/80">
                          <span className="v-gradient-word font-sans text-xl font-black">94</span> Attention
                        </div>
                      </div>
                      <figcaption className="v-mono mt-3 text-[8px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                        Vertical short
                      </figcaption>
                    </figure>
                  </div>
                  <ul className="v-analysis-pipeline-enter v-mono mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--v-border)] pt-4 text-[8px] uppercase tracking-[0.16em] text-[var(--v-fg-muted)]">
                    {pipeline.map((step, index) => (
                      <li key={step} className={`flex items-center gap-2 ${index === 2 ? "text-[var(--v-fg)]" : ""}`}>
                        <span className={`size-1 rounded-full ${index <= 2 ? "bg-[var(--v-primary)]" : "bg-[var(--v-fg-muted)]/40"}`} />
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* THE DIRECTOR */}
        <section id="director" className="mx-auto max-w-[1600px] px-4 py-16 sm:px-7 lg:px-10">
          <div className="grid gap-12 border-t border-[var(--v-border)] pt-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              {/* Eyebrow + titolo animano insieme, come un unico blocco in Figma (director-eyebrow) */}
              <div className="v-anim" style={entranceStyle(ENTRANCE.directorEyebrow, entrancePlayed)}>
                <p className="v-mono text-[10px] uppercase tracking-[0.28em] text-[var(--v-primary)]">The director</p>
                <h2 className="mt-4 text-4xl font-black uppercase leading-[0.86] tracking-[-0.02em] sm:text-6xl">
                  The director<br />
                  <span className="v-display text-[0.88em] font-normal normal-case italic tracking-tight">is</span>{" "}
                  <span className="v-gradient-word">watching.</span>
                </h2>
              </div>
              <div
                className="v-anim mt-10 flex items-end gap-6"
                style={entranceStyle(ENTRANCE.scoreDisplay, entrancePlayed)}
              >
                <div>
                  <p className="v-mono text-[10px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">Attention</p>
                  <p className="v-gradient-word mt-2 text-[6rem] font-black leading-none tracking-[-0.04em] sm:text-[8rem]">94</p>
                </div>
                <div className="mb-4 h-16 w-px bg-[var(--v-border)]" />
                <p className="v-mono mb-4 max-w-[13rem] text-[9px] uppercase leading-relaxed tracking-[0.16em] text-[var(--v-fg-muted)]">
                  Composite signal across hook, retention, emotion, clarity, payoff
                </p>
              </div>
            </div>

            <div className="lg:pl-10">
              <ul ref={scoresRef} className="divide-y divide-[var(--v-border)] border-y border-[var(--v-border)]">
                {scores.map((s) => (
                  <li
                    key={s.label}
                    className="v-anim flex items-center gap-5 py-4"
                    style={entranceStyle(ENTRANCE[s.entranceKey], entrancePlayed)}
                  >
                    <span className="v-mono w-24 text-[10px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                      {s.label}
                    </span>
                    <span className="relative h-px flex-1 bg-[var(--v-border)]">
                      <span
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)] transition-[width] duration-1000 ease-out"
                        style={{ width: scoresRevealed ? `${s.value}%` : "0%" }}
                      />
                    </span>
                    <span className="w-12 text-right text-2xl font-black tabular-nums">{s.value}</span>
                  </li>
                ))}
              </ul>

              <figure
                className="v-anim mt-8 border-l border-[var(--v-primary)]/50 pl-5"
                style={entranceStyle(ENTRANCE.directorsNote, entrancePlayed)}
              >
                <figcaption className="v-mono text-[10px] uppercase tracking-[0.2em] text-[var(--v-primary)]">
                  Director&rsquo;s note
                </figcaption>
                <blockquote className="v-display mt-3 text-2xl italic leading-snug sm:text-3xl">
                  &ldquo;Strong opening. High curiosity. Clear payoff.&rdquo;
                </blockquote>
              </figure>

              <div
                className="v-anim mt-10 border-t border-[var(--v-border)] pt-6"
                style={entranceStyle(ENTRANCE.storyArc, entrancePlayed)}
              >
                <div className="relative h-px bg-[var(--v-border)]">
                  <div className="absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)]" />
                  {[8, 28, 47, 69, 90].map((pos, i) => (
                    <span
                      key={pos}
                      className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${i === 2 ? "bg-[var(--v-accent)]" : "bg-[var(--v-fg)]"}`}
                      style={{ left: `${pos}%` }}
                    />
                  ))}
                </div>
                <div className="v-mono mt-4 grid grid-cols-5 text-[8px] uppercase tracking-[0.16em] text-[var(--v-fg-muted)] sm:text-[10px]">
                  {markers.map((marker, index) => (
                    <span key={marker} className={index === 2 ? "text-[var(--v-accent)]" : ""}>
                      {marker}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* WORKFLOW */}
      <section id="workflow" className="mx-auto max-w-[1600px] px-4 py-16 sm:px-7 lg:px-10">
        <div className="border-t border-[var(--v-border)] pt-10">
          <p className="v-mono text-[10px] uppercase tracking-[0.28em] text-[var(--v-fg-muted)]">Workflow</p>
          <ol className="mt-8 divide-y divide-[var(--v-border)]">
            {workflow.map((step) => (
              <li
                key={step.n}
                className="group grid grid-cols-[3rem_1fr] items-baseline gap-x-6 gap-y-2 py-7 sm:grid-cols-[5rem_1fr_1.1fr]"
              >
                <span className="v-mono text-[11px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)] transition-colors group-hover:text-[var(--v-primary)]">
                  {step.n}
                </span>
                <h3 className="text-3xl font-black uppercase tracking-[-0.02em] sm:text-5xl">{step.title}</h3>
                <p className="col-start-2 text-sm text-[var(--v-fg-muted)] sm:col-start-3 sm:text-right">{step.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ONE VIDEO. MULTIPLE MOMENTS. */}
      <section id="moments" className="mx-auto max-w-[1600px] px-4 py-16 sm:px-7 lg:px-10">
        <div className="border-t border-[var(--v-border)] pt-10">
          <h2 className="text-4xl font-black uppercase leading-[0.86] tracking-[-0.02em] sm:text-7xl">
            One video.<br />
            <span className="v-gradient-word">Multiple moments.</span>
          </h2>

          <div className="mt-12 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
            <figure className="relative">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-[var(--v-border)]">
                <Media
                  asset={ASSETS.moments}
                  alt="Original long-form video being split into multiple short cuts"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--v-bg)]/80 via-transparent to-transparent" />
                <div className="v-mono absolute bottom-4 left-4 text-[9px] uppercase tracking-[0.2em] text-[var(--v-fg)]/80">
                  Source / 3 moments detected
                </div>
              </div>
            </figure>

            <ol className="divide-y divide-[var(--v-border)] border-y border-[var(--v-border)]">
              {moments.map((m, i) => (
                <li key={m.n} className="group flex items-center gap-5 py-6">
                  <span className="v-mono text-[10px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">{m.n}</span>
                  <div className="relative h-14 w-8 shrink-0 overflow-hidden rounded-sm border border-[var(--v-border)]">
                    <Media
                      asset={{ src: ASSETS.momentThumbs[i] ?? HERO_IMAGE }}
                      alt=""
                      className="h-full w-full scale-[1.8] object-cover"
                    />
                  </div>
                  <h3 className="flex-1 text-lg font-black uppercase leading-tight tracking-[-0.01em] transition-colors group-hover:text-[var(--v-primary)] sm:text-2xl">
                    {m.title}
                  </h3>
                  <div className="text-right">
                    <span className="text-3xl font-black tabular-nums">{m.score}</span>
                    <span className="v-mono ml-2 text-[9px] uppercase text-[var(--v-fg-muted)]">att</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* THE CUTS */}
      <section id="cuts" className="mx-auto max-w-[1600px] px-4 py-16 sm:px-7 lg:px-10">
        <div className="border-t border-[var(--v-border)] pt-10">
          <p className="v-mono text-[10px] uppercase tracking-[0.28em] text-[var(--v-fg-muted)]">The cuts</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-[0.88] tracking-[-0.02em] sm:text-6xl">
            Six versions.<br />One upload.
          </h2>
          <div className="mt-9 grid grid-cols-3 gap-[3px] sm:grid-cols-6">
            {cutsGrid.map((label, i) => (
              <figure key={label} className="group relative aspect-[3/4] overflow-hidden bg-[var(--v-surface)]">
                <Media
                  asset={{ src: ASSETS.cuts[i] ?? HERO_IMAGE }}
                  alt=""
                  className="h-full w-full object-cover saturate-90 transition-transform duration-500 ease-out group-hover:scale-105"
                />
                <figcaption className="v-mono absolute bottom-2 left-2 text-[8px] uppercase tracking-[0.1em] text-[var(--v-fg)]/85">
                  {String(i + 1).padStart(2, "0")} / {label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* DIRECTING MODES */}
      <section id="modes" className="mx-auto max-w-[1600px] px-4 py-16 sm:px-7 lg:px-10">
        <div className="border-t border-[var(--v-border)] pt-10">
          <p className="v-mono text-[10px] uppercase tracking-[0.28em] text-[var(--v-fg-muted)]">Directing modes</p>
          <ul className="mt-8 grid gap-x-12 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {modes.map((mode, index) => (
              <li key={mode.name} className="border-t border-[var(--v-border)] pt-4">
                <button
                  type="button"
                  data-active={index === 0}
                  className="v-gradient-tab v-mono text-[11px] uppercase tracking-[0.24em] text-[var(--v-fg-muted)] transition-colors hover:text-[var(--v-fg)] data-[active=true]:text-[var(--v-fg)]"
                >
                  {mode.name}
                </button>
                <p className="mt-3 text-sm text-[var(--v-fg-muted)]">{mode.copy}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FUTURE WORKFLOW */}
      <section className="mx-auto max-w-[1600px] px-4 py-16 sm:px-7 lg:px-10">
        <div className="border-t border-[var(--v-border)] pt-10">
          <div className="v-mono flex flex-wrap items-center gap-x-4 gap-y-3 text-[10px] uppercase tracking-[0.24em] text-[var(--v-fg-muted)]">
            <span className="text-[var(--v-fg)]">Vantage</span>
            <span className="text-[var(--v-accent)]">→</span>
            <span>First cut</span>
            <span className="text-[var(--v-accent)]">→</span>
            <span>Premiere Pro</span>
            <span className="text-[var(--v-accent)]">→</span>
            <span>Final edit</span>
          </div>
          <h2 className="mt-7 max-w-3xl text-3xl font-black uppercase leading-[0.9] tracking-[-0.02em] sm:text-5xl">
            AI does the first cut.<br />
            <span className="v-display text-[0.92em] font-normal normal-case italic tracking-tight">you make the</span>{" "}
            <span className="v-gradient-word">final call.</span>
          </h2>
        </div>
      </section>

      {/* NEXT PROJECT */}
      <section className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-7 lg:px-10">
        <div className="relative border-t border-[var(--v-fg)]/30 pt-9">
          <div className="absolute left-0 top-0 h-1 w-32 bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)] sm:w-56" />
          <div className="flex flex-col items-start justify-between gap-7 sm:flex-row sm:items-end">
            <div>
              <p className="v-mono text-[10px] uppercase tracking-[0.24em] text-[var(--v-fg-muted)]">Next project</p>
              <h2 className="mt-3 text-4xl font-black uppercase leading-[0.88] tracking-[-0.02em] sm:text-6xl">
                Create something<br />worth watching.
              </h2>
              <p className="mt-5 flex items-center gap-3 text-sm text-[var(--v-fg-muted)]">
                <Sparkles className="size-4 text-[var(--v-accent)]" /> The Director starts working as soon as you upload the video.
              </p>
            </div>
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-none border border-[var(--v-primary)]/50 bg-transparent px-8 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--v-primary)] shadow-[0_0_28px_rgba(255,45,149,0.24)] transition-all hover:border-transparent hover:bg-[linear-gradient(90deg,var(--v-primary),var(--v-accent))] hover:text-[#0a0a0a]"
            >
              <Plus size={16} /> Create new project
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
