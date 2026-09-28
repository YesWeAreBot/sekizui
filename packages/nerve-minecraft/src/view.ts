import { entityLimit } from "./catalog.js";

/**
 * 只用到的那几个字段。真实的 mineflayer `Bot` 结构上满足它，测试里的替身也满足它。
 */
export interface BotLike {
  readonly username?: string;
  readonly version?: string;
  readonly health?: number | null;
  readonly food?: number | null;
  readonly foodSaturation?: number | null;
  readonly isSleeping?: boolean;
  readonly entity?: EntityLike | null;
  readonly entities?: Readonly<Record<string, EntityLike>> | null;
  readonly players?: Readonly<Record<string, PlayerLike>> | null;
  readonly inventory?: { items(): readonly ItemLike[] } | null;
  readonly heldItem?: ItemLike | null;
  readonly game?: { readonly dimension?: string } | null;
  readonly time?: { readonly timeOfDay?: number } | null;
}

export interface EntityLike {
  readonly id?: number;
  readonly name?: string;
  readonly displayName?: string;
  readonly kind?: string;
  readonly type?: string;
  readonly position?: Point | null;
  readonly health?: number | null;
  readonly isValid?: boolean;
  readonly onGround?: boolean;
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface PlayerLike {
  readonly username?: string;
  readonly entity?: EntityLike | null;
}

export interface ItemLike {
  readonly name?: string;
  readonly count?: number;
  readonly slot?: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface EntityRow {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly kind: string;
  readonly hostile: boolean;
  readonly dist: number;
  readonly dy: number;
  readonly hp: number;
  readonly position: Point;
}

interface PlayerRow {
  readonly username: string;
  readonly dist: number;
}

interface ItemRow {
  readonly name: string;
  readonly count: number;
  readonly slot: number;
}

/**
 * 把 bot 读成一帧世界变量。
 *
 * 读不到就读不到：还没进世界、连接断了、还没收到血量，一律返回 null。
 * 本层不编造默认值，脊髓层会把"读不到"当成这一拍没有可用读数。
 */
export function readBot(bot: BotLike): Record<string, unknown> | null {
  const self = bot.entity;
  if (!self?.position || typeof bot.health !== "number") return null;
  const at = self.position;
  const { entities, total } = collectEntities(bot, self, at);

  return {
    bot: {
      username: bot.username ?? "",
      version: bot.version ?? "",
      hp: bot.health,
      hp_percent: Math.round(bot.health * 5),
      food: bot.food ?? 0,
      saturation: round1(bot.foodSaturation ?? 0),
      dimension: bot.game?.dimension ?? "",
      time_of_day: Math.round(bot.time?.timeOfDay ?? 0),
      on_ground: self.onGround === true,
      sleeping: bot.isSleeping === true,
      position: { x: round1(at.x), y: round1(at.y), z: round1(at.z) },
      yaw: round1(self.yaw ?? 0),
      pitch: round1(self.pitch ?? 0),
    },
    entities,
    entities_total: total,
    players: collectPlayers(bot, at),
    inventory: (bot.inventory?.items() ?? []).map<ItemRow>((item) => ({
      name: item.name ?? "",
      count: item.count ?? 0,
      slot: item.slot ?? -1,
    })),
    holding: bot.heldItem ? { name: bot.heldItem.name ?? "", count: bot.heldItem.count ?? 0 } : {},
  };
}

function collectEntities(bot: BotLike, self: EntityLike, at: Point): { entities: EntityRow[]; total: number } {
  const all: EntityRow[] = [];
  for (const entity of Object.values(bot.entities ?? {})) {
    if (entity === self || entity?.id === self.id) continue;
    if (entity?.type === "player" || entity.isValid === false || !entity.position) continue;
    all.push({
      id: entity.id ?? 0,
      name: entity.name ?? entity.displayName ?? "unknown",
      type: entity.type ?? "unknown",
      kind: entity.kind ?? "UNKNOWN",
      hostile: entity.kind === "Hostile mobs",
      dist: round1(Math.hypot(at.x - entity.position.x, at.y - entity.position.y, at.z - entity.position.z)),
      dy: round1(entity.position.y - at.y),
      hp: typeof entity.health === "number" ? entity.health : 0,
      position: { x: round1(entity.position.x), y: round1(entity.position.y), z: round1(entity.position.z) },
    });
  }
  all.sort((left, right) => left.dist - right.dist);
  return { entities: all.slice(0, entityLimit), total: all.length };
}

function collectPlayers(bot: BotLike, at: Point): PlayerRow[] {
  const rows: PlayerRow[] = [];
  for (const player of Object.values(bot.players ?? {})) {
    const position = player?.entity?.position;
    if (!position) continue;
    rows.push({
      username: player.username ?? "",
      dist: round1(Math.hypot(at.x - position.x, at.y - position.y, at.z - position.z)),
    });
  }
  rows.sort((left, right) => left.dist - right.dist);
  return rows;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
