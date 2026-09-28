import { setTimeout as delay } from "node:timers/promises";

import type { NervePrimitive, Point, PrimitiveOutcome, PrimitiveOp } from "./protocol.js";

/**
 * 传出层的第一批原语。
 *
 * 每个原语的终止判据读**世界事实**（位置、实体表、方块），不数帧：
 * 帧数在丢包与卡顿时毫无意义，"到了没有""方块还在不在"却永远为真。
 * 超时不是判据，是最后一道闸——判据看不到进展时的兜底。
 */

/** 位置。mineflayer 的 Vec3 结构上满足它。 */
export interface VecLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  offset(dx: number, dy: number, dz: number): VecLike;
}

export interface ActorLike {
  readonly id?: number;
  readonly name?: string;
  readonly health?: number | null;
}

export interface BotActLike {
  readonly entity?: { readonly position: VecLike; readonly onGround?: boolean } | null;
  readonly entities?: Readonly<Record<string, ActorLike>> | null;
  setControlState(control: string, on: boolean): void;
  lookAt(point: unknown, force?: boolean): Promise<void>;
  dig(block: unknown): Promise<void>;
  attack(entity: unknown): void;
  blockAt(point: unknown): unknown;
  on(event: ActorEvent, handler: (entity: ActorLike) => void): void;
  off(event: ActorEvent, handler: (entity: ActorLike) => void): void;
}

/** 与世界有关的**事件沿**。判据该挂在它们上面，而不是比两个时刻的快照。 */
export type ActorEvent = "entityHurt" | "entityDead" | "entityGone";

export interface PrimitiveClock {
  now(): number;
  generation(): number;
  sleep(ms: number): Promise<void>;
}

/** 默认超时：给判据足够时间看到进展，又不至于把主循环吊住。 */
export const defaultTimeouts: Record<PrimitiveOp, number> = { walk: 5_000, jump: 1_500, dig: 10_000, attack: 3_000 };

/** 判据的轮询间隔，一个服务器 tick 的量级。 */
const POLL_MS = 50;

/** 走到多近算到了：半格是 mineflayer 路径判定的常用容差，取一格内。 */
const WALK_TOLERANCE = 0.8;

const realClock: PrimitiveClock = { now: () => Date.now(), generation: () => 0, sleep: (ms) => delay(ms) };

type Fate = { readonly ok: true; readonly detail: string } | { readonly ok: false; readonly detail: string };

const arrived = (detail: string): Fate => ({ ok: true, detail });
const missed = (detail: string): Fate => ({ ok: false, detail });

/**
 * 跑一个原语。`bot` 是 undefined（还没进世界）时当场失败，不去碰它。
 *
 * `clock` 注进来是为了让超时与换代可控可测：真实运行取墙钟与当前代次，
 * 测试里给假时钟就能把"等了五秒"压成一瞬。
 */
export async function runPrimitive(
  bot: BotActLike | undefined,
  primitive: NervePrimitive,
  clock: PrimitiveClock = realClock,
): Promise<Omit<PrimitiveOutcome, "generation">> {
  const started = clock.now();
  const deadline = started + (primitive.timeoutMs ?? defaultTimeouts[primitive.op]);
  const fate = bot ? await run(bot, primitive, clock, deadline) : missed("还没进世界，没有可操作的 bot");
  return { ok: fate.ok, detail: fate.detail, ms: clock.now() - started };
}

async function run(bot: BotActLike, primitive: NervePrimitive, clock: PrimitiveClock, deadline: number): Promise<Fate> {
  const generation = clock.generation();
  switch (primitive.op) {
    case "walk":
      return walk(bot, primitive.to, clock, deadline, generation);
    case "jump":
      return jump(bot, clock, deadline, generation);
    case "dig":
      return dig(bot, primitive.at, clock, deadline, generation);
    case "attack":
      return attack(bot, primitive.entityId, clock, deadline, generation);
    default: {
      // 加了新原语却忘了在这里派活，编译就会当场拦下
      const unhandled: never = primitive;
      return missed(`不认识的原语：${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * 判据的公共骨架：读世界事实，读到就收手；换代或超时才认输。
 *
 * `report` 是失败时交出去的现场——超时只说"超时"没法排障，说清"水平差还有几格"才有用。
 */
async function poll(clock: PrimitiveClock, deadline: number, generation: number, probe: () => Fate | undefined, report: () => string): Promise<Fate> {
  for (;;) {
    const fate = probe();
    if (fate) return fate;
    if (clock.generation() !== generation) return missed("换代了：旧代的动作作废");
    if (clock.now() >= deadline) return missed(`超时：${report()}`);
    await clock.sleep(POLL_MS);
  }
}

/**
 * 陪跑：等到超时或换代。别人已经有结果时返回 `"settled"`——那时调用方去取那份结果，
 * 不要用这条"已经被抢先"的消息盖掉它。
 */
async function watch(clock: PrimitiveClock, deadline: number, generation: number, settled: () => boolean, report: () => string): Promise<Fate | "settled"> {
  for (;;) {
    if (settled()) return "settled";
    if (clock.generation() !== generation) return missed("换代了：旧代的动作作废");
    if (clock.now() >= deadline) return missed(`超时：${report()}`);
    await clock.sleep(POLL_MS);
  }
}

function where(bot: BotActLike): VecLike {
  const entity = bot.entity;
  if (!entity) throw new Error("bot 没有实体，读不到自己的位置");
  return entity.position;
}

/** 由 bot 自己造目标点的向量：mineflayer 的 lookAt 要 Vec3，测试里的替身也只需满足同一个形状。 */
function spot(bot: BotActLike, [x, y, z]: Point): VecLike {
  const at = where(bot);
  return at.offset(x - at.x, y - at.y, z - at.z);
}

function gapTo(at: VecLike, [x, , z]: Point): number {
  return Math.hypot(at.x - x, at.z - z);
}

async function walk(bot: BotActLike, to: Point, clock: PrimitiveClock, deadline: number, generation: number): Promise<Fate> {
  const [x, , z] = to;
  await bot.lookAt(spot(bot, [x, where(bot).y, z]), true);
  bot.setControlState("forward", true);
  try {
    return await poll(
      clock,
      deadline,
      generation,
      () => {
        const gap = gapTo(where(bot), to);
        return gap <= WALK_TOLERANCE ? arrived(`到了，水平差 ${gap.toFixed(2)}`) : undefined;
      },
      () => `水平差还有 ${gapTo(where(bot), to).toFixed(2)}，控制一直是按下状态`,
    );
  } finally {
    // 无论走到没走到，控制状态都要松手：留着 forward 就是让 bot 一直撞墙
    bot.setControlState("forward", false);
  }
}

async function jump(bot: BotActLike, clock: PrimitiveClock, deadline: number, generation: number): Promise<Fate> {
  const before = where(bot).y;
  bot.setControlState("jump", true);
  try {
    return await poll(
      clock,
      deadline,
      generation,
      () => {
        const entity = bot.entity;
        const at = where(bot);
        return entity?.onGround === false && at.y > before ? arrived(`离地了，y ${before.toFixed(2)} → ${at.y.toFixed(2)}`) : undefined;
      },
      () => `一直没离地，y 还是 ${where(bot).y.toFixed(2)}`,
    );
  } finally {
    bot.setControlState("jump", false);
  }
}

async function dig(bot: BotActLike, at: Point, clock: PrimitiveClock, deadline: number, generation: number): Promise<Fate> {
  const [x, y, z] = at;
  const block = bot.blockAt(spot(bot, at));
  if (!block) return missed(`(${x},${y},${z}) 本来就没有方块`);

  // mineflayer 的 dig 只在**收到那块方块变成空气**时才落地——它本身就是沿。
  // 落地之后再读一次方块是画蛇添足：正好在那个间隙被补回一块，一次真挖掉了的挖掘就变成失败。
  let settled = false;
  const digging = bot.dig(block).then(
    (): Fate => {
      settled = true;
      return arrived(`挖掉了 (${x},${y},${z})`);
    },
    (error: unknown): Fate => {
      settled = true;
      return missed(`挖不动：${error instanceof Error ? error.message : String(error)}`);
    },
  );
  const outcome = await Promise.race([
    digging,
    watch(
      clock,
      deadline,
      generation,
      () => settled,
      () => `(${x},${y},${z}) 的方块还在`,
    ),
  ]);
  return outcome === "settled" ? await digging : outcome;
}

async function attack(bot: BotActLike, entityId: number, clock: PrimitiveClock, deadline: number, generation: number): Promise<Fate> {
  const target = bot.entities?.[entityId];
  if (!target) return missed(`目标 ${entityId} 不在实体表里`);

  // 判据是"打中了"这个**沿**：受伤、死亡、从世界上消失。
  // 不能比血量快照——怪回血会让"比出手时低"永远不成立，而那一刀其实早就砍中了。
  const hit = Promise.withResolvers<Fate>();
  let armed = false;
  const onHurt = (entity: ActorLike): void => {
    if (armed && entity?.id === entityId) hit.resolve(arrived(`目标 ${entityId} 受伤了`));
  };
  const onGone = (entity: ActorLike): void => {
    if (armed && entity?.id === entityId) hit.resolve(arrived(`目标 ${entityId} 已经不在世界上了`));
  };
  bot.on("entityHurt", onHurt);
  bot.on("entityDead", onGone);
  bot.on("entityGone", onGone);
  try {
    bot.attack(target);
    armed = true; // 出手之前世界里的旧伤不算这一次
    const outcome = await Promise.race([
      hit.promise.then((fate) => {
        armed = false;
        return fate;
      }),
      watch(
        clock,
        deadline,
        generation,
        () => !armed,
        () => `目标 ${entityId} 一直没受伤`,
      ),
    ]);
    return outcome === "settled" ? await hit.promise : outcome;
  } finally {
    bot.off("entityHurt", onHurt);
    bot.off("entityDead", onGone);
    bot.off("entityGone", onGone);
  }
}
