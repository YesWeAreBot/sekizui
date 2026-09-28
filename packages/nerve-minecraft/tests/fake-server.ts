import { setTimeout as delay } from "node:timers/promises";

import minecraftData from "minecraft-data";
import mc, { type Server } from "minecraft-protocol";

export interface FakeMob {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FakeServerOptions {
  readonly version?: string;
  readonly health?: number;
  readonly food?: number;
  readonly mobs?: readonly FakeMob[];
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
  const server: Server = mc.createServer({ "online-mode": false, port: 0, version, motd: "sekizui fake" });
  const joined: string[] = [];

  server.on("playerJoin", (client) => {
    joined.push(client.username);
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
  const port = (server.socketServer.address() as { port: number }).port;
  return {
    port,
    version,
    joined,
    close: () => {
      const closed = Promise.withResolvers<void>();
      // 调用方先停引擎，这时已经没客户端挂着；别再主动踢人：
      // kick_disconnect 的理由要走 NBT 聊天组件，minecraft-protocol 塞个 Error 进去会炸
      server.close((error) => (error ? closed.reject(error) : closed.resolve()));
      // 关闭偶尔等不到 close 事件，别让收尾把测试吊死
      return Promise.race([closed.promise, delay(1_000)]);
    },
  };
}
