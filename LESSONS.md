# sekizui 踩坑记录

每一条都是"为什么这里的代码必须写成这样"的直接原因，附当时的证据。
打算"顺手清理"下面任何一处之前，先读完它对应的那条。

## 1. 假对象验不出真机器人

集成测试三次 60 秒超时，没有任何线索。原因是我用 `entity.type === "mob"` 收附近的怪——
**mineflayer 给僵尸的 `type` 是 `"hostile"`**。

真协议下把实体打出来才看见：

```
[[0,"player","player",null,true,"10,64,10"],
 [1001,"hostile","zombie","Hostile mobs",true,"16,64,10"]]
```

`type` 的取值集合是 `hostile` / `animal` / `projectile` / `object` / `mob` / `water_creature` /
`passive` / `living` / `ambient` / `player`（见 `minecraft-data` 的 `entities.json`），
`"mob"` 只是十种之一。我在替身对象里写的是 `"mob"`，于是测试全绿、真协议下一只怪都收不到。

- 采样面**不按类型预筛**：分类原样交出去，`hostile` 另由代码按 `kind === "Hostile mobs"` 判定。
- 替身只用来测纯逻辑；**凡是接线，至少要有一个走真协议/真库的集成测试**。

## 2. 超时的测试必须说清它等的是什么

`Error: Test timed out in 40000ms` 一个字的线索都没有，连猜三轮。
改成把现场带进异常之后一眼定位：

```ts
catch (error) {
  throw new Error(`${error.message}｜引擎说过：${nerve.notes().join(" / ") || "（什么都没说）"}｜连上来的：${server.joined.join(",") || "无"}`);
}
```

组件自己的日志（`NerveMinecraft.notes()`、`SpinalService.failures()`）就是排障第一现场，
所以它们不是调试残留，是有意留的接口。

## 3. 收尾比正文更容易把测试吊死

断言早就失败了，但测试报的是超时——`finally` 里的 `server.close()` 等不到 `close` 事件，
把真正的首错埋在了后面。关闭也要设上限：

```ts
return Promise.race([closed.promise, delay(1_000)]);
```

## 4. 夹具里的 id 必须唯一

两只怪只出现一只。夹具按 `joined.length` 算 `entityId`，而那一次循环里它不变，
两个 `spawn_entity` 用了同一个 id，mineflayer 里后者覆盖前者。
**测试至少用两行数据**：单行会把"覆盖"这类错全藏在绿里。

## 5. 空串与 undefined 在第三方库里不同义

bot 起不来，原因是我把 `version: ""` 原样传给 mineflayer，它当成"一个叫空的版本"。
可选参数为空时**不传**，不要传空串：

```ts
...(options.version ? { version: options.version } : {}),
```

## 6. 承诺的错误隔离要真验

`Ledger` 的注释写着"落盘失败不抛给调用方"，`drain()` 却照样抛。
`.then(onOk, onErr)` 的第二个参数只接**上一个** promise 的拒绝，不接 `appendFile` 自己的。
改成 `.then(...).catch(...)`。**错误处理的测试要覆盖"它自己失败"的那条路径**——这条是测试当场抓住的。

## 7. 一个值两处能改就是两个真相

`ttlMs` 与 `minConfidence` 曾在弧的 `guards` 和脊髓层配置里各有一份。删掉配置那份：
守卫是弧的属性，服务不该有第二份。

## 8. 文档与实现不一致要当场对齐

README 写着"路径里的下标一律当通配"，`resolve` 却把 `[0]` 当下标取元素。
两种写法在文档里都成立，在代码里只应有一种。**改契约时顺手跑一遍那段代码**，
或者让测试把两种写法钉成同一个结果（`project` 的用例就是这么写的）。

## 9. 采样面读不到世界时，别让旧快照顶替

bot 断线之后，旧快照还在，判决于是被无限续期、永不退保底——正是 TTL 要防的事。
规则：**采样失败即丢弃快照**；`Sampler.read()` 读不到就抛错，不返回编造的默认值。

## 10. 第三方库关服时会踢人，而踢人的理由要走 NBT

minecraft-protocol 在 socket 结束时把 `Error` 对象塞进 `kick_disconnect` 的理由，
序列化当场 `ERR_INVALID_ARG_TYPE`，测试输出里一片红。夹具改成**先停引擎再关服**——
那时客户端已经不在册，别主动踢人。

## 11. 工作区用的是 bun isolated linker，根目录脚本解析不到子包依赖

在仓库根放个探测脚本，`import { Context } from "cordis"` 直接 `Cannot find package 'cordis'`：
每个包的依赖装在自己的 `node_modules` 里，不提升到根。
脚本要放进**拥有该依赖的那个包**；非要跨包引内部包，就写相对路径到它的 `lib/`。

## 12. 探测脚本用完即删，但结论要固化进测试

这一轮写了四个探测脚本（运行时矩阵、包形状、全链路、真协议），交付前全部删除。
其中"两只怪"这条结论没有删——它变成了集成测试里的一句断言。
探测脚本是一次性的证据；能长期复用的证据只该活在测试里。

## 附：构建上的一个方便之处

`yakumo-esbuild` 会把包里**每个入口**都构建一遍，所以 `src/engine.ts` 不必在任何配置里登记，
它自己就产出 `lib/engine.js`——子进程入口靠这条规则自动跟上。
