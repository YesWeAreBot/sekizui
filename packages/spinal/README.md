# @sekizui/spinal

脊髓层的 Cordis 服务。这是**唯一**知道快模型存在的地方。

## 一次窗口做什么

```
宿主在窗口边界调 pulse(now)
  ├─ 采一次样（每窗一份，窗内所有弧共享）
  ├─ 换代了？清掉旧代的判决
  ├─ 对每条弧：按投影取出 state，算签名
  │    ├─ 签名没变 → 续期（seenAt = now），不重问
  │    ├─ 上一次还在飞 → 这一拍跳过（单飞）
  │    └─ 否则 → 单飞发一次问，不阻塞心跳
  └─ 交回一份 Pulse 报告

传出层每帧调 directive(arcId, now)
  └─ 判决新鲜就用判决，否则给保底动作和原因
```

## 用法

```ts
ctx.plugin(SpinalService, { windowMs: 333, ledgerPath: "data/judgments.jsonl" });
const spinal = ctx.get("spinal");

spinal.useSampler(sampler); // 采样面，由 nerve 一侧实现
spinal.useDecider(decider); // 不给就用配置里的 apiKey 自建 HTTP 客户端
spinal.loadArcs(document); // 或 await spinal.openLibrary() 读配置里的文件

// 宿主的心跳里
const report = spinal.pulse(now);

// 传出层里
const directive = spinal.directive("kite", now);
if (directive?.kind === "judge") apply(directive.answers);
else if (directive) hold(directive.action);
```

## 判决与保底

`directive` 返回 `{ kind: "judge" }` 或 `{ kind: "fallback", action, why }`。退保底的五个原因，按判别顺序：

| `why`                | 什么时候                         |
| -------------------- | -------------------------------- |
| `no-sampler`         | 还没接上采样面                   |
| `never-judged`       | 这条弧还没有判决                 |
| `generation-changed` | 判决来自上一代连接               |
| `stale`              | 距 `seenAt` 超过弧的 `ttlMs`     |
| `low-confidence`     | 整体置信低于弧的 `minConfidence` |

时间是宿主的心跳时钟（`pulse` / `directive` 的 `now`），不是墙钟。`ttlMs` 与 `minConfidence` 写在弧的 `guards` 里，服务不给第二份。

**状态没变就续期**：投影结果一致说明世界没动，判断仍然成立，于是把 `seenAt` 往前推而不是重问。心跳停了，续期也就停了，判决自然过期。

**采样面读不到世界就抛错**：那一拍没有可用读数，本层不会拿旧快照顶替，也不续期——判断照样会按存活期退掉，退回保底而不是继续开车。

## 账本

每次判断追加一行 JSON，含弧、模型实际版本、签名、投影后的 state、回答、置信、延迟、代次。有路径就落盘，没路径只留内存里的尾巴（默认 128 条）。落盘失败不抛给调用方，记在 `lastError` 上。

## 配置

| 键            | 默认                                   | 说明                     |
| ------------- | -------------------------------------- | ------------------------ |
| `windowMs`    | `333`                                  | 采样与提问周期的上限     |
| `model`       | `jev-1.13.0`                           | 钉住版本，不用浮动别名   |
| `endpoint`    | `https://api.typesafe.ai/v1/systemone` | 判断服务端点             |
| `apiKey`      | 空                                     | 给了它才自建 HTTP 客户端 |
| `libraryPath` | 空                                     | 弧库文件                 |
| `ledgerPath`  | 空                                     | 账本文件                 |

## 与外部的关系

三份薄接口是本层与外部的全部边界，实现都留给外部：

| 接口     | 谁实现           | 干什么                         |
| -------- | ---------------- | ------------------------------ |
| 采样面   | nerve 一侧       | 给出一份带代次的世界快照       |
| 意图汇   | nerve 一侧       | 接收判决并执行                 |
| 决策账本 | 本层写，编排层读 | 还原"它当时看到什么、答了什么" |

采样面已经落地（`Sampler` 在 `@sekizui/arc`）；意图汇是传出层的事，本层只管把 `directive` 交出去；账本由本层写。

## 状态

完整闭环已通：窗口采样、单飞、签名续期、判决缓存与保底、账本、真实 HTTP 客户端（`HttpDecider`，按 [TypeSafe 评估端点](https://docs.typesafe.ai/api) 的契约发请求并校验响应）。

还没有的：编排层的读写工具面（改弧、读账本）、动作库与它的创作闭环。
