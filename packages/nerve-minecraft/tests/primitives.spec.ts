import { runPrimitive } from "@sekizui/nerve-minecraft";
import { describe, expect, it } from "vitest";

import { FakeBot, FakeClock, vec } from "./fake-bot.js";

describe("执行原语的终止判据", () => {
  it("走到目标就收手，并把控制松开来", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    clock.onSleep.push(() => {
      if (!bot.controls.get("forward")) return;
      const at = bot.entity.position;
      bot.entity.position = vec(at.x + 1, at.y, at.z);
    });

    const outcome = await runPrimitive(bot, { op: "walk", to: [3, 64, 0] }, clock);

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("到了");
    expect(bot.controls.get("forward")).toBe(false);
    expect(bot.lookedAt).toHaveLength(1);
    expect(outcome.ms).toBe(150);
  });

  it("走不到就超时，控制照样松开", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();

    const outcome = await runPrimitive(bot, { op: "walk", to: [3, 64, 0], timeoutMs: 300 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("超时");
    expect(outcome.detail).toContain("水平差还有");
    expect(bot.controls.get("forward")).toBe(false);
    expect(outcome.ms).toBeGreaterThanOrEqual(300);
  });

  it("中途换代，走位作废，控制也松开", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    clock.onSleep.push(() => {
      if (clock.nowMs > 1_100) clock.gen = 2;
    });

    const outcome = await runPrimitive(bot, { op: "walk", to: [3, 64, 0], timeoutMs: 5_000 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("换代");
    expect(bot.controls.get("forward")).toBe(false);
    expect(clock.nowMs).toBeLessThan(2_000);
  });

  it("跳起来才算跳成了", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    clock.onSleep.push(() => {
      if (!bot.controls.get("jump")) return;
      bot.entity.onGround = false;
      bot.entity.position = vec(0, 64.4, 0);
    });

    const outcome = await runPrimitive(bot, { op: "jump" }, clock);

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("离地");
    expect(bot.controls.get("jump")).toBe(false);
  });

  it("按了 jump 却离不了地，超时认输", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();

    const outcome = await runPrimitive(bot, { op: "jump", timeoutMs: 200 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("超时");
    expect(bot.controls.get("jump")).toBe(false);
  });
});

describe("挖：判据是那一次挖掘完成，不是此刻世界长什么样", () => {
  it("dig 落地就算挖掉了——mineflayer 的 dig 本来就只在方块变成空气时才落地", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.blocks.set("1,64,0", { name: "dirt" });
    bot.digEffect = () => bot.blocks.delete("1,64,0");

    const outcome = await runPrimitive(bot, { op: "dig", at: [1, 64, 0] }, clock);

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("挖掉了");
  });

  it("挖掉之后世界又被补上一块，不算没挖成", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.blocks.set("1,64,0", { name: "dirt" });
    // dig 落地的那一刻，别的东西已经把这块补回来了
    bot.digEffect = () => bot.blocks.set("1,64,0", { name: "dirt" });

    const outcome = await runPrimitive(bot, { op: "dig", at: [1, 64, 0] }, clock);

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("挖掉了");
  });

  it("挖到一半挖不动，报错就是报错", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.blocks.set("1,64,0", { name: "bedrock" });
    bot.digEffect = () => {
      throw new Error("dig time for bedrock is Infinity");
    };

    const outcome = await runPrimitive(bot, { op: "dig", at: [1, 64, 0] }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("挖不动");
  });

  it("这一挖一直不落地，超时收手", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.blocks.set("1,64,0", { name: "obsidian" });
    bot.digEffect = () => new Promise<void>(() => {});

    const outcome = await runPrimitive(bot, { op: "dig", at: [1, 64, 0], timeoutMs: 200 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("超时");
    expect(outcome.detail).toContain("方块还在");
  });

  it("那里本来就没有方块，当场回话，不去挖空气", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();

    const outcome = await runPrimitive(bot, { op: "dig", at: [1, 64, 0] }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("本来就没有方块");
    expect(clock.nowMs).toBe(1_000);
  });
});

describe("攻击：判据是那一下打中了这个沿", () => {
  it("目标受了伤就算数，哪怕它随后回血回得比出手时还高", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.entities = { "1001": { id: 1_001, name: "zombie", health: 20 } };
    clock.onSleep.push(() => {
      bot.emit("entityHurt", { id: 1_001, name: "zombie", health: 16 });
      // 回血：比出手时还高。比快照的判据会在这里一直等到超时
      bot.entities["1001"] = { id: 1_001, name: "zombie", health: 22 };
    });

    const outcome = await runPrimitive(bot, { op: "attack", entityId: 1_001 }, clock);

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("受伤了");
    expect(bot.attacked).toHaveLength(1);
  });

  it("目标死了或从世界上消失，也算打到位", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.entities = { "1001": { id: 1_001, name: "zombie", health: 20 } };
    clock.onSleep.push(() => {
      bot.emit("entityGone", { id: 1_001, name: "zombie" });
      delete bot.entities["1001"];
    });

    const outcome = await runPrimitive(bot, { op: "attack", entityId: 1_001 }, clock);

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("不在世界上");
  });

  it("一刀没砍中就一直等，等到超时", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.entities = { "1001": { id: 1_001, name: "zombie", health: 20 } };

    const outcome = await runPrimitive(bot, { op: "attack", entityId: 1_001, timeoutMs: 200 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("超时");
    expect(outcome.detail).toContain("一直没受伤");
    expect(bot.attacked).toHaveLength(1);
  });

  it("别人挨的打不算这一次", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.entities = { "1001": { id: 1_001, name: "zombie", health: 20 } };
    clock.onSleep.push(() => {
      bot.emit("entityHurt", { id: 2_002, name: "cow", health: 5 });
    });

    const outcome = await runPrimitive(bot, { op: "attack", entityId: 1_001, timeoutMs: 200 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("一直没受伤");
  });

  it("目标本来就不在实体表里，不挥这一下", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();

    const outcome = await runPrimitive(bot, { op: "attack", entityId: 1_001 }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("不在实体表里");
    expect(bot.attacked).toHaveLength(0);
  });
});

describe("没有世界可碰的时候", () => {
  it("还没进世界时一个原语都不碰", async () => {
    const clock = new FakeClock();

    const outcome = await runPrimitive(undefined, { op: "walk", to: [3, 64, 0] }, clock);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("还没进世界");
  });

  it("原语收场之后不会留下监听器", async () => {
    const clock = new FakeClock();
    const bot = new FakeBot();
    bot.entities = { "1001": { id: 1_001, name: "zombie", health: 20 } };

    await runPrimitive(bot, { op: "attack", entityId: 1_001, timeoutMs: 200 }, clock);
    bot.emit("entityHurt", { id: 1_001, name: "zombie", health: 16 });

    expect(bot.listenerCount()).toBe(0);
  });
});
