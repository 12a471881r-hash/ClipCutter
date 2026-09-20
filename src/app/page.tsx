"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Menu, Plus, Sparkles, X } from "lucide-react";

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
const pipelineEntranceKeys = ["step0", "step1", "step2", "step3", "step4", "step5"] as const;

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

const heroTags: { label: string; className: string; delay: string; hideOnSmall?: boolean }[] = [
  { label: "Hook / detected", className: "left-[6%] top-[18%]", delay: "500ms" },
  { label: "Peak / reviewing", className: "right-[8%] top-[38%]", delay: "1100ms", hideOnSmall: true },
  { label: "Retention / pending", className: "bottom-[20%] left-[10%]", delay: "1700ms", hideOnSmall: true },
];

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
  centerPlayer: { fadeDelay: 250, fadeDur: 450, move: { axis: "scale", from: 0.92, delay: 250, duration: 600 } },
  rightShort: { fadeDelay: 450, fadeDur: 450, move: { axis: "x", from: 40, delay: 450, duration: 550 } },
  pipelineDivider: { fadeDelay: 900, fadeDur: 400 },
  step0: { fadeDelay: 1000, fadeDur: 350, move: { axis: "y", from: 12, delay: 1000, duration: 400 } },
  step1: { fadeDelay: 1080, fadeDur: 350, move: { axis: "y", from: 12, delay: 1080, duration: 400 } },
  step2: { fadeDelay: 1160, fadeDur: 350, move: { axis: "y", from: 12, delay: 1160, duration: 400 } },
  step3: { fadeDelay: 1240, fadeDur: 350, move: { axis: "y", from: 12, delay: 1240, duration: 400 } },
  step4: { fadeDelay: 1320, fadeDur: 350, move: { axis: "y", from: 12, delay: 1320, duration: 400 } },
  step5: { fadeDelay: 1400, fadeDur: 350, move: { axis: "y", from: 12, delay: 1400, duration: 400 } },
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
  const [activeStep, setActiveStep] = useState(2);
  const scoresRef = useRef<HTMLUListElement>(null);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [entrancePlayed, setEntrancePlayed] = useState(false);

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

  // La pipeline (Source → ... → Final cut) avanza con lo scroll attraverso
  // hero + director.
  useEffect(() => {
    const el = pipelineScopeRef.current;
    if (!el) return;
    let ticking = false;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height + vh * 0.5;
      const passed = vh - rect.top;
      const progress = Math.min(1, Math.max(0, passed / total));
      setActiveStep(Math.min(pipeline.length - 1, Math.floor(progress * pipeline.length)));
    };
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          update();
          ticking = false;
        });
        ticking = true;
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
    };
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
          .v-scope .v-tag-el, .v-scope .v-anim {
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
        <section id="studio" className="mx-auto max-w-[1600px] px-4 pb-16 pt-10 sm:px-7 lg:px-10 lg:pt-16">
          <div className="grid items-end gap-10 lg:grid-cols-[0.62fr_1.9fr]">
            <div className="relative z-10 lg:pb-12">
              <p
                className="v-anim v-mono text-[10px] uppercase tracking-[0.28em] text-[var(--v-primary)]"
                style={entranceStyle(ENTRANCE.eyebrow, entrancePlayed)}
              >
                Live analysis / source 01
              </p>
              <h1
                className="v-anim mt-6 text-6xl font-black uppercase leading-[0.8] tracking-[-0.02em] sm:text-8xl lg:text-[7.5rem]"
                style={entranceStyle(ENTRANCE.bigTitle, entrancePlayed)}
              >
                Find<br />
                <span className="v-display text-[0.78em] font-normal normal-case italic tracking-tight">the</span>
                <br />
                <span className="v-gradient-word">moment.</span>
              </h1>
              {/* Copy + tag animano insieme, come un unico blocco in Figma (description-box) */}
              <p
                className="v-anim mt-8 max-w-xs text-sm leading-relaxed text-[var(--v-fg-muted)]"
                style={entranceStyle(ENTRANCE.description, entrancePlayed)}
              >
                Upload a long video. The Director watches it, finds the best moments and builds the Shorts.
              </p>
              <div
                className="v-anim mt-8 flex items-center gap-3"
                style={entranceStyle(ENTRANCE.description, entrancePlayed)}
              >
                <span className="h-px w-14 bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)]" />
                <span className="v-mono text-[10px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                  The director is watching
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-10 -z-10 bg-[radial-gradient(circle_at_62%_40%,rgba(255,45,149,0.16),transparent_60%)]" />
              <div className="grid items-center gap-6 lg:grid-cols-[1.75fr_auto_0.62fr]">
                {/* Source */}
                <figure className="v-anim relative" style={entranceStyle(ENTRANCE.centerPlayer, entrancePlayed)}>
                  <div className="relative aspect-video overflow-hidden rounded-lg border border-[var(--v-border)] bg-[var(--v-surface)] p-[1.5px]">
                    <div className="relative h-full overflow-hidden rounded-[7px] bg-[var(--v-surface)]">
                      <Media
                        asset={ASSETS.hero}
                        alt="Director reviewing long-form footage in a dark editing studio"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
                        <div className="v-scan-el h-full w-1/3 bg-gradient-to-r from-transparent via-[var(--v-primary)] to-[var(--v-accent)]" />
                      </div>
                      <div className="v-mono absolute left-3 top-3 flex items-center gap-2 rounded-full border border-[var(--v-border-strong)] bg-[var(--v-bg)]/75 py-1 pl-2.5 pr-3 text-[9px] uppercase tracking-[0.16em] backdrop-blur-sm">
                        <span className="v-pulse-el size-1.5 rounded-full bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)]" />
                        source / 58:00
                      </div>
                      <div className="v-mono absolute bottom-3 right-3 text-[9px] uppercase text-[var(--v-fg)]/70">
                        00:42:17 / 00:58:00
                      </div>
                      {heroTags.map((tag) => (
                        <span
                          key={tag.label}
                          className={`v-tag-el v-mono pointer-events-none absolute flex items-center gap-1.5 rounded-full border border-[var(--v-border-strong)] bg-[var(--v-bg)]/70 px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] backdrop-blur-sm ${tag.className} ${tag.hideOnSmall ? "hidden sm:flex" : ""}`}
                          style={{ "--v-delay": tag.delay } as CSSProperties}
                        >
                          <span className="size-1 rounded-full bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)]" />
                          {tag.label}
                        </span>
                      ))}
                    </div>
                    <div className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-br from-[var(--v-primary)] via-[var(--v-primary)]/30 to-[var(--v-accent)] opacity-40" />
                  </div>
                  <figcaption className="v-mono mt-3 text-[9px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                    Original video
                  </figcaption>
                </figure>

                <div className="hidden flex-col items-center gap-2 lg:flex">
                  <span className="h-10 w-px bg-gradient-to-b from-transparent to-[var(--v-primary)]" />
                  <span className="text-[var(--v-accent)]">→</span>
                  <span className="h-10 w-px bg-gradient-to-t from-transparent to-[var(--v-accent)]" />
                </div>

                {/* Short */}
                <figure
                  className="v-anim relative mx-auto w-40 sm:w-48 lg:w-full"
                  style={entranceStyle(ENTRANCE.rightShort, entrancePlayed)}
                >
                  <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-[var(--v-primary)]/40 bg-[var(--v-surface)]">
                    <Media
                      asset={ASSETS.finalCut}
                      alt="Vertical short cut generated from the original footage"
                      className="h-full w-full scale-[1.6] object-cover object-[62%_38%]"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[var(--v-bg)] to-transparent" />
                    <div className="v-mono absolute left-2 top-2 rounded-full border border-[var(--v-border-strong)] bg-[var(--v-bg)]/75 px-2 py-0.5 text-[8px] uppercase tracking-[0.16em]">
                      final cut
                    </div>
                    <div className="v-mono absolute bottom-3 left-2 right-2 text-[8px] uppercase leading-relaxed text-[var(--v-fg)]/80">
                      <span className="v-gradient-word font-sans text-[13px] font-black tracking-tight">94</span> attention
                    </div>
                  </div>
                  <figcaption className="v-mono mt-3 text-[9px] uppercase tracking-[0.2em] text-[var(--v-fg-muted)]">
                    Vertical short
                  </figcaption>
                </figure>
              </div>

              {/* Linea divisoria, animata separatamente (Figma: nodo "Line") */}
              <div
                className="v-anim mt-8 h-px bg-[var(--v-border)]"
                style={entranceStyle(ENTRANCE.pipelineDivider, entrancePlayed)}
              />

              {/* System pipeline indicators — ingresso scaglionato + avanzamento con lo scroll */}
              <ul className="v-mono mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-[9px] uppercase tracking-[0.18em] text-[var(--v-fg-muted)]">
                {pipeline.map((step, index) => (
                  <li
                    key={step}
                    className={`v-anim flex items-center gap-2 transition-colors duration-300 ${index === activeStep ? "text-[var(--v-fg)]" : ""}`}
                    style={entranceStyle(ENTRANCE[pipelineEntranceKeys[index]], entrancePlayed)}
                  >
                    <span
                      className={`size-1 rounded-full transition-colors duration-300 ${index <= activeStep ? "bg-gradient-to-r from-[var(--v-primary)] to-[var(--v-accent)]" : "bg-[var(--v-fg-muted)]/40"}`}
                    />
                    {step}
                  </li>
                ))}
              </ul>
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
