/**
 * 父进程与引擎子进程之间的线路格式。
 *
 * 只有两条：父侧发 `stop`；引擎推 `view` 与 `note`。
 * 请求/响应式的原语（读方块、执行动作）等传出层落地时再加。
 */

/** 引擎推上来的一帧世界。`values` 是 null 表示此刻读不到世界（还没进世界，或连接断了）。 */
export interface BotView {
  readonly generation: number;
  readonly values: Record<string, unknown> | null;
}

export type EngineNote = {
  readonly kind: "note";
  readonly level: "info" | "warn" | "error";
  readonly message: string;
};

export type EngineView = { readonly kind: "view" } & BotView;

export type EngineMessage = EngineNote | EngineView;

/** 引擎接到的指令。目前只有停止。 */
export type NerveMessage = { readonly kind: "stop" };
