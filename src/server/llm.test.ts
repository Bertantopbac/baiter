import { test, expect } from "bun:test";
import { generateBait } from "./llm";
import { AGENTS } from "../shared/agents";

// Without OPENAI_API_KEY the local fallback generator should still return a
// non-empty, reasonably short reply for any persona.
test("fallback bait produces a reply", async () => {
  for (const persona of AGENTS) {
    const reply = await generateBait({
      persona,
      config: {
        mode: persona.mode,
        tone: persona.defaults.tone,
        goal: persona.defaults.goal,
        intensity: persona.defaults.intensity,
        privateOnly: true,
        maxRepliesPerMin: 6,
      },
      incomingText: "i just got a new job and i'm so happy about it",
      fromName: "Alex",
    });
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    expect(reply.length).toBeLessThan(400);
  }
});
