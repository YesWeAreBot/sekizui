import { describe, expect, it } from "vitest";

import {
  ArcSpecError,
  arcSpecSchema,
  compileArc,
  normalizePath,
  parsePath,
  project,
  renderPath,
  type ArcSpec,
  type SampleCatalog,
  type Snapshot,
} from "../src/index.js";

const catalog: SampleCatalog = {
  declares: [
    { path: "hp_percent", type: "number", cost: 4 },
    { path: "enemies[*].dist", type: "number", unit: "格", validWhen: "enemies.length > 0", cost: 8 },
    { path: "placing_now", type: "boolean", cost: 2 },
  ],
};

const spec: ArcSpec = {
  id: "kite",
  on: "场上有敌对",
  off: "敌对清空",
  projection: ["hp_percent", "enemies[*].dist", "placing_now"],
  questions: [{ id: "horiz", instructions: "该拉开还是贴近", criteria: { Away: "太近", Near: "太远" } }],
  liveActions: ["Away", "Hold", "Near"],
  fallbackAction: "Hold",
  guards: { ttlMs: 1500, minConfidence: 0.6 },
};

const snapshot: Snapshot = {
  values: { hp_percent: 45, enemies: [{ dist: 6 }, { dist: 12 }], placing_now: true },
  observedAt: 1_000,
  generation: 3,
};

describe("parsePath", () => {
  it("把下标与通配拆成路径段", () => {
    expect(parsePath("enemies[*].dist")).toEqual([{ key: "enemies" }, { each: true }, { key: "dist" }]);
    expect(parsePath("grid[0][2]")).toEqual([{ key: "grid" }, { index: 0 }, { index: 2 }]);
    expect(parsePath("hp_percent")).toEqual([{ key: "hp_percent" }]);
  });

  it("拒绝空段与写坏的段", () => {
    expect(() => parsePath("enemies[].dist")).toThrow(ArcSpecError);
    expect(() => parsePath("enemies..dist")).toThrow(ArcSpecError);
    expect(() => parsePath("2fast")).toThrow(ArcSpecError);
  });

  it("拼回可读路径", () => {
    expect(renderPath(parsePath("enemies[0].dist"))).toBe("enemies[0].dist");
    expect(normalizePath("enemies[0].dist")).toBe("enemies[*].dist");
  });
});

describe("compileArc", () => {
  it("接受目录里声明的路径，下标当通配", () => {
    const arc = compileArc({ ...spec, projection: ["enemies[1].dist"] }, catalog);
    expect(arc.spec.projection).toEqual(["enemies[1].dist"]);
  });

  it("拒绝目录外的变量", () => {
    expect(() => compileArc({ ...spec, projection: ["hidden.hp"] }, catalog)).toThrow("目录里没有这个变量");
  });

  it("拒绝保底动作不在候选集里", () => {
    expect(() => compileArc({ ...spec, fallbackAction: "Dance" }, catalog)).toThrow("不在候选集里");
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

  it("字段名是目录里的路径，值来自快照", () => {
    expect(project(arc, snapshot)).toEqual({
      hp_percent: 45,
      "enemies[*].dist": [6, 12],
      placing_now: true,
    });
  });

  it("取不到就是 undefined，不补默认值", () => {
    const state = project(arc, { ...snapshot, values: { placing_now: false } });
    expect(state.hp_percent).toBeUndefined();
    expect(state["enemies[*].dist"]).toEqual([]);
  });

  it("通配碰到非数组返回空", () => {
    const state = project(arc, { ...snapshot, values: { enemies: 3 } });
    expect(state["enemies[*].dist"]).toEqual([]);
  });
});
