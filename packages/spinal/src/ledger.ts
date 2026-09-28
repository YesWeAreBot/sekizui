import { appendFile, readFile } from "node:fs/promises";

import type { Judgment } from "./judgment.js";

/**
 * 决策账本：一行一次判断，追加写。
 *
 * 有路径就落盘，没路径就只留内存里的尾巴（测试和观测页够用）。
 * 落盘失败不抛给调用方，记在 lastError 上，内存里的记录不丢。
 */
export class Ledger {
  private readonly tail: Judgment[] = [];
  private writing: Promise<void> = Promise.resolve();
  private error: Error | undefined;

  constructor(
    private readonly path: string = "",
    private readonly memory = 128,
  ) {}

  get lastError(): Error | undefined {
    return this.error;
  }

  /** 内存里保留的记录，最近的在后。 */
  lines(): readonly Judgment[] {
    return this.tail;
  }

  record(judgment: Judgment): void {
    this.tail.push(judgment);
    if (this.tail.length > this.memory) this.tail.shift();
    if (this.path === "") return;
    const line = `${JSON.stringify(judgment)}\n`;
    this.writing = this.writing
      .then(() => appendFile(this.path, line, "utf8"))
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error : new Error(String(error));
      });
  }

  /** 等落盘追上来。 */
  async drain(): Promise<void> {
    await this.writing;
  }

  /** 把账本文件读回来。没有路径时是空。 */
  async read(): Promise<Judgment[]> {
    if (this.path === "") return [];
    const text = await readFile(this.path, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Judgment);
  }
}
