import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { compileArc, type Question, type SampleCatalog } from "@sekizui/arc";
import { DecideError, HttpDecider } from "@sekizui/spinal";
import { describe, expect, it } from "vitest";

const catalog: SampleCatalog = {
  declares: [
    { path: "hp_percent", type: "number" },
    { path: "enemies[*].dist", type: "number" },
  ],
};

const questions: readonly Question[] = compileArc(
  {
    id: "kite",
    on: "场上有敌对",
    off: "敌对清空",
    projection: ["hp_percent", "enemies[*].dist"],
    questions: [
      { id: "horiz", type: "choice", instructions: "该拉开还是贴近", criteria: { Away: "太近", Near: "太远" } },
      { id: "panic", type: "noul", instructions: "现在算危险吗" },
    ],
    liveActions: ["Away", "Hold", "Near"],
    fallbackAction: "Hold",
    guards: { ttlMs: 1_500, minConfidence: 0.6 },
  },
  catalog,
).spec.questions;

const request = { model: "jev-1.13.0", state: { hp_percent: 45, "enemies[*].dist": [6] }, questions };

interface Seen {
  method?: string;
  path?: string;
  auth?: string;
  contentType?: string;
  body?: Record<string, unknown>;
}

/** 起一个假端点，记下收到的请求，按剧本回话。 */
async function withServer(reply: (seen: Seen) => { status: number; payload: unknown }, run: (endpoint: string, seen: Seen[]) => Promise<void>): Promise<void> {
  const seen: Seen[] = [];
  const server: Server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const record: Seen = {
        method: incoming.method,
        path: incoming.url,
        auth: incoming.headers.authorization,
        contentType: incoming.headers["content-type"],
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      seen.push(record);
      const { status, payload } = reply(record);
      outgoing.writeHead(status, { "content-type": "application/json" });
      outgoing.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const ok = {
  model: "jev-1.13.0",
  answers: {
    horiz: { type: "choice", choice: "Away", probabilities: { Away: 0.88, Near: 0.12 }, confidence: 0.81 },
    panic: { type: "noul", noul: 0.2 },
  },
  usage: { input_tokens: 318, output_tokens: 34 },
};

describe("HttpDecider", () => {
  it("按契约发请求：问题按 id 建表，id 本身不进问题对象", async () => {
    await withServer(
      () => ({ status: 200, payload: ok }),
      async (endpoint, seen) => {
        const decider = new HttpDecider({ apiKey: "sk-test", endpoint });
        const result = await decider.decide(request);

        expect(seen[0]?.method).toBe("POST");
        expect(seen[0]?.auth).toBe("Bearer sk-test");
        expect(seen[0]?.contentType).toBe("application/json");
        expect(seen[0]?.body).toEqual({
          state: { hp_percent: 45, "enemies[*].dist": [6] },
          model: "jev-1.13.0",
          questions: {
            horiz: { type: "choice", instructions: "该拉开还是贴近", criteria: { Away: "太近", Near: "太远" } },
            panic: { type: "noul", instructions: "现在算危险吗" },
          },
        });
        expect(result).toEqual(ok);
      },
    );
  });

  it("非 2xx 就是失败", async () => {
    await withServer(
      () => ({ status: 503, payload: { error: "busy" } }),
      async (endpoint) => {
        const decider = new HttpDecider({ apiKey: "sk-test", endpoint });
        await expect(decider.decide(request)).rejects.toThrow(DecideError);
        await expect(decider.decide(request)).rejects.toThrow("判断服务返回 503");
      },
    );
  });

  it("少了回答就是失败", async () => {
    await withServer(
      () => ({ status: 200, payload: { model: "jev-1.13.0", answers: { panic: { type: "noul", noul: 0.2 } } } }),
      async (endpoint) => {
        await expect(new HttpDecider({ apiKey: "k", endpoint }).decide(request)).rejects.toThrow("少了 horiz 的回答");
      },
    );
  });

  it("回答类型对不上就是失败", async () => {
    await withServer(
      () => ({
        status: 200,
        payload: {
          model: "jev-1.13.0",
          answers: {
            horiz: { type: "score", score: 1.5, legend: { "1": "低" }, confidence: 0.9 },
            panic: { type: "noul", noul: 0.2 },
          },
        },
      }),
      async (endpoint) => {
        await expect(new HttpDecider({ apiKey: "k", endpoint }).decide(request)).rejects.toThrow("horiz 问的是 choice，答的是 score");
      },
    );
  });

  it("响应不符合契约就是失败", async () => {
    await withServer(
      () => ({ status: 200, payload: { answers: { horiz: { type: "choice", choice: "Away" } } } }),
      async (endpoint) => {
        await expect(new HttpDecider({ apiKey: "k", endpoint }).decide(request)).rejects.toThrow("不符合契约");
      },
    );
  });
});
