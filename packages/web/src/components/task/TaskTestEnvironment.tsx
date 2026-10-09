import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { useDestroyTaskTestEnvironment, useTaskTestEnvironments } from "@/hooks/useTasks";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AlertBox } from "@/components/ui/alert-box";
import { api } from "@/lib/api";

export function TaskTestEnvironment({ taskId }: { taskId: string }) {
  const { data } = useTaskTestEnvironments(taskId);
  const destroy = useDestroyTaskTestEnvironment(taskId);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const environments = data?.environments ?? [];
  if (environments.length === 0) return null;

  return (
    <div className="space-y-2">
      {environments.map((environment) => (
        <div
          key={environment.environment_id}
          className="space-y-2 border border-border p-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{environment.environment_id}</span>
            <Badge variant="outline" size="sm">
              {environment.status}
            </Badge>
            {environment.test_result && (
              <Badge variant="outline" size="sm">
                QA {environment.test_result}
              </Badge>
            )}
          </div>
          <div className="break-all text-muted-foreground">
            Revision: {environment.revision.value}
            <br />
            Reserved until: {new Date(environment.expires_at).toLocaleString()}
          </div>
          {environment.error && (
            <AlertBox variant="warning" className="text-xs">
              {environment.error.message}
            </AlertBox>
          )}
          <div className="flex flex-wrap gap-2">
            {environment.url && (
              <a
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={environment.url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open site
              </a>
            )}
            {environment.status !== "destroyed" && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setPendingDelete(environment.environment_id)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete stand
              </Button>
            )}
          </div>
          {environment.evidence.length > 0 && (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="font-medium">Evidence</p>
              <div className="flex flex-wrap gap-2">
                {environment.evidence.map((evidencePath) => (
                  <a
                    key={evidencePath}
                    className="text-primary underline underline-offset-2"
                    href={api.taskTestEnvironmentEvidenceUrl(
                      taskId,
                      environment.environment_id,
                      evidencePath,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {evidencePath.split("/").at(-1)}
                  </a>
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {environment.evidence
                  .filter((evidencePath) => /\.(png|jpe?g|webp)$/i.test(evidencePath))
                  .map((evidencePath) => (
                    <a
                      key={evidencePath}
                      href={api.taskTestEnvironmentEvidenceUrl(
                        taskId,
                        environment.environment_id,
                        evidencePath,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={api.taskTestEnvironmentEvidenceUrl(
                          taskId,
                          environment.environment_id,
                          evidencePath,
                        )}
                        alt={evidencePath}
                        className="max-h-64 w-full border border-border object-contain"
                      />
                    </a>
                  ))}
              </div>
            </div>
          )}
        </div>
      ))}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete test stand?"
        description={`Only the exact stand ${pendingDelete ?? ""} will be destroyed. Saved QA artifacts are not removed.`}
        confirmLabel="Delete stand"
        variant="destructive"
        onConfirm={() => {
          if (!pendingDelete) return;
          destroy.mutate(pendingDelete, { onSuccess: () => setPendingDelete(null) });
        }}
      />
    </div>
  );
}
