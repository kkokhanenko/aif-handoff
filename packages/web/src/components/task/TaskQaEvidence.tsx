import { useMemo, useState } from "react";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTaskQaArtifacts } from "@/hooks/useTasks";
import { buttonVariants } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Spinner } from "@/components/ui/spinner";

export function TaskQaEvidence({ taskId }: { taskId: string }) {
  const { data: artifacts = [], isLoading } = useTaskQaArtifacts(taskId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.path === selectedPath) ?? null,
    [artifacts, selectedPath],
  );
  const preview = useQuery({
    queryKey: ["task-qa-artifact-preview", taskId, selected?.path],
    queryFn: () =>
      api.getTaskQaArtifactText(taskId, selected!.path).then((result) => result.content),
    enabled: selected?.kind === "markdown" || selected?.kind === "text",
  });

  if (isLoading) return <Spinner size="sm" />;
  if (artifacts.length === 0) {
    return <p className="text-sm text-muted-foreground">No verified QA artifacts were saved.</p>;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-1">
        {artifacts.map((artifact) => (
          <button
            key={artifact.path}
            type="button"
            className="flex w-full items-center gap-2 border border-border px-2 py-1.5 text-left text-xs hover:border-primary/50"
            onClick={() => setSelectedPath(artifact.path)}
          >
            {artifact.kind === "image" ? (
              <ImageIcon className="h-3.5 w-3.5" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            <span className="min-w-0 flex-1 break-all">{artifact.path}</span>
            <span className="text-muted-foreground">{Math.ceil(artifact.size / 1024)} KB</span>
          </button>
        ))}
      </div>
      <div className="min-h-48 border border-border p-3">
        {!selected && <p className="text-sm text-muted-foreground">Select an artifact.</p>}
        {selected?.kind === "image" && (
          <img
            src={api.taskQaArtifactUrl(taskId, selected.path)}
            alt={selected.name}
            className="max-h-[65vh] max-w-full object-contain"
          />
        )}
        {selected?.kind === "markdown" && preview.data && <Markdown content={preview.data} />}
        {selected?.kind === "text" && preview.data && (
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap text-xs">
            {preview.data}
          </pre>
        )}
        {selected && (selected.kind === "binary" || selected.kind === "trace") && (
          <a
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={api.taskQaArtifactUrl(taskId, selected.path)}
            download={selected.name}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Download {selected.name}
          </a>
        )}
      </div>
    </div>
  );
}
