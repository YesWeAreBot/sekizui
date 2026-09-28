/**
 * 父进程与引擎子进程之间的线路格式。
 *
 * 三条：父侧发 `stop` 与 `req`（要回执的原语）；引擎推 `view`、`note` 与 `rep`。
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

/** 世界坐标。方块的整数坐标与实体的浮点坐标共用它。 */
export type Point = readonly [x: number, y: number, z: number];

/**
 * 执行原语。参数就是它要的世界事实，判据在引擎一侧。
 *
 * `timeoutMs` 是最后一道闸：终止判据读世界事实，读不到进展就靠它收手。
 */
export type NervePrimitive =
  | { readonly op: "walk"; readonly to: Point; readonly timeoutMs?: number }
  | { readonly op: "jump"; readonly timeoutMs?: number }
  | { readonly op: "dig"; readonly at: Point; readonly timeoutMs?: number }
  | { readonly op: "attack"; readonly entityId: number; readonly timeoutMs?: number };

export type PrimitiveOp = NervePrimitive["op"];

/** 一次原语的结果。`detail` 成功时是终止判据看到的事实，失败时是现场。 */
export interface PrimitiveOutcome {
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
  /** 执行时的连接代次。父侧据此作废换过代的回执 */
  readonly generation: number;
}

/** 父 → 子：要回执的请求。 */
export type NerveRequest = { readonly kind: "req"; readonly id: number; readonly primitive: NervePrimitive };

export type EngineReply = { readonly kind: "rep"; readonly id: number } & PrimitiveOutcome;

export type EngineMessage = EngineNote | EngineView | EngineReply;

/** 引擎接到的指令：停止，或执行一个原语。 */
export type NerveMessage = { readonly kind: "stop" } | NerveRequest;
