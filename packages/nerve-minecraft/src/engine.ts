import { createBot, type Bot } from "mineflayer";

import type { EngineMessage, NerveMessage } from "./protocol.js";
import { readBot } from "./view.js";

/** 引擎子进程的启动参数，由父进程用 argv[2] 递进来。 */
export interface EngineOptions {
  readonly host: string;
  readonly port?: number;
  readonly username: string;
  readonly version?: string;
  readonly auth?: "offline" | "microsoft";
  /** 每多少毫秒推一帧世界 */
  readonly pushMs?: number;
  /** 断线之后隔多久重连 */
  readonly reconnectMs?: number;
}

function send(message: EngineMessage): void {
  process.send?.(message);
}

function note(level: "info" | "warn" | "error", message: string): void {
  send({ kind: "note", level, message });
}

const options = JSON.parse(process.argv[2] ?? "{}") as EngineOptions;
const port = options.port ?? 25_565;
const pushMs = options.pushMs ?? 100;
const reconnectMs = options.reconnectMs ?? 5_000;

let generation = 0;
let bot: Bot | undefined;
let stopping = false;

function connect(): void {
  if (stopping) return;
  note("info", `连接 ${options.host}:${port}，身份 ${options.username}`);
  let created: Bot;
  try {
    created = createBot({
      host: options.host,
      port,
      username: options.username,
      // 版本留空就交给 mineflayer 自己选：空串会被当成"一个叫空的版本"，那不是它想说的
      ...(options.version ? { version: options.version } : {}),
      auth: options.auth ?? "offline",
      hideErrors: true,
    });
  } catch (error) {
    note("error", `起不了 bot：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  bot = created;

  created.once("spawn", () => {
    generation += 1;
    note("info", `进入世界，第 ${generation} 代（${created.version}）`);
  });
  created.on("error", (error: Error) => note("error", `出错：${error.message}`));
  created.on("kicked", (reason: unknown) => note("warn", `被踢：${JSON.stringify(reason)}`));
  created.on("end", (reason: string) => {
    // 断了就读不到世界了：清掉引用，让推上去的帧如实是"读不到"
    bot = undefined;
    note("warn", `连接断了：${reason}`);
    if (!stopping) setTimeout(connect, reconnectMs);
  });
}

// 一直推，读不到就推 null —— 父侧据此把这一拍当作没有可用读数
setInterval(() => {
  if (stopping) return;
  send({ kind: "view", generation, values: bot ? readBot(bot) : null });
}, pushMs);

process.on("message", (message: NerveMessage) => {
  if (message?.kind !== "stop") return;
  stopping = true;
  bot?.quit("停止");
  process.exit(0);
});

connect();
