import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Ledger, type Judgment } from "@sekizui/spinal";
import { afterEach, describe, expect, it } from "vitest";

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempPath(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sekizui-"));
  made.push(dir);
  return path.join(dir, name);
}

function judgmentOf(index: number): Judgment {
  return {
    arc: `arc-${index}`,
    model: "jev-1.13.0",
    sig: `sig-${index}`,
    state: { hp_percent: index },
    answers: { horiz: { type: "choice", choice: "Away", probabilities: { Away: 1 }, confidence: 0.81 } },
    confidence: 0.81,
    at: index,
    seenAt: index,
    generation: 1,
    ttlMs: 1_500,
    ms: 300,
  };
}

describe("Ledger", () => {
  it("没有路径时只留内存里的尾巴", async () => {
    const ledger = new Ledger();
    ledger.record(judgmentOf(1));
    ledger.record(judgmentOf(2));
    await ledger.drain();

    expect(ledger.lines().map((line) => line.arc)).toEqual(["arc-1", "arc-2"]);
    expect(await ledger.read()).toEqual([]);
    expect(ledger.lastError).toBeUndefined();
  });

  it("超出保留条数就丢掉最旧的", () => {
    const ledger = new Ledger("", 2);
    ledger.record(judgmentOf(1));
    ledger.record(judgmentOf(2));
    ledger.record(judgmentOf(3));

    expect(ledger.lines().map((line) => line.arc)).toEqual(["arc-2", "arc-3"]);
  });

  it("有路径时一行一条落盘，能读回来", async () => {
    const path = await tempPath("judgments.jsonl");
    const ledger = new Ledger(path);
    ledger.record(judgmentOf(1));
    ledger.record(judgmentOf(2));
    await ledger.drain();

    const text = await readFile(path, "utf8");
    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(2);
    expect((await ledger.read()).map((line) => line.arc)).toEqual(["arc-1", "arc-2"]);
  });

  it("落盘失败不抛给调用方，内存里的记录不丢", async () => {
    const ledger = new Ledger(path.join(await tempPath("x"), "missing", "judgments.jsonl"));
    ledger.record(judgmentOf(1));
    await ledger.drain();

    expect(ledger.lastError).toBeInstanceOf(Error);
    expect(ledger.lines()).toHaveLength(1);
  });
});
