"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/lib/format";

type Clip = {
  id: number;
  start_time: string;
  end_time: string;
  title: string | null;
  hook: string | null;
  score: number | null;
  video_url: string | null;
};

type Project = {
  id: number;
  name: string;
  original_video_url: string | null;
  status: string;
  transcript: { text: string; words: unknown[] } | null;
  clips: Clip[];
};

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [renderingClipId, setRenderingClipId] = useState<number | null>(null);

  const fetchProject = useCallback(async (): Promise<Project> => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) throw new Error("Progetto non trovato");
    const data = await res.json();
    setProject(data);
    return data as Project;
  }, [projectId]);

  const pollTranscription = useCallback(async () => {
    const startRes = await fetch(`/api/projects/${projectId}/transcribe`, {
      method: "POST",
    });
    if (!startRes.ok) throw new Error("Errore avvio trascrizione");

    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(`/api/projects/${projectId}/transcribe`);
      if (!statusRes.ok) throw new Error("Errore controllo trascrizione");
      const data = await statusRes.json();
      if (data.status === "completed") return;
      if (data.status === "error") throw new Error(data.error ?? "Trascrizione fallita");
    }
  }, [projectId]);

  const runAnalysis = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Errore nell'analisi AI");
    }
  }, [projectId]);

  const renderClip = useCallback(
    async (clipId: number) => {
      setRenderingClipId(clipId);
      try {
        const res = await fetch(`/api/clips/${clipId}/render`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Errore nella generazione della clip");
        }
        await fetchProject();
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setRenderingClipId(null);
      }
    },
    [fetchProject]
  );

  const runPipeline = useCallback(
    async (current: Project) => {
      setRunning(true);
      setError("");
      try {
        if (!current.transcript) {
          setStage("Trascrizione in corso...");
          await pollTranscription();
          current = await fetchProject();
        }

        if (current.clips.length === 0) {
          setStage("Analisi AI in corso...");
          await runAnalysis();
          current = await fetchProject();
        }

        const toRender = current.clips.filter((c) => !c.video_url);
        for (let i = 0; i < toRender.length; i++) {
          setStage(`Generazione clip ${i + 1}/${toRender.length}...`);
          await renderClip(toRender[i].id);
        }

        setStage("");
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
        setStage("");
      } finally {
        setRunning(false);
      }
    },
    [pollTranscription, runAnalysis, renderClip, fetchProject]
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchProject();
        setLoading(false);
        if (searchParams.get("autorun") === "1") {
          runPipeline(data);
        }
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Caricamento...</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-600">{error || "Progetto non trovato"}</p>
      </main>
    );
  }

  const needsTranscript = !project.transcript;
  const needsAnalysis = !needsTranscript && project.clips.length === 0;

  return (
    <main className="flex-1 px-6 py-16 max-w-2xl mx-auto w-full space-y-8">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Nuovo video
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">{project.name}</h1>
      </div>

      {project.original_video_url && (
        <video
          src={project.original_video_url}
          controls
          className="w-full rounded-2xl border border-border max-h-[400px]"
        />
      )}

      {running && (
        <Card className="p-5 space-y-3">
          <p className="text-sm font-medium">{stage}</p>
          <Progress indeterminate />
        </Card>
      )}

      {error && !running && (
        <Card className="p-5 space-y-3 border-red-200">
          <p className="text-sm text-red-600">{error}</p>
          <Button type="button" onClick={() => runPipeline(project)}>
            Riprova
          </Button>
        </Card>
      )}

      {!running && !error && needsTranscript && (
        <Button type="button" onClick={() => runPipeline(project)}>
          Avvia trascrizione
        </Button>
      )}

      {!running && !error && needsAnalysis && (
        <Button type="button" onClick={() => runPipeline(project)}>
          Riprova analisi
        </Button>
      )}

      {project.clips.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {project.clips.length} clip
          </h2>
          {project.clips.map((clip) => (
            <Card key={clip.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{clip.title ?? "Clip senza titolo"}</p>
                {clip.score !== null && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {clip.score}
                  </span>
                )}
              </div>
              {clip.hook && <p className="text-sm text-muted-foreground">{clip.hook}</p>}
              <p className="text-xs text-muted-foreground">
                {formatDuration(Number(clip.start_time))} –{" "}
                {formatDuration(Number(clip.end_time))}
              </p>

              {clip.video_url ? (
                <div className="flex items-center gap-3 pt-1">
                  <video
                    src={clip.video_url}
                    controls
                    className="w-24 rounded-lg border border-border"
                  />
                  <a
                    href={clip.video_url}
                    download
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    Scarica
                  </a>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={renderingClipId === clip.id}
                  onClick={() => renderClip(clip.id)}
                >
                  {renderingClipId === clip.id ? "Generazione..." : "Genera clip"}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
