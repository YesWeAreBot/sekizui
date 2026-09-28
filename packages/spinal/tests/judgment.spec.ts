import { compileArc, type Answer, type CompiledArc, type SampleCatalog } from "@sekizui/arc";
import { directiveOf, type Judgment } from "@sekizui/spinal";
import { describe, expect, it } from "vitest";

const catalog: SampleCatalog = {
  declares: [
    { path: "hp_percent", type: "number" },
    { path: "enemies[*].dist", type: "number" },
  ],
};

const arc: CompiledArc = compileArc(
  {
    id: "kite",
    on: "场上有敌对",
    off: "敌对清空",
    projection: ["hp_percent", "enemies[*].dist"],
    questions: [{ id: "horiz", type: "choice", instructions: "该拉开还是贴近", criteria: { Away: "太近", Near: "太远" } }],
    liveActions: ["Away", "Hold", "Near"],
    fallbackAction: "Hold",
    guards: { ttlMs: 1_500, minConfidence: 0.6 },
  },
  catalog,
);

const answers: Record<string, Answer> = {
  horiz: { type: "choice", choice: "Away", probabilities: { Away: 0.88, Near: 0.12 }, confidence: 0.81 },
};

function judgmentOf(patch: Partial<Judgment> = {}): Judgment {
  return {
    arc: "kite",
    model: "jev-1.13.0",
    sig: "ab12ef34",
    state: { hp_percent: 45 },
    answers,
    confidence: 0.81,
    at: 1_000,
    seenAt: 1_000,
    generation: 3,
    ttlMs: 1_500,
    ms: 287,
    ...patch,
  };
}

describe("directiveOf", () => {
  it("没有采样面就退保底", () => {
    expect(directiveOf({ arc, judgment: undefined, generation: undefined, now: 0 })).toEqual({
      kind: "fallback",
      arc: "kite",
      action: "Hold",
      why: "no-sampler",
    });
  });

  it("没判过就退保底", () => {
    expect(directiveOf({ arc, judgment: undefined, generation: 3, now: 0 })).toMatchObject({ why: "never-judged" });
  });

  it("换代了退保底，哪怕判断还很新", () => {
    expect(directiveOf({ arc, judgment: judgmentOf(), generation: 4, now: 1_100 })).toMatchObject({ why: "generation-changed" });
  });

  it("过期了退保底", () => {
    expect(directiveOf({ arc, judgment: judgmentOf(), generation: 3, now: 2_501 })).toMatchObject({ why: "stale" });
    expect(directiveOf({ arc, judgment: judgmentOf(), generation: 3, now: 2_500 })).toMatchObject({ kind: "judge" });
  });

  it("置信不够退保底", () => {
    expect(directiveOf({ arc, judgment: judgmentOf({ confidence: 0.51 }), generation: 3, now: 1_100 })).toMatchObject({ why: "low-confidence" });
  });

  it("都过了就给出判断，并带上新鲜的年龄", () => {
    expect(directiveOf({ arc, judgment: judgmentOf({ seenAt: 1_400 }), generation: 3, now: 1_500 })).toEqual({
      kind: "judge",
      arc: "kite",
      answers,
      confidence: 0.81,
      at: 1_000,
      ageMs: 500,
    });
  });
});
