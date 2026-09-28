import { describe, expect, it } from "vitest";

import {
  ArcSpecError,
  arcSpecSchema,
  choiceQuestionSchema,
  compileArc,
  confidenceOf,
  confidenceOfAnswers,
  normalizePath,
  parsePath,
  project,
  renderPath,
  scoreQuestionSchema,
  type ArcSpec,
  type SampleCatalog,
  type Snapshot,
} from "../src/index.js";

const catalog: SampleCatalog = {
  declares: [
    { path: "hp_percent", type: "number", cost: 4 },
    { path: "enemies", type: "array", cost: 24 },
    { path: "enemies[*].dist", type: "number", unit: "格", validWhen: "enemies.length > 0", cost: 8 },
    { path: "placing_now", type: "boolean", cost: 2 },
  ],
};

const spec: ArcSpec = {
  id: "kite",
  on: "场上有敌对",
  off: "敌对清空",
  projection: ["hp_percent", "enemies[*].dist", "placing_now"],
  questions: [
    {
      id: "horiz",
      type: "choice",
      instructions: "该拉开还是贴近",
      criteria: { Away: "太近", Near: "太远" },
    },
  ],
  liveActions: ["Away", "Hold", "Near"],
  fallbackAction: "Hold",
  guards: { ttlMs: 1_500, minConfidence: 0.6 },
};

const snapshot: Snapshot = {
  values: { hp_percent: 45, enemies: [{ dist: 6 }, { dist: 12 }], placing_now: true },
  observedAt: 1_000,
  generation: 3,
};

describe("路径", () => {
  it("下标与通配都拆成同一段", () => {
    expect(parsePath("enemies[0].dist")).toEqual([{ key: "enemies" }, { each: true }, { key: "dist" }]);
    expect(parsePath("enemies[*].dist")).toEqual(parsePath("enemies[2].dist"));
    expect(parsePath("hp_percent")).toEqual([{ key: "hp_percent" }]);
  });

  it("拒绝写坏的段", () => {
    expect(() => parsePath("enemies[].dist")).toThrow(ArcSpecError);
    expect(() => parsePath("enemies..dist")).toThrow(ArcSpecError);
    expect(() => parsePath("2fast")).toThrow(ArcSpecError);
  });

  it("拼回可读路径时下标也归一", () => {
    expect(renderPath(parsePath("enemies[1].dist"))).toBe("enemies[*].dist");
    expect(normalizePath("enemies[9].dist")).toBe("enemies[*].dist");
  });
});

describe("compileArc", () => {
  it("接受目录里声明过的路径，下标当通配", () => {
    expect(compileArc({ ...spec, projection: ["enemies[1].dist"] }, catalog).spec.projection).toEqual(["enemies[1].dist"]);
  });

  it("拒绝目录外的变量", () => {
    expect(() => compileArc({ ...spec, projection: ["hidden.hp"] }, catalog)).toThrow("目录里没有这个变量");
  });

  it("拒绝保底动作不在候选集里", () => {
    expect(() => compileArc({ ...spec, fallbackAction: "Dance" }, catalog)).toThrow("不在候选集里");
  });

  it("拒绝重复的问题 id", () => {
    const questions = [spec.questions[0], spec.questions[0]];
    expect(() => compileArc({ ...spec, questions }, catalog)).toThrow("问题 id 重复");
  });

  it("缺 off 就不算一条弧", () => {
    const { off: _off, ...zombie } = spec;
    const parsed = arcSpecSchema.safeParse(zombie);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain("off");
  });
});

describe("project", () => {
  const arc = compileArc(spec, catalog);

  it("字段名是归一后的路径，值来自快照", () => {
    expect(project(arc, snapshot)).toEqual({
      hp_percent: 45,
      "enemies[*].dist": [6, 12],
      placing_now: true,
    });
  });

  it("两种写法落在同一个字段名上，值也一样", () => {
    const braced = compileArc({ ...spec, projection: ["enemies[1].dist"] }, catalog);
    expect(project(braced, snapshot)).toEqual({ "enemies[*].dist": [6, 12] });
  });

  it("可以整个根变量一起投影", () => {
    const whole = compileArc({ ...spec, projection: ["enemies"] }, catalog);
    expect(project(whole, snapshot)).toEqual({ enemies: [{ dist: 6 }, { dist: 12 }] });
  });

  it("取不到就是 undefined，不补默认值", () => {
    const state = project(arc, { ...snapshot, values: { placing_now: false } });
    expect(state.hp_percent).toBeUndefined();
    expect(state["enemies[*].dist"]).toEqual([]);
  });

  it("通配碰到非数组返回空", () => {
    expect(project(arc, { ...snapshot, values: { enemies: 3 } })["enemies[*].dist"]).toEqual([]);
  });
});

describe("问题类型", () => {
  it("noul 的 criteria 可省", () => {
    expect(choiceQuestionSchema.safeParse({ id: "q", type: "choice", instructions: "?", criteria: {} }).success).toBe(true);
    expect(
      choiceQuestionSchema.safeParse({
        id: "q",
        type: "choice",
        instructions: "?",
        criteria: Object.fromEntries(Array.from({ length: 256 }, (_v, index) => [`o${index}`, null])),
      }).success,
    ).toBe(false);
  });

  it("score 至少要两档，最多十档", () => {
    expect(scoreQuestionSchema.safeParse({ id: "q", type: "score", instructions: "?", criteria: ["低"] }).success).toBe(false);
    expect(scoreQuestionSchema.safeParse({ id: "q", type: "score", instructions: "?", criteria: ["低", "高"] }).success).toBe(true);
    expect(scoreQuestionSchema.safeParse({ id: "q", type: "score", instructions: "?", criteria: Array.from({ length: 11 }, (_v, i) => `${i}`) }).success).toBe(
      false,
    );
  });
});

describe("置信", () => {
  it("choice 直接用服务方给的 confidence", () => {
    expect(confidenceOf({ type: "choice", choice: "Away", probabilities: { Away: 0.88, Near: 0.12 }, confidence: 0.81 })).toBe(0.81);
  });

  it("noul 按离抛硬币多远折算", () => {
    expect(confidenceOf({ type: "noul", noul: 0.95 })).toBeCloseTo(0.9);
    expect(confidenceOf({ type: "noul", noul: 0.5 })).toBeCloseTo(0);
  });

  it("整体置信取最弱的一条", () => {
    expect(
      confidenceOfAnswers({
        weak: { type: "noul", noul: 0.5 },
        strong: { type: "choice", choice: "Away", probabilities: { Away: 1 }, confidence: 0.9 },
      }),
    ).toBeCloseTo(0);
    expect(confidenceOfAnswers({})).toBe(0);
  });
});
