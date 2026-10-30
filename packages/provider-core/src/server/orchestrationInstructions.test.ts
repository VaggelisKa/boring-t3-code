import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  t3AcpPromptWithInstructions,
} from "./orchestrationInstructions.ts";

describe("T3 ACP instructions", () => {
  it("reach ACP agents again only when the interaction mode or T3 tools change", () => {
    const state = { interactionMode: "default", hasT3Mcp: true } as const;
    assert.include(
      t3AcpPromptWithInstructions({ prompt: "Hi.", state }),
      T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
    );
    assert.equal(
      t3AcpPromptWithInstructions({ prompt: "Again.", state, previousState: state }),
      "Again.",
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt: "Plan it.",
        state: { ...state, interactionMode: "plan" },
        previousState: state,
      }),
      "## T3 Code interaction mode: Plan",
    );
  });
});
