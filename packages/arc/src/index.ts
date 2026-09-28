import { z } from "zod";

/** 采样面上的一个变量。目录归代码所有，弧只能引用目录里已有的路径。 */
export interface SampleDecl {
  /** 快照里的取值路径，如 `enemies[*].dist` */
  readonly path: string;
  readonly type: "number" | "string" | "boolean";
  readonly unit?: string;
  /** 这个读数什么时候有效，如 `enemies.length > 0` */
  readonly validWhen?: string;
  /** 大约占多少 token，给编排层看成本 */
  readonly cost?: number;
}

export interface SampleCatalog {
  readonly declares: readonly SampleDecl[];
}

/** 一次采样的结果。窗口内所有弧共享同一份，带采样时刻与连接代次。 */
export interface Snapshot {
  readonly values: Readonly<Record<string, unknown>>;
  readonly observedAt: number;
  /** 重连换代后，旧代的快照一律作废 */
  readonly generation: number;
}

export const questionSchema = z.object({
  id: z.string().min(1),
  instructions: z.string().min(1),
  criteria: z.record(z.string()),
});

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
    ttlMs: z.number().int().positive(),
    minConfidence: z.number().min(0).max(1),
  }),
});

/** 弧库文件格式。 */
export const arcDocumentSchema = z.object({
  arcs: z.array(z.unknown()),
});

export type Question = z.infer<typeof questionSchema>;
export type ArcSpec = z.infer<typeof arcSpecSchema>;

/** 解析后的路径段：`enemies[*].dist` → [enemies][each][dist] */
export type Segment = { readonly key: string } | { readonly index: number } | { readonly each: true };

export class ArcSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcSpecError";
  }
}

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\]|\[\*\])*)$/;
const BRACKET = /\[(\d+|\*)\]/g;

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    const match = SEGMENT.exec(part);
    if (!match) throw new ArcSpecError(`路径段无法解析：${part}`);
    segments.push({ key: match[1] });
    for (const bracket of part.matchAll(BRACKET)) {
      segments.push(bracket[1] === "*" ? { each: true } : { index: Number(bracket[1]) });
    }
  }
  if (segments.length === 0) throw new ArcSpecError(`路径为空：${path}`);
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
    else if ("key" in segment) path += path.length === 0 ? segment.key : `.${segment.key}`;
    else path += `[${segment.index}]`;
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
  if (!spec.liveActions.includes(spec.fallbackAction)) {
    throw new ArcSpecError(`${spec.id}：保底动作 ${spec.fallbackAction} 不在候选集里`);
  }
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
  const record = value as Readonly<Record<string, unknown>>;
  return resolve(record["key" in segment ? segment.key : String(segment.index)], segments, at + 1);
}
