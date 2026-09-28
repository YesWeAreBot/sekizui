import { confidenceOfAnswers, project, type CompiledArc, type Sampler, type Snapshot } from "@sekizui/arc";
import { Service, type Context } from "cordis";

import { configDefaults, spinalConfigSchema, type ResolvedSpinalConfig, type SpinalConfig } from "./config.js";
import { HttpDecider, type Decider } from "./decider.js";
import { directiveOf, type Directive, type Judgment } from "./judgment.js";
import { Ledger } from "./ledger.js";
import { ArcLibrary } from "./library.js";
import { sample, signatureOf } from "./window.js";

/** 一次窗口边界做了什么。给观测页和测试看，不参与控制。 */
export interface Pulse {
  readonly sampled: boolean;
  readonly generation: number | undefined;
  /** 这一拍发出去的弧 */
  readonly asked: readonly string[];
  /** 这一拍问了也白问的弧：状态没变，或上一次还在飞 */
  readonly reused: readonly string[];
  readonly errors: readonly string[];
}

/**
 * 脊髓层：唯一知道快模型存在的地方。
 *
 * 宿主在每个窗口边界调 `pulse`，传出层每帧调 `directive`。
 */
export class SpinalService extends Service {
  static readonly inject = [];
  static readonly Config = spinalConfigSchema;

  readonly settings: ResolvedSpinalConfig;
  readonly library: ArcLibrary;
  readonly ledger: Ledger;

  private sampler?: Sampler;
  private decider?: Decider;
  private snapshot?: Snapshot;
  private readonly cache = new Map<string, Judgment>();
  private readonly inflight = new Set<string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly notes: string[] = [];

  constructor(ctx: Context, config: SpinalConfig = {}) {
    super(ctx, "spinal");
    this.settings = { ...configDefaults, ...config };
    this.library = new ArcLibrary();
    this.ledger = new Ledger(this.settings.ledgerPath);
    if (this.settings.apiKey !== "") this.decider = new HttpDecider({ apiKey: this.settings.apiKey, endpoint: this.settings.endpoint });
  }

  useSampler(sampler: Sampler): void {
    this.sampler = sampler;
  }

  useDecider(decider: Decider): void {
    this.decider = decider;
  }

  /** 装载弧。变量目录来自采样面，必须先接上采样面。 */
  loadArcs(document: unknown): void {
    this.library.load(document, { declares: this.sampler?.declares ?? [] });
  }

  async openLibrary(): Promise<void> {
    if (this.settings.libraryPath === "") return;
    await this.library.loadFile(this.settings.libraryPath, { declares: this.sampler?.declares ?? [] });
  }

  /**
   * 窗口边界：采一次样，对签名变了的弧各发一次问。
   *
   * 立刻返回，不阻塞宿主的心跳；答案由 `drain` 等。
   */
  pulse(now = Date.now()): Pulse {
    const asked: string[] = [];
    const reused: string[] = [];
    const errors: string[] = [];
    const sampler = this.sampler;
    if (!sampler) return { sampled: false, generation: undefined, asked, reused, errors: ["没有采样面"] };

    let sampled = false;
    if (!this.snapshot || now - this.snapshot.observedAt >= this.settings.windowMs) {
      try {
        const next = sample(sampler, now);
        // 换代了，旧代的判断与采样一律作废
        if (this.snapshot && next.generation !== this.snapshot.generation) this.cache.clear();
        this.snapshot = next;
        sampled = true;
      } catch (error) {
        // 读不到世界：这一拍没有可用读数，旧判决也就停止续期，过了存活期自然退保底
        this.snapshot = undefined;
        this.note(error instanceof Error ? error.message : String(error));
        errors.push(this.notes[this.notes.length - 1]);
      }
    }

    const snapshot = this.snapshot;
    if (!snapshot) return { sampled, generation: undefined, asked, reused, errors };
    const generation = snapshot.generation;

    if (this.library.size > 0 && !this.decider) {
      this.note("没有判断者");
      return { sampled, generation, asked, reused, errors: [...errors, "没有判断者"] };
    }

    for (const arc of this.library.list()) {
      const id = arc.spec.id;
      const state = project(arc, snapshot);
      const sig = signatureOf(state, generation);
      const cached = this.cache.get(id);

      if (cached && cached.sig === sig && cached.generation === generation) {
        // 世界没动，判断仍然成立：续期，不重问
        this.cache.set(id, { ...cached, seenAt: now });
        reused.push(id);
        continue;
      }
      if (this.inflight.has(id)) {
        reused.push(id);
        continue;
      }
      asked.push(id);
      this.launch(arc, state, sig, snapshot, now);
    }
    return { sampled, generation, asked, reused, errors };
  }

  /** 传出层每帧读这个。弧不存在时是 undefined。 */
  directive(arcId: string, now = Date.now()): Directive | undefined {
    const arc = this.library.get(arcId);
    if (!arc) return undefined;
    return directiveOf({ arc, judgment: this.cache.get(arcId), generation: this.sampler?.generation(), now });
  }

  /** 缓存里的判断，给观测页读。 */
  judgments(): readonly Judgment[] {
    return [...this.cache.values()];
  }

  /** 最近的失败现场，最近的在后。 */
  failures(): readonly string[] {
    return this.notes;
  }

  /** 等在飞的问落地。 */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
    await this.ledger.drain();
  }

  private launch(arc: CompiledArc, state: Record<string, unknown>, sig: string, snapshot: Snapshot, now: number): void {
    const id = arc.spec.id;
    this.inflight.add(id);
    const task = this.ask(arc, state, sig, snapshot, now).finally(() => {
      this.inflight.delete(id);
      this.pending.delete(task);
    });
    this.pending.add(task);
  }

  private async ask(arc: CompiledArc, state: Record<string, unknown>, sig: string, snapshot: Snapshot, now: number): Promise<void> {
    const decider = this.decider;
    if (!decider) return;
    const started = Date.now();
    try {
      const result = await decider.decide({ model: this.settings.model, state, questions: arc.spec.questions });
      const judgment: Judgment = {
        arc: arc.spec.id,
        model: result.model,
        sig,
        state,
        answers: result.answers,
        confidence: confidenceOfAnswers(result.answers),
        at: now,
        seenAt: now,
        generation: snapshot.generation,
        ttlMs: arc.spec.guards.ttlMs,
        ms: Date.now() - started,
        usage: result.usage,
      };
      this.cache.set(arc.spec.id, judgment);
      this.ledger.record(judgment);
    } catch (error) {
      this.note(`${arc.spec.id}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private note(message: string): void {
    this.notes.push(message);
    if (this.notes.length > 8) this.notes.shift();
  }
}
