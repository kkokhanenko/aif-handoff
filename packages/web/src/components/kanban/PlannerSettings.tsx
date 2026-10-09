import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";

interface PlannerSettingsProps {
  isParallel: boolean;
  plannerMode: "full" | "fast";
  onModeChange: (mode: "full" | "fast") => void;
  planPath: string;
  onPlanPathChange: (value: string) => void;
  effectivePlanPath: string;
  defaultPlanPath: string;
  planTests: boolean;
  onPlanTestsChange: (v: boolean) => void;
}

export function PlannerSettings({
  isParallel,
  plannerMode,
  onModeChange,
  planPath,
  onPlanPathChange,
  effectivePlanPath,
  defaultPlanPath,
  planTests,
  onPlanTestsChange,
}: PlannerSettingsProps) {
  return (
    <div className="space-y-2 border border-border/60 bg-muted/20 p-2">
      <div className="space-y-1">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
        {isParallel ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Full</span>
            <span className="ml-1.5 text-3xs">(required by parallel mode)</span>
          </p>
        ) : (
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio
                name="plannerMode"
                checked={plannerMode === "full"}
                onChange={() => onModeChange("full")}
                className="h-3.5 w-3.5"
              />
              <span className="font-medium text-foreground">Full</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio
                name="plannerMode"
                checked={plannerMode === "fast"}
                onChange={() => onModeChange("fast")}
                className="h-3.5 w-3.5"
              />
              <span className="font-medium text-foreground">Fast</span>
            </label>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Plan file path
        </p>
        {isParallel ? (
          <>
            <p className="text-xs font-mono text-muted-foreground truncate">{effectivePlanPath}</p>
            <p className="text-3xs text-muted-foreground/70">
              Auto-generated per task (parallel mode)
            </p>
          </>
        ) : (
          <>
            <Input
              value={planPath}
              onChange={(e) => onPlanPathChange(e.target.value)}
              placeholder={defaultPlanPath}
              inputSize="sm"
            />
            <p className="text-3xs text-muted-foreground/70">
              Preview — server may adjust based on project config
            </p>
          </>
        )}
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={planTests}
            onChange={(e) => onPlanTestsChange(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className="font-medium text-foreground">Tests</span>
        </label>
      </div>
    </div>
  );
}
