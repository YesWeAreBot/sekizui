import Schema from "schemastery";

export interface SpinalConfig {
  /** 弧库文件路径。留空表示这一场只跑内存里登记的弧 */
  libraryPath?: string;
  /** 决策账本路径。留空表示只留在内存里 */
  ledgerPath?: string;
  /** 采样窗口与提问周期（毫秒）。这是上限，状态没变就不发请求 */
  windowMs?: number;
  /** 判断模型的版本号。钉住版本，不用浮动别名 */
  model?: string;
  /** 判断模型端点 */
  endpoint?: string;
  /** 判断服务凭据。给了它，本层自建 HTTP 客户端；否则由宿主注入 */
  apiKey?: string;
}

export const configDefaults: Required<SpinalConfig> = {
  libraryPath: "",
  ledgerPath: "",
  windowMs: 333,
  model: "jev-1.13.0",
  endpoint: "https://api.typesafe.ai/v1/systemone",
  apiKey: "",
};

export type ResolvedSpinalConfig = Required<SpinalConfig>;

export const spinalConfigSchema = Schema.object({
  libraryPath: Schema.string().default(configDefaults.libraryPath),
  ledgerPath: Schema.string().default(configDefaults.ledgerPath),
  windowMs: Schema.natural().default(configDefaults.windowMs),
  model: Schema.string().default(configDefaults.model),
  endpoint: Schema.string().default(configDefaults.endpoint),
  apiKey: Schema.string().default(configDefaults.apiKey),
});
