import type { Answer, CompiledArc } from "@sekizui/arc";

/** 一次判断的完整记录。账本存的就是它。 */
export interface Judgment {
  readonly arc: string;
  /** 服务方回的实际模型版本，不是请求里写的别名 */
  readonly model: string;
  readonly sig: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly confidence: number;
  /** 发出这一问的窗口时刻。时间是宿主的心跳时钟，不是模型回答的墙钟 */
  readonly at: number;
  /** 最近一次"状态仍与它见过的一致"的窗口时刻，TTL 按它算。状态没变时会往前推 */
  readonly seenAt: number;
  readonly generation: number;
  readonly ttlMs: number;
  readonly ms: number;
  readonly usage?: Readonly<{ input_tokens: number; output_tokens: number }>;
}

export type FallbackReason = "no-sampler" | "never-judged" | "stale" | "generation-changed" | "low-confidence";

/** 传出层每帧问出来的东西：一条新鲜判断，或该退回的保底动作。 */
export type Directive =
  | {
      readonly kind: "judge";
      readonly arc: string;
      readonly answers: Readonly<Record<string, Answer>>;
      readonly confidence: number;
      readonly at: number;
      readonly ageMs: number;
    }
  | { readonly kind: "fallback"; readonly arc: string; readonly action: string; readonly why: FallbackReason };

/**
 * 判决与保底的判别，纯函数。

 * 顺序：没有采样面 → 没判过 → 换代了 → 过期了 → 置信不够。
 */
export function directiveOf(input: {
  readonly arc: CompiledArc;
  readonly judgment: Judgment | undefined;
  readonly generation: number | undefined;
  readonly now: number;
}): Directive {
  const arc = input.arc.spec.id;
  const action = input.arc.spec.fallbackAction;
  if (input.generation === undefined) return { kind: "fallback", arc, action, why: "no-sampler" };
  const judgment = input.judgment;
  if (!judgment) return { kind: "fallback", arc, action, why: "never-judged" };
  if (judgment.generation !== input.generation) return { kind: "fallback", arc, action, why: "generation-changed" };
  if (input.now - judgment.seenAt > judgment.ttlMs) return { kind: "fallback", arc, action, why: "stale" };
  if (judgment.confidence < input.arc.spec.guards.minConfidence) return { kind: "fallback", arc, action, why: "low-confidence" };
  return { kind: "judge", arc, answers: judgment.answers, confidence: judgment.confidence, at: judgment.at, ageMs: input.now - judgment.at };
}
