import { fileURLToPath } from "node:url";

import { NerveMinecraft, type NervePrimitive, type PrimitiveOutcome } from "@sekizui/nerve-minecraft";
import { describe, expect, it } from "vitest";

import { startFakeServer } from "./fake-server.js";
import { waitFor } from "./harness.js";

const engineSource = fileURLToPath(new URL("../src/engine.ts", import.meta.url));

function nerveFor(port: number, version: string, reconnectMs = 60_000): NerveMinecraft {
  return new NerveMinecraft({
    host: "127.0.0.1",
    port,
    username: "sekizui",
    version,
    runtime: "bun",
    enginePath: engineSource,
    pushMs: 50,
    reconnectMs,
  });
}

/** 等世界读得出来，顺手把引擎说过的话带进异常，免得超时变成哑谜。 */
async function world(nerve: NerveMinecraft): Promise<Record<string, unknown>> {
  try {
    return await waitFor(() => {
      try {
        return nerve.sampler.read();
      } catch {
        return undefined;
      }
    }, 20_000);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}｜引擎说过：${nerve.notes().join(" / ") || "（什么都没说）"}`);
  }
}

function zombieId(values: Record<string, unknown>): number {
  const entities = (values.entities ?? []) as ReadonlyArray<{ id: number; name: string }>;
  const zombie = entities.find((entity) => entity.name === "zombie");
  if (!zombie) throw new Error(`实体表里没有僵尸：${JSON.stringify(entities)}`);
  return zombie.id;
}

/** 下达一个原语，等主循环读到它的结果。 */
async function ordered(nerve: NerveMinecraft, primitive: NervePrimitive, timeoutMs?: number): Promise<PrimitiveOutcome> {
  const order = nerve.order(primitive, timeoutMs);
  return await waitFor(() => order.outcome(), 20_000);
}

/** 真协议、真引擎、真原语：把传出层整条路走一遍。 */
describe("传出层", () => {
  it("下达不阻塞：立刻拿回句柄，跑完的结果由主循环来读", async () => {
    const server = await startFakeServer({ mobs: [{ type: "zombie", x: 16, y: 64, z: 10 }], onAttack: "kill" });
    const nerve = nerveFor(server.port, server.version);

    try {
      nerve.start();
      const id = zombieId(await world(nerve));

      const started = Date.now();
      const order = nerve.order({ op: "attack", entityId: id, timeoutMs: 3_000 });
      const handedBackIn = Date.now() - started;

      expect(handedBackIn).toBeLessThan(200);
      expect(order.running()).toBe(true);
      expect(order.outcome()).toBeUndefined();
      expect(nerve.orders().some((live) => live.id === order.id)).toBe(true);

      const outcome = await waitFor(() => order.outcome(), 20_000);
      expect(outcome.ok).toBe(true);
      expect(order.running()).toBe(false);
    } finally {
      await nerve.stop();
      await server.close();
    }
  }, 40_000);

  it("攻击打完一整趟：发下去、执行、回执带着世界事实回来", async () => {
    const server = await startFakeServer({ mobs: [{ type: "zombie", x: 16, y: 64, z: 10 }], onAttack: "kill" });
    const nerve = nerveFor(server.port, server.version);

    try {
      nerve.start();
      const id = zombieId(await world(nerve));

      const outcome = await ordered(nerve, { op: "attack", entityId: id, timeoutMs: 3_000 });

      expect(outcome.ok).toBe(true);
      expect(outcome.detail).toContain(`${id}`);
      expect(outcome.detail).toContain("不在世界上");
      expect(outcome.generation).toBe(1);
      expect(outcome.ms).toBeGreaterThanOrEqual(0);
    } finally {
      await nerve.stop();
      await server.close();
    }
  }, 40_000);

  it("只要打中就算完成：服务端只广播受伤，那一刀也已经成立了", async () => {
    const server = await startFakeServer({ mobs: [{ type: "zombie", x: 16, y: 64, z: 10 }], onAttack: "hurt" });
    const nerve = nerveFor(server.port, server.version);

    try {
      nerve.start();
      const id = zombieId(await world(nerve));

      const outcome = await ordered(nerve, { op: "attack", entityId: id, timeoutMs: 3_000 });

      expect(outcome.ok).toBe(true);
      expect(outcome.detail).toContain("受伤了");
    } finally {
      await nerve.stop();
      await server.close();
    }
  }, 40_000);

  it("服务端不理就试到超时，结果里带上失败现场", async () => {
    const server = await startFakeServer({ mobs: [{ type: "zombie", x: 16, y: 64, z: 10 }] });
    const nerve = nerveFor(server.port, server.version);

    try {
      nerve.start();
      const id = zombieId(await world(nerve));

      const outcome = await ordered(nerve, { op: "attack", entityId: id, timeoutMs: 300 });

      expect(outcome.ok).toBe(false);
      expect(outcome.detail).toContain("超时");
      expect(outcome.detail).toContain("一直没受伤");
    } finally {
      await nerve.stop();
      await server.close();
    }
  }, 40_000);

  it("换代之后旧回执不认：执行时是第几代，回执就作废", async () => {
    const server = await startFakeServer({ mobs: [{ type: "zombie", x: 16, y: 64, z: 10 }], onAttack: "drop" });
    const nerve = nerveFor(server.port, server.version, 200);

    try {
      nerve.start();
      const id = zombieId(await world(nerve));

      const outcome = await ordered(nerve, { op: "attack", entityId: id, timeoutMs: 4_000 });

      expect(outcome.ok).toBe(false);
      expect(outcome.detail).toContain("回执作废");

      // 断线之后会重连，新一代照样读得到世界
      await waitFor(() => (nerve.sampler.generation() >= 2 ? true : undefined), 20_000);
      expect(nerve.sampler.generation()).toBeGreaterThanOrEqual(2);
    } finally {
      await nerve.stop();
      await server.close();
    }
  }, 40_000);

  it("引擎没起来时原语发不出去", () => {
    const nerve = nerveFor(1, "1.21.8");

    expect(() => nerve.order({ op: "jump" })).toThrow("引擎没起来");
  }, 20_000);
});
