import { setTimeout as delay } from "node:timers/promises";

import minecraftData from "minecraft-data";
import mc, { type Server } from "minecraft-protocol";

import { closedPort } from "./harness.js";

export interface FakeMob {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FakeServerOptions {
  readonly version?: string;
  readonly port?: number;
  readonly health?: number;
  readonly food?: number;
  readonly mobs?: readonly FakeMob[];
  /**
   * 收到攻击包之后怎么办。默认不理——这正好验原语的超时路径。
   *
   * `hurt` 广播一次受伤（`entity_status` 2 → mineflayer 的 `entityHurt`），`kill` 让实体直接消失，
   * `drop` 掐掉连接（验换代之后旧回执一律作废）。
   */
  readonly onAttack?: "hurt" | "kill" | "drop";
}

export interface FakeServer {
  readonly port: number;
  readonly version: string;
  readonly joined: string[];
  close(): Promise<void>;
}

/**
 * 一个刚够 mineflayer 进入世界的假服务端。
 *
 * 只发三件事：login、position、update_health —— mineflayer 在收到第一条
 * 血量大于零的 update_health 时才 emit spawn。世界内容不在这个夹具的职责里。
 */
export async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const version = options.version ?? mc.supportedVersions.at(-1) ?? "";
  const data = minecraftData(version);
  // 自己先占一个空闲端口再放掉：minecraft-protocol 把 net 的 socketServer 藏在内部，类型里没有
  const port = options.port ?? (await closedPort());
  const server: Server = mc.createServer({ "online-mode": false, port, version, motd: "sekizui fake" });
  const joined: string[] = [];

  server.on("playerJoin", (client) => {
    joined.push(client.username);
    // 收包走 packet 通道：`client.on("attack")` 在库的类型里没有这个重载
    client.on("packet", (packet, meta) => {
      if (meta.name !== "attack") return;
      const entityId: unknown = packet?.entityId;
      if (typeof entityId !== "number") return;
      if (options.onAttack === "hurt") client.write("entity_status", { entityId, entityStatus: 2 });
      if (options.onAttack === "kill") client.write("entity_destroy", { entityIds: [entityId] });
      if (options.onAttack === "drop") client.socket?.destroy();
    });
    client.write("login", {
      ...data.loginPacket,
      enforceSecureChat: false,
      entityId: client.id,
      isHardcore: false,
      gameMode: 0,
      previousGameMode: 1,
      hashedSeed: [0, 0],
      maxPlayers: server.maxPlayers,
      viewDistance: 10,
      reducedDebugInfo: false,
      enableRespawnScreen: true,
      isDebug: false,
      isFlat: true,
    });
    client.write("position", { teleportId: 0, x: 10, y: 64, z: 10, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: 0 });
    let spawned = 0;
    for (const mob of options.mobs ?? []) {
      const type = data.entitiesByName[mob.type]?.id;
      if (type === undefined) continue;
      spawned += 1;
      client.write("spawn_entity", {
        entityId: 1_000 + spawned,
        objectUUID: `00000000-0000-0000-0000-${String(spawned).padStart(12, "0")}`,
        type,
        x: mob.x,
        y: mob.y,
        z: mob.z,
        velocity: { x: 0, y: 0, z: 0 },
        pitch: 0,
        yaw: 0,
        headPitch: 0,
        objectData: 0,
      });
    }
    client.write("update_health", { health: options.health ?? 12, food: options.food ?? 18, foodSaturation: 4.5 });
  });

  const listening = Promise.withResolvers<void>();
  server.once("listening", () => listening.resolve());
  await listening.promise;
  return {
    port,
    version,
    joined,
    close: async () => {
      // 调用方先停引擎，这时已经没客户端挂着；别再主动踢人：
      // kick_disconnect 的理由要走 NBT 聊天组件，minecraft-protocol 塞个 Error 进去会炸
      server.close();
      // close() 不停传回调（它自己调 socketServer.close()），给一点落地时间就够
      await delay(50);
    },
  };
}
