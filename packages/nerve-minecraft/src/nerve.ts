import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Sampler } from "@sekizui/arc";

import { catalog } from "./catalog.js";
import { defaultTimeouts } from "./primitives.js";
import type { EngineMessage, EngineReply, NerveMessage, NervePrimitive, PrimitiveOutcome } from "./protocol.js";

/** 等回执的余额：给引擎侧原语的超时留一点余地，别把还在跑的它提前判死 */
const REPLY_SLACK_MS = 1_000;

/** 留几条已完成的原语给主循环回看，多了就扔最旧的 */
const ORDER_HISTORY = 32;

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
 * 一次下达的句柄。
 *
 * 原语是**背景状态**，不是一次调用：下达不阻塞，结果由主循环来读（和脊髓层读判决缓存同一个形状）。
 * 谁都不等谁，"现在这条动作跑完了没有"随时可问。
 */
export interface Order {
  readonly id: number;
  readonly primitive: NervePrimitive;
  /** 还在跑（或还在引擎那边排队）吗 */
  running(): boolean;
  /** 已经出的结果；还没出就是 undefined。引擎的成功、引擎的失败、超时、换代，都算结果 */
  outcome(): PrimitiveOutcome | undefined;
}

interface OrderRecord {
  readonly generation: number;
  readonly primitive: NervePrimitive;
  readonly timer: NodeJS.Timeout;
  outcome?: PrimitiveOutcome;
}

/**
 * Minecraft 世界一侧的父进程。
 *
 * 引擎（mineflayer）跑在子进程里：事件循环、崩溃、重连换代、运行时选择都被那条边界隔开。
 * 本进程做四件事：起引擎、收帧、把帧喂给脊髓层、把原语发下去并记下结果。
 */
export class NerveMinecraft {
  readonly sampler: Sampler;

  private child?: ChildProcess;
  private frame?: { generation: number; values: Record<string, unknown> | null };
  private readonly log: string[] = [];
  private readonly live = new Map<number, OrderRecord>();
  private nextId = 1;

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
      this.abandon("引擎退出了，原语没有回执");
      this.note(`warn: 引擎退出 code=${code} signal=${signal}`);
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => this.note(chunk.toString("utf8").trim()));
    }
  }

  /**
   * 下达一个原语，立刻拿回一个句柄——不等它跑完。
   *
   * 引擎没起来时当场抛错：这时候下达本来就没有意义，不必留一个注定失败的句柄。
   */
  order(primitive: NervePrimitive, timeoutMs = defaultTimeouts[primitive.op] + REPLY_SLACK_MS): Order {
    const child = this.child;
    if (!child) throw new Error("引擎没起来，原语发不出去");
    const generation = this.sampler.generation();
    const id = this.nextId;
    this.nextId += 1;

    const record: OrderRecord = {
      generation,
      primitive,
      timer: setTimeout(() => {
        this.settle(id, { ok: false, detail: `超时：${primitive.op} 等回执过了 ${timeoutMs}ms`, ms: timeoutMs, generation });
      }, timeoutMs),
    };
    this.live.set(id, record);
    this.trim();

    child.send({ kind: "req", id, primitive } satisfies NerveMessage);
    return this.handleOf(id, record);
  }

  /** 最近下达的原语（含已完成的最近若干），插入序。 */
  orders(): readonly Order[] {
    return [...this.live].map(([id, record]) => this.handleOf(id, record));
  }

  /**
   * 句柄只夹着那条记录，不夹 Map 键。所以历史被裁掉之后，手上已有的句柄照样读得到结果。
   */
  private handleOf(id: number, record: OrderRecord): Order {
    return {
      id,
      primitive: record.primitive,
      running: () => record.outcome === undefined,
      outcome: () => record.outcome,
    };
  }

  /** 停引擎：先好好说，三秒不让步就直接杀。 */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.frame = undefined;
    this.abandon("引擎停了，原语没有回执");
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
    if (message.kind === "rep") {
      this.accept(message);
      return;
    }
    this.note(`${message.level}: ${message.message}`);
  }

  /** 回执落地。换代与超时都算作废：旧代次的动作结果被当成新代次的事实，比不执行更糟。 */
  private accept(reply: EngineReply): void {
    const record = this.live.get(reply.id);
    // 超时之后迟到的回执：这条已经结账了，别改它
    if (!record || record.outcome !== undefined) return;

    if (reply.generation !== record.generation || reply.generation !== this.sampler.generation()) {
      this.settle(reply.id, {
        ok: false,
        detail: `回执作废：执行时是第 ${reply.generation} 代，发出时是第 ${record.generation} 代`,
        ms: reply.ms,
        generation: reply.generation,
      });
      return;
    }
    this.settle(reply.id, { ok: reply.ok, detail: reply.detail, ms: reply.ms, generation: reply.generation });
  }

  private settle(id: number, outcome: PrimitiveOutcome): void {
    const record = this.live.get(id);
    if (!record || record.outcome !== undefined) return;
    clearTimeout(record.timer);
    record.outcome = outcome;
  }

  /** 把还在跑的都结掉，别让它们永远挂着"进行中"。 */
  private abandon(reason: string): void {
    for (const [id, record] of this.live) {
      if (record.outcome === undefined) this.settle(id, { ok: false, detail: reason, ms: 0, generation: record.generation });
    }
  }

  private trim(): void {
    if (this.live.size <= ORDER_HISTORY) return;
    for (const [id, record] of this.live) {
      if (this.live.size <= ORDER_HISTORY) return;
      // 只丢已经有结果的；还在跑的留着，它是活的
      if (record.outcome !== undefined) this.live.delete(id);
    }
  }

  private note(line: string): void {
    if (line === "") return;
    this.log.push(line);
    if (this.log.length > 64) this.log.shift();
  }
}
