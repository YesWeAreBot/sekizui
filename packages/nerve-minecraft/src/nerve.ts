import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Sampler } from "@sekizui/arc";

import { catalog } from "./catalog.js";
import type { EngineMessage, NerveMessage } from "./protocol.js";

export interface NerveOptions {
  readonly host: string;
  readonly username: string;
  readonly port?: number;
  readonly version?: string;
  readonly auth?: "offline" | "microsoft";
  readonly pushMs?: number;
  readonly reconnectMs?: number;
  /** 引擎子进程的运行时。默认 node，主进程留在 Bun 上 */
  readonly runtime?: string;
  /** 引擎入口。默认本包构建出来的 lib/engine.js */
  readonly enginePath?: string;
}

export interface NerveStatus {
  readonly alive: boolean;
  readonly generation: number;
  /** 世界此刻读不读得到 */
  readonly readable: boolean;
}

/**
 * Minecraft 世界一侧的父进程。
 *
 * 引擎（mineflayer）跑在子进程里：事件循环、崩溃、重连换代、运行时选择都被那条边界隔开。
 * 本进程只做三件事：起引擎、收帧、把帧喂给脊髓层。
 */
export class NerveMinecraft {
  readonly sampler: Sampler;

  private child?: ChildProcess;
  private frame?: { generation: number; values: Record<string, unknown> | null };
  private readonly log: string[] = [];

  constructor(private readonly options: NerveOptions) {
    this.sampler = {
      declares: catalog.declares,
      read: () => {
        const values = this.frame?.values;
        if (!values) throw new Error("读不到世界：bot 还没进世界，或连接已经断了");
        return values;
      },
      generation: () => this.frame?.generation ?? 0,
    };
  }

  get status(): NerveStatus {
    return {
      alive: this.child !== undefined,
      generation: this.frame?.generation ?? 0,
      readable: this.frame?.values !== undefined && this.frame.values !== null,
    };
  }

  /** 最近的引擎与游戏消息，最近的在后。 */
  notes(): readonly string[] {
    return this.log;
  }

  start(): void {
    if (this.child) return;
    const entry = this.options.enginePath ?? fileURLToPath(new URL("./engine.js", import.meta.url));
    const payload = JSON.stringify({
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      version: this.options.version,
      auth: this.options.auth,
      pushMs: this.options.pushMs,
      reconnectMs: this.options.reconnectMs,
    });

    const child = spawn(this.options.runtime ?? "node", [entry, payload], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    this.child = child;
    child.on("message", (message: EngineMessage) => this.receive(message));
    child.on("error", (error: Error) => this.note(`error: 起不了引擎 ${error.message}`));
    child.on("exit", (code, signal) => {
      this.child = undefined;
      this.frame = undefined;
      this.note(`warn: 引擎退出 code=${code} signal=${signal}`);
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => this.note(chunk.toString("utf8").trim()));
    }
  }

  /** 停引擎：先好好说，三秒不让步就直接杀。 */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.frame = undefined;
    if (!child) return;
    const stopped = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      stopped.resolve();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      stopped.resolve();
    });
    child.send({ kind: "stop" } satisfies NerveMessage);
    await stopped.promise;
  }

  private receive(message: EngineMessage): void {
    if (message.kind === "view") {
      this.frame = { generation: message.generation, values: message.values };
      return;
    }
    this.note(`${message.level}: ${message.message}`);
  }

  private note(line: string): void {
    if (line === "") return;
    this.log.push(line);
    if (this.log.length > 64) this.log.shift();
  }
}
