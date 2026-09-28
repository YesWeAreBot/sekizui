import type { SampleType, Sampler, Snapshot } from "@sekizui/arc";

export class SampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleError";
  }
}

/**
 * 取一份窗口快照。
 *
 * 只校验根变量（路径不含点与方括号的那些）的存在与类型：叶子声明是编译期
 * 的白名单，采样时缺席是合法的（敌人没了，`enemies[*].dist` 自然取不到）。
 */
export function sample(sampler: Sampler, now: number): Snapshot {
  const values = sampler.read();
  for (const decl of sampler.declares) {
    if (decl.path.includes(".") || decl.path.includes("[")) continue;
    const value = values[decl.path];
    if (value === undefined) throw new SampleError(`采样器没有给出根变量 ${decl.path}`);
    if (!matches(value, decl.type)) throw new SampleError(`根变量 ${decl.path} 类型不符：声明 ${decl.type}，实际 ${describe(value)}`);
  }
  return { values, observedAt: now, generation: sampler.generation() };
}

/**
 * 状态的签名：同一个代次下，投影结果相同就是同一个签名。
 *
 * 签名一致说明世界没动，判断仍然成立，于是续期而不是重问。
 */
export function signatureOf(state: Readonly<Record<string, unknown>>, generation: number): string {
  const text = `${generation}|${JSON.stringify(state)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function matches(value: unknown, type: SampleType): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "number":
      return Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      throw new SampleError(`不认识的声明类型：${String(type)}`);
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}
