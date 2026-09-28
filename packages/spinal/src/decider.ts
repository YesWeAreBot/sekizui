import { systemOneResponseSchema, type Question, type SystemOneResponse } from "@sekizui/arc";

export interface DecideRequest {
  readonly model: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: readonly Question[];
}

export type DecideResult = SystemOneResponse;

/** 判断模型的客户端。本层只要求这一个方法。 */
export interface Decider {
  decide(request: DecideRequest): Promise<DecideResult>;
}

export class DecideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecideError";
  }
}

export interface HttpDeciderOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/** TypeSafe 的系统一评估端点。 */
export class HttpDecider implements Decider {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly send: typeof globalThis.fetch;

  constructor(options: HttpDeciderOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? "https://api.typesafe.ai/v1/systemone";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.send = options.fetch ?? globalThis.fetch;
  }

  async decide(request: DecideRequest): Promise<DecideResult> {
    const questions: Record<string, unknown> = {};
    for (const question of request.questions) {
      const { id, ...rest } = question;
      questions[id] = rest;
    }
    const response = await this.send(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ state: request.state, model: request.model, questions }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new DecideError(`判断服务返回 ${response.status}`);
    const parsed = systemOneResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new DecideError(`判断服务响应不符合契约：${parsed.error.message}`);
    for (const question of request.questions) {
      const answer = parsed.data.answers[question.id];
      if (!answer) throw new DecideError(`判断服务少了 ${question.id} 的回答`);
      if (answer.type !== question.type) throw new DecideError(`${question.id} 问的是 ${question.type}，答的是 ${answer.type}`);
    }
    return parsed.data;
  }
}
