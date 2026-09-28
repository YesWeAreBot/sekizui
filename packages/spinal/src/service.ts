import { Service, type Context } from "cordis";

import { configDefaults, spinalConfigSchema, type ResolvedSpinalConfig, type SpinalConfig } from "./config.js";
import { ArcLibrary } from "./library.js";

/**
 * 脊髓层：唯一知道快模型存在的地方。
 *
 * 窗口采样、Jev 客户端、判决缓存与决策账本是下一步；现在它已经能被装上、
 * 拿到配置、持有一份弧库。
 */
export class SpinalService extends Service {
  static readonly inject = [];
  static readonly Config = spinalConfigSchema;

  readonly settings: ResolvedSpinalConfig;
  readonly library: ArcLibrary;

  constructor(ctx: Context, config: SpinalConfig = {}) {
    super(ctx, "spinal");
    this.settings = { ...configDefaults, ...config };
    this.library = new ArcLibrary();
  }
}
