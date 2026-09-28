import type { ActorEvent, ActorLike, BotActLike, PrimitiveClock, VecLike } from "@sekizui/nerve-minecraft";

export function vec(x: number, y: number, z: number): VecLike {
  return { x, y, z, offset: (dx, dy, dz) => vec(x + dx, y + dy, z + dz) };
}

/**
 * 假时钟：`sleep` 不真等，直接把时间往前推，再让挂上来的钩子推一次世界。
 *
 * 原语的超时因此可以只花几毫秒就跑到，判据的每一次轮询也都在测试的掌控里。
 */
export class FakeClock implements PrimitiveClock {
  nowMs = 1_000;
  gen = 1;
  readonly onSleep: Array<() => void> = [];

  now(): number {
    return this.nowMs;
  }

  generation(): number {
    return this.gen;
  }

  async sleep(ms: number): Promise<void> {
    this.nowMs += ms;
    for (const tick of this.onSleep) tick();
  }
}

export function blockKey(point: VecLike): string {
  return `${point.x},${point.y},${point.z}`;
}

/** 会读位置、读实体表、按控制状态推进、也能发出事件沿的假 bot。 */
export class FakeBot implements BotActLike {
  entity = { position: vec(0, 64, 0), onGround: true };
  entities: Record<string, ActorLike> = {};
  readonly blocks = new Map<string, unknown>();
  readonly controls = new Map<string, boolean>();
  readonly lookedAt: unknown[] = [];
  readonly attacked: unknown[] = [];
  /** dig 落地时做什么。返回的 promise 不落地，就模拟"这一挖永远挖不完" */
  digEffect: (block: unknown) => unknown = () => {};

  private readonly listeners = new Map<ActorEvent, Set<(entity: ActorLike) => void>>();

  setControlState(control: string, on: boolean): void {
    this.controls.set(control, on);
  }

  async lookAt(point: unknown): Promise<void> {
    this.lookedAt.push(point);
  }

  async dig(block: unknown): Promise<void> {
    await this.digEffect(block);
  }

  attack(entity: unknown): void {
    this.attacked.push(entity);
  }

  blockAt(point: unknown): unknown {
    return this.blocks.get(blockKey(point as VecLike)) ?? null;
  }

  on(event: ActorEvent, handler: (entity: ActorLike) => void): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: ActorEvent, handler: (entity: ActorLike) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** 还挂着几个监听器：用来验原语收场时把监听器摘干净了。 */
  listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** 测试驱动的世界沿。 */
  emit(event: ActorEvent, entity: ActorLike): void {
    for (const handler of this.listeners.get(event) ?? []) handler(entity);
  }
}
