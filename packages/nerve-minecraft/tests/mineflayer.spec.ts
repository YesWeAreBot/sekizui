import { fileURLToPath } from "node:url";

import { NerveMinecraft } from "@sekizui/nerve-minecraft";
import { describe, expect, it } from "vitest";

import { startFakeServer } from "./fake-server.js";
import { waitFor } from "./harness.js";

const engineSource = fileURLToPath(new URL("../src/engine.ts", import.meta.url));

/** 真的连一次：真 mineflayer、真协议、真引擎子进程，只把服务端换成刚够用的一台。 */
describe("真的接上 mineflayer", () => {
  it("进世界之后读得出自身状态，脊髓层据此判出一条弧", async () => {
    // 两只：既看排序，也钉住"每个实体一个独立 id"这件事
    const server = await startFakeServer({
      mobs: [
        { type: "zombie", x: 16, y: 64, z: 10 },
        { type: "cow", x: 13, y: 64, z: 10 },
      ],
    });
    const nerve = new NerveMinecraft({
      host: "127.0.0.1",
      port: server.port,
      username: "sekizui",
      version: server.version,
      runtime: "bun",
      enginePath: engineSource,
      pushMs: 50,
      reconnectMs: 60_000,
    });

    try {
      nerve.start();
      const attempt = async <T>(read: () => T | undefined): Promise<T> => {
        try {
          return await waitFor(read, 20_000);
        } catch (error) {
          const said = nerve.notes().join(" / ") || "（什么都没说）";
          throw new Error(`${error instanceof Error ? error.message : String(error)}｜引擎说过：${said}｜连上来的：${server.joined.join(",") || "无"}`);
        }
      };

      const values = await attempt(() => {
        const failed = nerve.notes().find((line) => line.includes("error:"));
        if (failed) throw new Error(`引擎报错：${failed}`);
        try {
          return nerve.sampler.read();
        } catch {
          return undefined;
        }
      });

      expect(server.joined).toEqual(["sekizui"]);
      expect(nerve.sampler.generation()).toBe(1);
      expect(values.bot).toMatchObject({ username: "sekizui", hp: 12, hp_percent: 60, food: 18, position: { x: 10, y: 64, z: 10 } });

      const entities = await attempt(() => {
        const list = (nerve.sampler.read().entities ?? []) as ReadonlyArray<Record<string, unknown>>;
        return list.length > 0 ? list : undefined;
      });
      expect(entities).toHaveLength(2);
      expect(entities[0]).toMatchObject({ name: "cow", type: "animal", kind: "Passive mobs", hostile: false, dist: 3 });
      expect(entities[1]).toMatchObject({ name: "zombie", type: "hostile", kind: "Hostile mobs", hostile: true, dist: 6 });
      expect(nerve.sampler.read().entities_total).toBe(2);
      expect(nerve.notes().some((line) => line.includes("进入世界"))).toBe(true);
    } finally {
      await nerve.stop();
      await server.close();
    }
  }, 40_000);
});
