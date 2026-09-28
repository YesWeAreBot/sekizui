import { fileURLToPath } from "node:url";

import { NerveMinecraft } from "@sekizui/nerve-minecraft";
import { describe, expect, it } from "vitest";

import { closedPort, waitFor } from "./harness.js";

/** 引擎源码入口。测试里用 bun 直接跑 TypeScript，生产默认走构建出来的 lib/engine.js。 */
const engineSource = fileURLToPath(new URL("../src/engine.ts", import.meta.url));

describe("NerveMinecraft", () => {
  it("连不上服务器时如实报告：读世界抛错，代次还是 0，状态说没起来", async () => {
    const nerve = new NerveMinecraft({
      host: "127.0.0.1",
      port: await closedPort(),
      username: "sekizui",
      runtime: "bun",
      enginePath: engineSource,
      pushMs: 50,
      reconnectMs: 60_000,
    });
    nerve.start();

    await waitFor(() => nerve.notes().find((line) => line.includes("出错") || line.includes("连接断了")));

    expect(nerve.notes().some((line) => line.startsWith("info: 连接 127.0.0.1:"))).toBe(true);
    expect(nerve.status.generation).toBe(0);
    expect(nerve.status.readable).toBe(false);
    expect(() => nerve.sampler.read()).toThrow("读不到世界");
    expect(nerve.sampler.generation()).toBe(0);

    await nerve.stop();
    expect(nerve.status.alive).toBe(false);
  }, 40_000);

  it("引擎起不来时也不装作起得来", async () => {
    const nerve = new NerveMinecraft({ host: "127.0.0.1", username: "sekizui", enginePath: fileURLToPath(new URL("../no-such-engine.js", import.meta.url)) });
    nerve.start();

    await waitFor(() => nerve.notes().find((line) => line.includes("引擎退出")));

    expect(nerve.status.alive).toBe(false);
    expect(nerve.status.readable).toBe(false);
    await nerve.stop();
  }, 20_000);
});
