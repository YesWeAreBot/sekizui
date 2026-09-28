import { compileArc, project } from "@sekizui/arc";
import { catalog, entityLimit, readBot, type BotLike } from "@sekizui/nerve-minecraft";
import { describe, expect, it } from "vitest";

const bot: BotLike = {
  username: "sekizui",
  version: "1.20.4",
  health: 12,
  food: 18,
  foodSaturation: 4.5,
  isSleeping: false,
  entity: { id: 1, type: "player", name: "player", position: { x: 10, y: 64, z: 10 }, yaw: 90, pitch: -10, onGround: true },
  entities: {
    "1": { id: 1, type: "player", name: "player", position: { x: 10, y: 64, z: 10 } },
    "2": { id: 2, type: "hostile", name: "zombie", kind: "Hostile mobs", position: { x: 16, y: 64, z: 10 }, health: 20 },
    "3": { id: 3, type: "animal", name: "cow", kind: "Passive mobs", position: { x: 10, y: 64, z: 13 }, health: 10 },
    "4": { id: 4, type: "object", name: "item", position: { x: 11, y: 64, z: 11 } },
    "5": { id: 5, type: "hostile", name: "zombie", kind: "Hostile mobs", position: { x: 12, y: 66, z: 10 }, isValid: false },
  },
  players: {
    sekizui: { username: "sekizui", entity: { position: { x: 10, y: 64, z: 10 } } },
    miaow: { username: "miaow", entity: { position: { x: 10, y: 64, z: 20 } } },
  },
  inventory: {
    items: () => [
      { name: "iron_sword", count: 1, slot: 36 },
      { name: "cobblestone", count: 64, slot: 37 },
    ],
  },
  heldItem: { name: "iron_sword", count: 1, slot: 36 },
  game: { dimension: "overworld" },
  time: { timeOfDay: 6_000 },
};

describe("readBot", () => {
  it("还没进世界就读不到", () => {
    expect(readBot({})).toBeNull();
    expect(readBot({ entity: { position: { x: 0, y: 0, z: 0 } } })).toBeNull();
  });

  it("读得出自身状态", () => {
    const values = readBot(bot);
    expect(values?.bot).toEqual({
      username: "sekizui",
      version: "1.20.4",
      hp: 12,
      hp_percent: 60,
      food: 18,
      saturation: 4.5,
      dimension: "overworld",
      time_of_day: 6_000,
      on_ground: true,
      sleeping: false,
      position: { x: 10, y: 64, z: 10 },
      yaw: 90,
      pitch: -10,
    });
  });

  it("附近实体不按类型预筛：自己与玩家除外，失效的不要", () => {
    const values = readBot(bot);
    expect(values?.entities).toEqual([
      { id: 4, name: "item", type: "object", kind: "UNKNOWN", hostile: false, dist: 1.4, dy: 0, hp: 0, position: { x: 11, y: 64, z: 11 } },
      { id: 3, name: "cow", type: "animal", kind: "Passive mobs", hostile: false, dist: 3, dy: 0, hp: 10, position: { x: 10, y: 64, z: 13 } },
      { id: 2, name: "zombie", type: "hostile", kind: "Hostile mobs", hostile: true, dist: 6, dy: 0, hp: 20, position: { x: 16, y: 64, z: 10 } },
    ]);
    expect(values?.entities_total).toBe(3);
  });

  it("附近实体按距离排，截断也不瞒着：总数单独给", () => {
    const many: BotLike = {
      ...bot,
      entities: Object.fromEntries(
        Array.from({ length: 20 }, (_value, index) => [
          `${index}`,
          { id: 100 + index, type: "hostile", name: "zombie", kind: "Hostile mobs", position: { x: 10 + index, y: 64, z: 10 } },
        ]),
      ),
    };
    const values = readBot(many);
    expect(values?.entities).toHaveLength(entityLimit);
    expect(values?.entities_total).toBe(20);
  });

  it("玩家与背包", () => {
    const values = readBot(bot);
    expect(values?.players).toEqual([
      { username: "sekizui", dist: 0 },
      { username: "miaow", dist: 10 },
    ]);
    expect(values?.inventory).toEqual([
      { name: "iron_sword", count: 1, slot: 36 },
      { name: "cobblestone", count: 64, slot: 37 },
    ]);
    expect(values?.holding).toEqual({ name: "iron_sword", count: 1 });
  });

  it("空手时 hand 是空对象，不是 null", () => {
    expect(readBot({ ...bot, heldItem: null })?.holding).toEqual({});
  });

  it("目录里的每条变量都读得到，声明与读数不会走散", () => {
    const arc = compileArc(
      {
        id: "catalog-drift",
        on: "永远",
        off: "永不",
        projection: catalog.declares.map((decl) => decl.path),
        questions: [{ id: "q", type: "noul", instructions: "随便问一句" }],
        liveActions: ["Hold"],
        fallbackAction: "Hold",
        guards: { ttlMs: 1_000, minConfidence: 0.5 },
      },
      catalog,
    );
    const state = project(arc, { values: readBot(bot) ?? {}, observedAt: 0, generation: 1 });

    expect(Object.keys(state)).toHaveLength(catalog.declares.length);
    const missing = Object.entries(state)
      .filter(([, value]) => value === undefined)
      .map(([path]) => path);
    expect(missing).toEqual([]);
  });
});
