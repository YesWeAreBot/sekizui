import { z } from "zod";

// ---------------------------------------------------------------------------
// 采样面
// ---------------------------------------------------------------------------

export type SampleType = "number" | "string" | "boolean" | "object" | "array";

/**
 * 采样面上的一个变量。
 *
 * `path` 有两种用法：只写根名（`enemies`）时，采样时校验它存在且类型相符；
 * 写成叶子（`enemies[*].dist`）时，它只是弧可以引用的白名单。
 */
export interface SampleDecl {
  readonly path: string;
  readonly type: SampleType;
  readonly unit?: string;
  /** 这个读数什么时候有效，如 `enemies.length > 0` */
  readonly validWhen?: string;
  /** 大约占多少 token，给编排层看成本 */
  readonly cost?: number;
}

/** 变量目录：采样面能提供哪些变量，归代码所有，编排层只读。 */
export interface SampleCatalog {
  readonly declares: readonly SampleDecl[];
}

/** 采样面。世界观（bot、连接、游戏句柄）由实现方闭在内部。 */
export interface Sampler extends SampleCatalog {
  /** 取一份当前读数，结构由采样面自己决定 */
  read(): Record<string, unknown>;
  /** 连接代次。重连后必须换一个新值，旧代的判断一律作废 */
  generation(): number;
}

/** 一次采样的结果。窗口内所有弧共享同一份。 */
export interface Snapshot {
  readonly values: Readonly<Record<string, unknown>>;
  readonly observedAt: number;
  readonly generation: number;
}

// ---------------------------------------------------------------------------
// 问题与回答：与判断服务方的 HTTP 契约一一对应
// ---------------------------------------------------------------------------

/** instructions 可以是字符串，也可以带上下文的结构化对象。 */
export const instructionSchema = z.union([z.string().min(1), z.record(z.unknown()), z.array(z.unknown())]);

/** 是否成立。返回 yes 的概率，服务方不提供 confidence。 */
export const noulQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.literal("noul"),
  instructions: instructionSchema,
  criteria: z.object({ true: instructionSchema.optional(), false: instructionSchema.optional() }).optional(),
});

/** 从一组定义好的选项里选一个。 */
export const choiceQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.literal("choice"),
  instructions: instructionSchema,
  criteria: z
    .record(z.union([z.string(), z.record(z.unknown()), z.array(z.unknown()), z.null()]))
    .refine((criteria) => Object.keys(criteria).length <= 255, "choice 最多 255 个选项"),
});

/** 沿着一组有序档位打分。 */
export const scoreQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.literal("score"),
  instructions: instructionSchema,
  criteria: z.array(instructionSchema).min(2).max(10),
});

export const questionSchema = z.discriminatedUnion("type", [noulQuestionSchema, choiceQuestionSchema, scoreQuestionSchema]);

export const noulAnswerSchema = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });

export const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.number()),
  confidence: z.number().min(0).max(1),
});

export const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string()),
  confidence: z.number().min(0).max(1),
});

export const answerSchema = z.discriminatedUnion("type", [noulAnswerSchema, choiceAnswerSchema, scoreAnswerSchema]);

/** 判断服务方的响应体。usage 不作为必需，缺了不影响运行。 */
export const systemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(answerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional(),
});

export type Question = z.infer<typeof questionSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type SystemOneResponse = z.infer<typeof systemOneResponseSchema>;

/**
 * 一条回答的可信程度。
 *
 * choice 与 score 直接取服务方给的 confidence；noul 没有 confidence，
 * 按概率离抛硬币多远折算（服务方原话是"0.5 附近意味着两个答案概率相近"）。
 */
export function confidenceOf(answer: Answer): number {
  return answer.type === "noul" ? Math.abs(2 * answer.noul - 1) : answer.confidence;
}

/** 一组回答的整体置信：取最弱的一条。 */
export function confidenceOfAnswers(answers: Readonly<Record<string, Answer>>): number {
  const values = Object.values(answers).map(confidenceOf);
  return values.length === 0 ? 0 : Math.min(...values);
}

// ---------------------------------------------------------------------------
// 弧
// ---------------------------------------------------------------------------

export const arcSpecSchema = z.object({
  id: z.string().min(1),
  /** 生效条件：什么时候这条弧可被激活 */
  on: z.string().min(1),
  /** 失效条件：什么时候这条弧作废。只写生效不写失效，留下的是僵尸弧 */
  off: z.string().min(1),
  /** 状态投影：这一步真正要用的字段 */
  projection: z.array(z.string().min(1)).min(1),
  questions: z.array(questionSchema).min(1),
  /** 候选动作子集，取自动作库 */
  liveActions: z.array(z.string().min(1)).min(1),
  /** 保底动作：候选集全不合适时的出口 */
  fallbackAction: z.string().min(1),
  guards: z.object({
    /** 判断的存活时长（毫秒），超过就退回保底动作 */
    ttlMs: z.number().int().positive(),
    /** 最低置信，低于它退回保底动作 */
    minConfidence: z.number().min(0).max(1),
  }),
});

/** 弧库文件格式。 */
export const arcDocumentSchema = z.object({ arcs: z.array(z.unknown()) });

export type ArcSpec = z.infer<typeof arcSpecSchema>;
export type ArcGuards = ArcSpec["guards"];

// ---------------------------------------------------------------------------
// 路径与投影
// ---------------------------------------------------------------------------

/** 解析后的路径段：`enemies[*].dist` → [enemies][each][dist]。下标与通配同义。 */
export type Segment = { readonly key: string } | { readonly each: true };

export class ArcSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcSpecError";
  }
}

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\]|\[\*\])*)$/;
const BRACKET = /\[(?:\d+|\*)\]/g;

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    const match = SEGMENT.exec(part);
    if (!match) throw new ArcSpecError(`路径段无法解析：${part}`);
    segments.push({ key: match[1] });
    for (const _bracket of part.matchAll(BRACKET)) segments.push({ each: true });
  }
  return segments;
}

/** 目录里的路径与弧里写的路径按同一形状比对：下标一律当通配。 */
export function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, "[*]");
}

/** 路径段拼回可读路径，用作 state 的字段名。 */
export function renderPath(segments: readonly Segment[]): string {
  let path = "";
  for (const segment of segments) {
    if ("each" in segment) path += "[*]";
    else path += path.length === 0 ? segment.key : `.${segment.key}`;
  }
  return path;
}

export interface CompiledArc {
  readonly spec: ArcSpec;
  /** 投影路径在加载时就解析成路径段，渲染时不再解析字符串 */
  readonly projection: ReadonlyArray<readonly Segment[]>;
}

/**
 * 校验并预编译一条弧。
 *
 * 引用了目录外的路径当场报错，不等到渲染时冒出一个 undefined。
 */
export function compileArc(input: unknown, catalog: SampleCatalog): CompiledArc {
  const spec = arcSpecSchema.parse(input);
  const known = catalog.declares.map((decl) => normalizePath(decl.path));
  const projection = spec.projection.map((path) => {
    if (!known.includes(normalizePath(path))) throw new ArcSpecError(`${spec.id}：目录里没有这个变量 ${path}`);
    return parsePath(path);
  });
  if (!spec.liveActions.includes(spec.fallbackAction)) throw new ArcSpecError(`${spec.id}：保底动作 ${spec.fallbackAction} 不在候选集里`);
  const ids = spec.questions.map((question) => question.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new ArcSpecError(`${spec.id}：问题 id 重复 ${duplicate}`);
  return { spec, projection };
}

/** 按投影取出这一步判断要用的 state。取不到的字段是 undefined，不补默认值。 */
export function project(arc: CompiledArc, snapshot: Snapshot): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const segments of arc.projection) {
    state[renderPath(segments)] = resolve(snapshot.values, segments, 0);
  }
  return state;
}

function resolve(value: unknown, segments: readonly Segment[], at: number): unknown {
  if (at >= segments.length) return value;
  const segment = segments[at];
  if ("each" in segment) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => resolve(item, segments, at + 1));
  }
  if (typeof value !== "object" || value === null) return undefined;
  return resolve((value as Readonly<Record<string, unknown>>)[segment.key], segments, at + 1);
}
