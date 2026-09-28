import Schema from "schemastery";

export interface SpinalConfig {
  /** 弧库文件路径。留空表示这一场只跑内存里登记的弧 */
  libraryPath?: string;
  /** 采样窗口与提问周期（毫秒）。这是上限，签名没变就不发请求 */
  windowMs?: number;
  /** 判决的默认存活时长（毫秒）。弧自己的 guards.ttlMs 优先 */
  ttlMs?: number;
  /** 最低置信。低于它退回保底动作 */
  minConfidence?: number;
  /** 判断模型的版本号。钉住版本，不用浮动别名 */
  model?: string;
  /** 判断模型的端点 */
  endpoint?: string;
}

export const configDefaults: Required<SpinalConfig> = {
  libraryPath: "",
  windowMs: 333,
  ttlMs: 1_500,
  minConfidence: 0.6,
  model: "jev-1.13.0",
  endpoint: "https://api.typesafe.ai/v1/systemone",
};

export type ResolvedSpinalConfig = Required<SpinalConfig>;

export const spinalConfigSchema = Schema.object({
  libraryPath: Schema.string().default(configDefaults.libraryPath),
  windowMs: Schema.natural().default(configDefaults.windowMs),
  ttlMs: Schema.natural().default(configDefaults.ttlMs),
  minConfidence: Schema.number().min(0).max(1).default(configDefaults.minConfidence),
  model: Schema.string().default(configDefaults.model),
  endpoint: Schema.string().default(configDefaults.endpoint),
});
