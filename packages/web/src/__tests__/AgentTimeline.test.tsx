import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentTimeline } from "@/components/task/AgentTimeline";

describe("AgentTimeline", () => {
  it("shows empty state", () => {
    render(<AgentTimeline activityLog={null} />);
    expect(screen.getByText("No agent activity yet")).toBeDefined();
  });

  it("renders parsed tool entries with TOOL badge", () => {
    const { container } = render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Tool: Read\n[2026-01-01T10:00:01.000Z] Tool: Write"
        }
      />,
    );

    expect(screen.getAllByText("TOOL")).toHaveLength(2);
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Write")).toBeDefined();
    expect(container.querySelector(".space-y-2")?.className).toContain("max-h-[60vh]");
    expect(container.querySelector(".space-y-2")?.className).toContain("md:max-h-none");
    expect(container.querySelector(".space-y-2")?.className).not.toContain("max-h-64");
  });

  it("renders error entries with ERROR badge", () => {
    render(
      <AgentTimeline activityLog={"[2026-01-01T10:00:02.000Z] Planning failed: rate limit"} />,
    );

    expect(screen.getByText("ERROR")).toBeDefined();
    expect(screen.getByText("Planning failed: rate limit")).toBeDefined();
  });

  it("filters entries by Tools", () => {
    render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Tool: Read\n" +
          "[2026-01-01T10:00:01.000Z] Planning failed: rate limit\n" +
          "[2026-01-01T10:00:02.000Z] Implementation complete"
        }
      />,
    );

    fireEvent.click(screen.getByText("Tools"));
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.queryByText("Planning failed: rate limit")).toBeNull();
    expect(screen.queryByText("Implementation complete")).toBeNull();
  });

  it("renders agent entries with AGENT badge and violet styling", () => {
    render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Agent started planning\n[2026-01-01T10:00:01.000Z] Subagent completed review"
        }
      />,
    );

    expect(screen.getAllByText("AGENT")).toHaveLength(2);
    expect(screen.getByText("Agent started planning")).toBeDefined();
    expect(screen.getByText("Subagent completed review")).toBeDefined();
  });

  it("filters entries by Agents", () => {
    render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Tool: Read\n" +
          "[2026-01-01T10:00:01.000Z] Agent started planning\n" +
          "[2026-01-01T10:00:02.000Z] Implementation complete"
        }
      />,
    );

    fireEvent.click(screen.getByText("Agents"));
    expect(screen.getByText("Agent started planning")).toBeDefined();
    expect(screen.queryByText("Read")).toBeNull();
    expect(screen.queryByText("Implementation complete")).toBeNull();
  });

  it("filters entries by Errors", () => {
    render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Tool: Read\n" +
          "[2026-01-01T10:00:01.000Z] Planning failed: rate limit"
        }
      />,
    );

    fireEvent.click(screen.getByText("Errors"));
    expect(screen.getByText("Planning failed: rate limit")).toBeDefined();
    expect(screen.queryByText("Read")).toBeNull();
  });
});
