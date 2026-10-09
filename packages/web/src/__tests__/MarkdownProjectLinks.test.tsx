import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "@/components/ui/markdown";
import { MarkdownFileLinkProvider } from "@/components/ui/markdown-file-links";

describe("project Markdown links", () => {
  it("routes relative Markdown links to the project viewer", () => {
    const open = vi.fn();
    render(
      <MarkdownFileLinkProvider value={open}>
        <Markdown content="[Guide](../docs/guide.md#setup)" sourcePath="notes/index.md" />
      </MarkdownFileLinkProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Guide" }));
    expect(open).toHaveBeenCalledWith({
      href: "../docs/guide.md#setup",
      sourcePath: "notes/index.md",
    });
  });

  it.each([
    ["External", "https://example.com/guide.md"],
    ["Anchor", "#setup"],
    ["App route", "/docs/guide.md"],
  ])("leaves %s links to the browser", (label, href) => {
    const open = vi.fn();
    render(
      <MarkdownFileLinkProvider value={open}>
        <Markdown content={`[${label}](${href})`} />
      </MarkdownFileLinkProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: label }));
    expect(open).not.toHaveBeenCalled();
  });
});
