import type { SampleCatalog } from "@sekizui/arc";

/**
 * 引擎能读出的世界变量。
 *
 * 六个根变量（`bot` / `mobs` / `mobs_total` / `players` / `inventory` / `holding`）
 * 只要读得到世界就一定在；叶子按情况在（背包里没有的东西就不在）。
 */
export const catalog: SampleCatalog = {
  declares: [
    { path: "bot", type: "object", cost: 40 },
    { path: "bot.username", type: "string" },
    { path: "bot.version", type: "string" },
    { path: "bot.hp", type: "number", unit: "点", cost: 4 },
    { path: "bot.hp_percent", type: "number", unit: "%", validWhen: "世界可读" },
    { path: "bot.food", type: "number" },
    { path: "bot.saturation", type: "number" },
    { path: "bot.dimension", type: "string" },
    { path: "bot.time_of_day", type: "number", unit: "tick" },
    { path: "bot.on_ground", type: "boolean" },
    { path: "bot.sleeping", type: "boolean" },
    { path: "bot.position", type: "object" },
    { path: "bot.position.x", type: "number", unit: "格" },
    { path: "bot.position.y", type: "number", unit: "格" },
    { path: "bot.position.z", type: "number", unit: "格" },
    { path: "bot.yaw", type: "number" },
    { path: "bot.pitch", type: "number" },

    /** 附近的实体，玩家与自己除外。不按类型预筛：分类原样交出去，值不值得管是弧的事 */
    { path: "entities", type: "array", cost: 60, validWhen: "世界可读" },
    { path: "entities[*].id", type: "number" },
    { path: "entities[*].name", type: "string" },
    { path: "entities[*].type", type: "string", validWhen: "世界可读（hostile / animal / projectile / object …）" },
    { path: "entities[*].kind", type: "string", validWhen: "世界可读（Hostile mobs / Passive mobs / …）" },
    { path: "entities[*].hostile", type: "boolean" },
    { path: "entities[*].dist", type: "number", unit: "格" },
    { path: "entities[*].dy", type: "number", unit: "格" },
    { path: "entities[*].hp", type: "number" },
    { path: "entities[*].position", type: "object" },
    /** 只推最近的若干个，这个数是没被截断的总数 */
    { path: "entities_total", type: "number" },

    { path: "players", type: "array", cost: 20, validWhen: "世界可读" },
    { path: "players[*].username", type: "string" },
    { path: "players[*].dist", type: "number", unit: "格" },

    { path: "inventory", type: "array", cost: 80, validWhen: "世界可读" },
    { path: "inventory[*].name", type: "string" },
    { path: "inventory[*].count", type: "number" },
    { path: "inventory[*].slot", type: "number" },

    { path: "holding", type: "object", cost: 6, validWhen: "手上拿着东西" },
    { path: "holding.name", type: "string" },
    { path: "holding.count", type: "number" },
  ],
};

/** 附近的实体最多推这么多条，其余靠 `entities_total` 交代。 */
export const entityLimit = 16;
