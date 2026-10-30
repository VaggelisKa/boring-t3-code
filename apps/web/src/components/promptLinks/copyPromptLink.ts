import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type ModelSelection,
  repositoryGroupingKeyOf,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  buildNewThreadLink,
  parsePromptLinkRepository,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
  promptLinkDeepLink,
  type PromptLinkRepository,
} from "@t3tools/shared/promptLinks";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

import { stackedThreadToast, toastManager } from "../ui/toast";

/** A link to a prompt on this server, or null when the prompt cannot fit in one. */
export function promptLinkFor(
  prompt: string,
  context?: {
    readonly repository: PromptLinkRepository | null;
    readonly provider: string | null;
    readonly model: string | null;
  },
): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || trimmed.length > PROMPT_LINK_MAX_PROMPT_LENGTH) return null;
  if (/^https?:$/.test(window.location.protocol)) {
    return buildNewThreadLink({ prompt: trimmed, ...context, origin: window.location.origin });
  }
  // The renderer origin can't be opened from outside; only macOS builds register this deep-link scheme.
  const link = new URL(
    buildNewThreadLink({ prompt: trimmed, ...context, origin: "https://app.invalid" }),
  );
  return promptLinkDeepLink(
    `${link.pathname}${link.search}`,
    window.location.protocol.slice(0, -1),
  );
}

export function promptLinkRepositoryOf(
  project: Pick<EnvironmentProject, "repositoryIdentity"> | undefined,
): PromptLinkRepository | null {
  const identity = project?.repositoryIdentity;
  if (identity == null) return null;
  const key = repositoryGroupingKeyOf(identity);
  return key.startsWith("github.com/")
    ? parsePromptLinkRepository(key.slice("github.com/".length))
    : null;
}

export function composerPromptLink(input: {
  readonly target: ComposerThreadTarget;
  readonly project: EnvironmentProject | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly threadModelSelection: ModelSelection | null;
  readonly withContext: boolean;
}): string | null {
  const draft = useComposerDraftStore.getState().getComposerDraft(input.target);
  if (!draft) return null;
  if (!input.withContext) return promptLinkFor(draft.prompt);
  const selection =
    (draft.activeProvider ? draft.modelSelectionByProvider[draft.activeProvider] : undefined) ??
    input.threadModelSelection;
  const provider = selection
    ? (input.providers.find((candidate) => candidate.instanceId === selection.instanceId)?.driver ??
      null)
    : null;
  return promptLinkFor(draft.prompt, {
    repository: promptLinkRepositoryOf(input.project),
    provider,
    model: provider === null ? null : (selection?.model ?? null),
  });
}

export async function copyPromptLink(link: string): Promise<void> {
  try {
    if (!(await writeTextToClipboard(link))) return;
    toastManager.add({ type: "success", title: "Prompt link copied" });
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not copy the prompt link",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}
