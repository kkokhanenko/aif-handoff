import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TaskLog } from "@/components/task/TaskLog";

describe("TaskLog", () => {
  it("uses the available desktop height while keeping a mobile viewport limit", () => {
    const { container } = render(
      <TaskLog log="Long implementation log" label="Implementation log" />,
    );
    const log = container.firstElementChild;

    expect(log?.className).toContain("max-h-[60vh]");
    expect(log?.className).toContain("md:max-h-none");
    expect(log?.className).toContain("md:overflow-y-visible");
    expect(log?.className).not.toContain("max-h-64");
  });
});
