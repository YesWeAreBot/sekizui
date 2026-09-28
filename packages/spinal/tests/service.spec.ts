import { ArcLibrary, SpinalService, configDefaults } from "@sekizui/spinal";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

describe("SpinalService", () => {
  it("装上之后能从 ctx 上取到，配置补齐缺省值", async () => {
    const ctx = new Context();
    await ctx.plugin(SpinalService, { windowMs: 200 });

    const spinal = ctx.get("spinal");
    expect(spinal?.name).toBe("spinal");
    expect(spinal?.settings.windowMs).toBe(200);
    expect(spinal?.settings.model).toBe(configDefaults.model);
  });

  it("卸载之后服务消失", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(SpinalService, {});
    await fiber.dispose();

    expect(ctx.get("spinal")).toBeUndefined();
  });
});

describe("ArcLibrary", () => {
  it("没有变量目录时任何弧都加载不了", () => {
    const library = new ArcLibrary();
    expect(() =>
      library.load({
        arcs: [
          {
            id: "kite",
            on: "场上有敌对",
            off: "敌对清空",
            projection: ["hp_percent"],
            questions: [{ id: "horiz", instructions: "该拉开还是贴近", criteria: { Away: "太近" } }],
            liveActions: ["Away", "Hold"],
            fallbackAction: "Hold",
            guards: { ttlMs: 1_500, minConfidence: 0.6 },
          },
        ],
      }),
    ).toThrow("目录里没有这个变量");
  });
});
