import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  MarkdownFileLinkProvider,
  type MarkdownFileLinkRequest,
} from "@/components/ui/markdown-file-links";
import { Markdown } from "@/components/ui/markdown";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

interface ProjectMarkdownViewerProps {
  taskId: string | null;
  children: ReactNode;
}

export function ProjectMarkdownViewer({ taskId, children }: ProjectMarkdownViewerProps) {
  const [request, setRequest] = useState<MarkdownFileLinkRequest | null>(null);
  const openProjectFile = useCallback((next: MarkdownFileLinkRequest) => setRequest(next), []);
  const query = useQuery({
    queryKey: ["task-project-markdown", taskId, request?.href, request?.sourcePath],
    queryFn: () => api.getTaskProjectMarkdown(taskId!, request!.href, request?.sourcePath),
    enabled: Boolean(taskId && request),
    retry: false,
  });

  const close = () => setRequest(null);
  const visiblePath = query.data?.path ?? request?.href ?? "Markdown";

  return (
    <MarkdownFileLinkProvider value={openProjectFile}>
      {children}
      <Dialog open={Boolean(request)} onOpenChange={(open) => !open && close()}>
        <DialogContent className="flex h-[82vh] max-w-5xl flex-col p-0">
          <DialogHeader className="mb-0 border-b border-border px-5 py-4 pr-12">
            <DialogTitle className="text-base">{visiblePath}</DialogTitle>
            <p className="text-xs text-muted-foreground">Project Markdown · read only</p>
          </DialogHeader>
          <DialogClose onClose={close} />

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {query.isPending && (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Loading document...
              </div>
            )}
            {query.isError && (
              <div className="border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                {query.error instanceof Error ? query.error.message : "Unable to open document"}
              </div>
            )}
            {query.data && (
              <Markdown
                content={query.data.content}
                sourcePath={query.data.path}
                className="mx-auto max-w-4xl text-sm"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MarkdownFileLinkProvider>
  );
}
