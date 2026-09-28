import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Sampler } from "@sekizui/arc";
import { SpinalService, type DecideRequest, type DecideResult, type Decider, type SpinalConfig } from "@sekizui/spinal";
import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

const doc = {
  arcs: [
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
  ],
};

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class FakeDecider implements Decider {
  readonly calls: DecideRequest[] = [];
  failure: Error | undefined;
  confidence = 0.81;

  async decide(request: DecideRequest): Promise<DecideResult> {
    this.calls.push(request);
    if (this.failure) throw this.failure;
    return {
      model: "jev-1.13.0",
      answers: { horiz: { type: "choice", choice: "Away", probabilities: { Away: this.confidence, Near: 1 - this.confidence }, confidence: this.confidence } },
      usage: { input_tokens: 300, output_tokens: 30 },
    };
  }
}

function makeSampler(read: () => Record<string, unknown>, generation = (): number => 1): Sampler {
  return {
    declares: [
      { path: "hp_percent", type: "number" },
      { path: "enemies", type: "array" },
      { path: "enemies[*].dist", type: "number" },
    ],
    read,
    generation,
  };
}

async function boot(config: SpinalConfig = {}): Promise<{ ctx: Context; spinal: SpinalService; decider: FakeDecider }> {
  const ctx = new Context();
  await ctx.plugin(SpinalService, { windowMs: 100, ...config });
  const spinal = ctx.get("spinal") as SpinalService;
  const decider = new FakeDecider();
  spinal.useSampler(makeSampler(() => ({ hp_percent: 45, enemies: [{ dist: 6 }] })));
  spinal.useDecider(decider);
  spinal.loadArcs(doc);
  return { ctx, spinal, decider };
}

describe("SpinalService", () => {
  it("配置补齐缺省值，能从 ctx 上取到", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(SpinalService, { windowMs: 200 });
    const spinal = ctx.get("spinal") as SpinalService;

    expect(spinal.settings.windowMs).toBe(200);
    expect(spinal.settings.model).toBe("jev-1.13.0");
    await fiber.dispose();
    expect(ctx.get("spinal")).toBeUndefined();
  });

  it("一条弧发一次问，判决落地，传出层拿到判断", async () => {
    const { spinal, decider } = await boot();

    const report = spinal.pulse(1_000);
    expect(report).toMatchObject({ sampled: true, generation: 1, asked: ["kite"], reused: [] });
    await spinal.drain();

    expect(decider.calls).toHaveLength(1);
    expect(decider.calls[0]?.state).toEqual({ hp_percent: 45, "enemies[*].dist": [6] });
    expect(spinal.directive("kite", 1_050)).toMatchObject({ kind: "judge", confidence: 0.81, ageMs: 50 });
    expect(spinal.ledger.lines().map((line) => line.arc)).toEqual(["kite"]);
  });

  it("状态没变就不重问，而且把存活期续上", async () => {
    const { spinal, decider } = await boot();

    spinal.pulse(1_000);
    await spinal.drain();
    const seen = spinal.pulse(1_100);
    expect(seen).toMatchObject({ sampled: true, asked: [], reused: ["kite"] });

    expect(decider.calls).toHaveLength(1);
    // 续期到 1100 之后，1500 的存活期能撑到 2600
    expect(spinal.directive("kite", 2_600)).toMatchObject({ kind: "judge" });
    expect(spinal.directive("kite", 2_601)).toMatchObject({ kind: "fallback", why: "stale" });
  });

  it("状态变了就重问", async () => {
    let hp = 45;
    const ctx = new Context();
    await ctx.plugin(SpinalService, { windowMs: 100 });
    const spinal = ctx.get("spinal") as SpinalService;
    const decider = new FakeDecider();
    spinal.useSampler(makeSampler(() => ({ hp_percent: hp, enemies: [{ dist: 6 }] })));
    spinal.useDecider(decider);
    spinal.loadArcs(doc);

    spinal.pulse(1_000);
    await spinal.drain();
    hp = 44;
    expect(spinal.pulse(1_100)).toMatchObject({ asked: ["kite"] });
    await spinal.drain();
    expect(decider.calls).toHaveLength(2);
  });

  it("换代清掉旧判决，重连之后不会拿着上一代的判断干活", async () => {
    let generation = 1;
    const ctx = new Context();
    await ctx.plugin(SpinalService, { windowMs: 100 });
    const spinal = ctx.get("spinal") as SpinalService;
    const decider = new FakeDecider();
    spinal.useSampler(
      makeSampler(
        () => ({ hp_percent: 45, enemies: [] }),
        () => generation,
      ),
    );
    spinal.useDecider(decider);
    spinal.loadArcs(doc);

    spinal.pulse(1_000);
    await spinal.drain();
    expect(spinal.directive("kite", 1_050)).toMatchObject({ kind: "judge" });

    generation = 2;
    spinal.pulse(1_100);
    expect(spinal.directive("kite", 1_150)).toMatchObject({ kind: "fallback", why: "never-judged" });
    await spinal.drain();
    expect(spinal.directive("kite", 1_200)).toMatchObject({ kind: "judge" });
    expect(spinal.judgments()[0]?.generation).toBe(2);
  });

  it("判断失败留下现场，退回保底", async () => {
    const { spinal, decider } = await boot();
    decider.failure = new Error("服务炸了");

    spinal.pulse(1_000);
    await spinal.drain();

    expect(spinal.failures()).toEqual(["kite：服务炸了"]);
    expect(spinal.directive("kite", 1_050)).toMatchObject({ kind: "fallback", action: "Hold", why: "never-judged" });
  });

  it("置信不够退保底，但判决仍留在缓存里", async () => {
    const { spinal, decider } = await boot();
    decider.confidence = 0.51;

    spinal.pulse(1_000);
    await spinal.drain();

    expect(spinal.directive("kite", 1_050)).toMatchObject({ kind: "fallback", action: "Hold", why: "low-confidence" });
    expect(spinal.judgments()).toHaveLength(1);
  });

  it("采样失败留下现场，不抛回宿主的心跳", async () => {
    const ctx = new Context();
    await ctx.plugin(SpinalService, {});
    const spinal = ctx.get("spinal") as SpinalService;
    // 采样面漏了根变量 enemies，读数不完整
    spinal.useSampler(makeSampler(() => ({ hp_percent: 45 })));
    spinal.useDecider(new FakeDecider());
    spinal.loadArcs(doc);

    const report = spinal.pulse(1_000);
    expect(report.sampled).toBe(false);
    expect(report.errors[0]).toContain("没有给出根变量");
    expect(spinal.failures()[0]).toContain("没有给出根变量");
    expect(spinal.directive("kite", 1_050)).toMatchObject({ kind: "fallback", why: "never-judged" });
  });

  it("没有采样面时既不采样也不提问", async () => {
    const ctx = new Context();
    await ctx.plugin(SpinalService, {});
    const spinal = ctx.get("spinal") as SpinalService;

    expect(spinal.pulse(1_000).errors).toEqual(["没有采样面"]);
    expect(spinal.directive("kite", 1_000)).toBeUndefined();
  });

  it("没有采样面就装不了弧，因为变量目录是空的", async () => {
    const ctx = new Context();
    await ctx.plugin(SpinalService, {});
    const spinal = ctx.get("spinal") as SpinalService;

    expect(() => spinal.loadArcs(doc)).toThrow("目录里没有这个变量");
  });

  it("没有判断者时明确报出来，不静默", async () => {
    const ctx = new Context();
    await ctx.plugin(SpinalService, {});
    const spinal = ctx.get("spinal") as SpinalService;
    spinal.useSampler(makeSampler(() => ({ hp_percent: 45, enemies: [] })));
    spinal.loadArcs(doc);

    expect(spinal.pulse(1_000).errors).toEqual(["没有判断者"]);
  });

  it("从文件装载弧库，判决写进账本文件", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sekizui-"));
    made.push(dir);
    const libraryPath = path.join(dir, "arcs.json");
    await writeFile(libraryPath, JSON.stringify(doc), "utf8");

    const { spinal, decider } = await boot({ libraryPath, ledgerPath: path.join(dir, "judgments.jsonl") });
    await spinal.openLibrary();
    expect(spinal.library.size).toBe(1);

    spinal.pulse(1_000);
    await spinal.drain();

    expect(decider.calls).toHaveLength(1);
    const lines = await spinal.ledger.read();
    expect(lines.map((line) => line.arc)).toEqual(["kite"]);
    expect(lines[0]?.state).toEqual({ hp_percent: 45, "enemies[*].dist": [6] });
    expect(lines[0]?.model).toBe("jev-1.13.0");
  });
});
