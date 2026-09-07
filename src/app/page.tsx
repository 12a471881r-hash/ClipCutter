export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-10">
      <div className="text-center space-y-3">
        <span className="text-sm font-medium tracking-widest text-neutral-500 uppercase">
          ClipAI
        </span>
        <h1 className="text-3xl sm:text-4xl font-semibold text-neutral-900">
          Trasforma i tuoi video in Shorts automaticamente.
        </h1>
      </div>

      <label
        htmlFor="video-upload"
        className="w-full max-w-xl flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-8 py-16 text-center cursor-pointer transition-colors hover:border-neutral-400 hover:bg-neutral-100"
      >
        <p className="text-neutral-600">Trascina qui il tuo video</p>
        <span className="inline-flex items-center rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">
          Carica video
        </span>
        <input id="video-upload" type="file" accept="video/*" className="hidden" />
      </label>
    </main>
  );
}
