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

  it("routes an absolute project Markdown path to the secured viewer", () => {
    const open = vi.fn();
    render(
      <MarkdownFileLinkProvider value={open}>
        <Markdown content="[Administration](/home/www/project/docs/administration.md)" />
      </MarkdownFileLinkProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Administration" }));
    expect(open).toHaveBeenCalledWith({
      href: "/home/www/project/docs/administration.md",
      sourcePath: undefined,
    });
  });

  it.each([
    ["External", "https://example.com/guide.md"],
    ["Anchor", "#setup"],
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
