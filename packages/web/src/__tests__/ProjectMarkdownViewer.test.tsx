import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMarkdownViewer } from "@/components/task/ProjectMarkdownViewer";
import { Markdown } from "@/components/ui/markdown";

const { getTaskProjectMarkdown } = vi.hoisted(() => ({ getTaskProjectMarkdown: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { getTaskProjectMarkdown },
}));

function renderViewer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectMarkdownViewer taskId="task-1">
        <Markdown content="[Open guide](docs/guide.md)" />
      </ProjectMarkdownViewer>
    </QueryClientProvider>,
  );
}

describe("ProjectMarkdownViewer", () => {
  beforeEach(() => {
    getTaskProjectMarkdown.mockReset();
  });

  it("opens project Markdown and resolves the next link from the displayed file", async () => {
    getTaskProjectMarkdown
      .mockResolvedValueOnce({
        path: "docs/guide.md",
        content: "# Guide\n\n[Back to readme](../README.md)",
      })
      .mockResolvedValueOnce({ path: "README.md", content: "# Project" });
    renderViewer();

    fireEvent.click(screen.getByRole("link", { name: "Open guide" }));
    expect(await screen.findByRole("heading", { name: "Guide" })).toBeInTheDocument();
    expect(getTaskProjectMarkdown).toHaveBeenNthCalledWith(1, "task-1", "docs/guide.md", undefined);

    fireEvent.click(screen.getByRole("link", { name: "Back to readme" }));
    await waitFor(() =>
      expect(getTaskProjectMarkdown).toHaveBeenNthCalledWith(
        2,
        "task-1",
        "../README.md",
        "docs/guide.md",
      ),
    );
    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
  });

  it("shows a readable error without leaving the task", async () => {
    getTaskProjectMarkdown.mockRejectedValueOnce(new Error("Markdown file not found"));
    renderViewer();

    fireEvent.click(screen.getByRole("link", { name: "Open guide" }));
    expect(await screen.findByText("Markdown file not found")).toBeInTheDocument();
  });
});
