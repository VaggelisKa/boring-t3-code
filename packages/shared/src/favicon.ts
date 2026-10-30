// Boring T3 Code never loads favicons from the network: not from a favicon
// service, which would learn every hostname shown in chat, and not from the
// linked sites themselves. Only inline `data:` images are shown.

/** Accepts inline images supplied by a trusted provider event. */
function inlineFaviconUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || rawUrl.length > 65_536) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "data:" ? url.href : null;
  } catch {
    return null;
  }
}

export function toolActivityFaviconUrl(
  icon: {
    readonly pageUrl: string;
    readonly faviconUrl?: string | undefined;
    readonly faviconUrlDark?: string | undefined;
  },
  appearance: "light" | "dark",
): string | null {
  if (appearance === "dark") {
    return inlineFaviconUrl(icon.faviconUrlDark) ?? inlineFaviconUrl(icon.faviconUrl);
  }
  return inlineFaviconUrl(icon.faviconUrl);
}
