# @sekizui/nerve-minecraft

Minecraft 世界一侧。实现 `@sekizui/arc` 的**采样面**，把 bot 看到的世界交出去。

## 为什么引擎在子进程里

mineflayer 的物理 tick 是 20 Hz，每个 tick 都在解析包、更新世界状态；主进程还要跑 Cordis、模型调用、UI。放一起就是互相拖。把引擎隔到子进程还顺带解决三件事：崩溃隔离、重连换代、运行时选择自由（主进程用 Bun，引擎用 Node）。

```
父进程(Bun)                      引擎子进程(Node，默认)
  NerveMinecraft                    mineflayer bot
    ├─ spawn ───────────────────→      ├─ 每 pushMs 推一帧 view
    ├─ child.on("message") ←──────────┤
    ├─ sampler.read()  ← 最新一帧       └─ note：连接、进世界、断线、出错
    └─ stop() ─────────────────────→  bot.quit() 后退出
```

## 用法

```ts
import { NerveMinecraft } from "@sekizui/nerve-minecraft";

const nerve = new NerveMinecraft({ host: "127.0.0.1", port: 25565, username: "sekizui" });
nerve.start();
spinal.useSampler(nerve.sampler); // 交给脊髓层
```

| 选项          | 默认              | 说明                     |
| ------------- | ----------------- | ------------------------ |
| `host`        | —                 | 服务器地址               |
| `username`    | —                 | 离线身份名               |
| `port`        | `25565`           | 端口                     |
| `version`     | mineflayer 的默认 | 协议版本                 |
| `auth`        | `offline`         | `offline` 或 `microsoft` |
| `pushMs`      | `100`             | 多久推一帧世界           |
| `reconnectMs` | `5000`            | 断线后隔多久重连         |
| `runtime`     | `node`            | 引擎子进程的运行时       |
| `enginePath`  | `lib/engine.js`   | 引擎入口                 |

## 读不到就读不到

采样面不编造默认值。bot 还没进世界、连接断了、还没收到血量，`read()` 就**抛错**——脊髓层会把这一拍当作没有可用读数，旧判决停止续期，过了存活期自然退保底。`generation()` 只在真的进过世界之后才往后走。

## 变量目录

三十八条，分六个根变量与它们的叶子：

| 根               | 内容                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `bot`            | 血量、血量百分比、饱食度、维度、一天中的时刻、坐标、朝向、是否着地               |
| `entities`       | 附近的实体：名字、类型、分类、是否敌对、距离、高度差、血量、坐标。玩家与自己除外 |
| `entities_total` | 实体的**总数**（列表只推最近的十六条，截断不瞒着）                               |
| `players`        | 附近玩家与距离                                                                   |
| `inventory`      | 背包：物品名、数量、槽位                                                         |
| `holding`        | 手上拿着的东西                                                                   |

**不按类型预筛。** mineflayer 的 `entity.type` 是 `hostile` / `animal` / `projectile` / `object` 这一层分类，僵尸是 `hostile` 而不是 `mob`；"值不值得管"是语义判断，留给弧，代码只把分类原样交出去。

`hostile` 由代码按 minecraft-data 的分类判定（`Hostile mobs`），不交给模型猜。距离、血量百分比、高度差也都是算好的——模型读现成的数就行。

## 测试用的假服务端

`tests/fake-server.ts` 起一台刚够 mineflayer 进入世界的服务端：只发 `login`、`position`、`update_health`（外加可选的 `spawn_entity`）。mineflayer 收到第一条血量大于零的 `update_health` 才 emit `spawn`，所以这三件就够了。世界内容不在它的职责里。

## 还没有的

传出层：执行原语（走、挖、放、攻击）与它们的终止判据。那时引擎要多一条请求/响应通道，`protocol.ts` 里现在只有 `view` / `note` / `stop`。
