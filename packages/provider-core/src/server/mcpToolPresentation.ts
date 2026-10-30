import type { ToolActivityIcon, ToolActivitySource } from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";

function normalizeMcpText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/gu, " ");
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

// Logos are never fetched from the network: a remote logo URL (often a favicon
// service) would tell a third party which tools are in use.
function normalizeMcpInlineImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 65_536) return undefined;
  return value.startsWith("data:image/") ? value : undefined;
}

export function mcpToolPresentation(input: {
  readonly toolName?: unknown;
  readonly serverName?: unknown;
  readonly title?: unknown;
  readonly serverDisplayName?: unknown;
  readonly iconUrl?: unknown;
  readonly iconUrlDark?: unknown;
  readonly source?: unknown;
}): {
  readonly title?: string;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
} {
  const source =
    typeof input.source === "object" && input.source !== null ? input.source : undefined;
  const qualified =
    typeof input.toolName === "string" ? /^mcp__(.+?)__(.+)$/i.exec(input.toolName) : null;
  const server = normalizeMcpText(input.serverName ?? qualified?.[1] ?? input.serverDisplayName);
  const tool = normalizeMcpText(qualified?.[2] ?? input.toolName);
  if (server && tool && resolveT3McpToolDefinition(`${server}.${tool}`)) return {};
  const title =
    normalizeMcpText(input.title) ??
    (server && tool ? normalizeMcpText(tool.replace(/[_-]+/gu, " ")) : undefined);
  if (!server) return title ? { title } : {};
  const name =
    normalizeMcpText(input.serverDisplayName) ??
    normalizeMcpText(source && Reflect.get(source, "name")) ??
    normalizeMcpText(server.replace(/[_-]+/gu, " ")) ??
    server;
  const logoUrl =
    normalizeMcpInlineImageUrl(input.iconUrl) ??
    normalizeMcpInlineImageUrl(source && Reflect.get(source, "logoUrl"));
  const logoUrlDark =
    normalizeMcpInlineImageUrl(input.iconUrlDark) ??
    normalizeMcpInlineImageUrl(source && Reflect.get(source, "logoUrlDark"));
  const icon = logoUrl
    ? { _tag: "themed-logo" as const, logoUrl, ...(logoUrlDark ? { logoUrlDark } : {}) }
    : undefined;
  return {
    ...(title ? { title } : {}),
    ...(icon ? { toolIcon: icon } : {}),
    toolSource: {
      key: `mcp:${server.toLowerCase()}`,
      name,
      kind: "integration",
      ...(icon ? { icon } : {}),
    },
  };
}
