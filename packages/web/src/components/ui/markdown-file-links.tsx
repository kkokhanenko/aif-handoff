import { createContext, useContext } from "react";

export interface MarkdownFileLinkRequest {
  href: string;
  sourcePath?: string;
}

type MarkdownFileLinkHandler = (request: MarkdownFileLinkRequest) => void;

const MarkdownFileLinkContext = createContext<MarkdownFileLinkHandler | null>(null);

export const MarkdownFileLinkProvider = MarkdownFileLinkContext.Provider;

export function useMarkdownFileLinkHandler(): MarkdownFileLinkHandler | null {
  return useContext(MarkdownFileLinkContext);
}

export function isLocalMarkdownLink(href: string | undefined): href is string {
  if (!href || href.startsWith("#") || href.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) return false;

  const path = href.split(/[?#]/, 1)[0] ?? "";
  return /\.(?:md|markdown)$/i.test(path);
}
