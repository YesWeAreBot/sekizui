# Repository Guidelines

sekizui 的 AI 工作指南。定位是**脊髓层**：可编程反射弧的运行时。

上层编排由慢模型和人通过工具面完成，下层传出由 nerve 一侧的代码完成，本仓库只负责中间那一层。

## Authority

```
current code  >  用户最新指令  >  docs/  >  docs/history/
```

**写代码之前先读 `docs/` 里对应的一篇。** 目录见下。

## 技术栈

| 层     | 选择                                              |
| ------ | ------------------------------------------------- |
| 运行时 | Bun；ESM only；TypeScript strict                  |
| 组合   | Cordis v4（DI、fiber、事件）；本层导出 Service    |
| 配置   | schemastery                                       |
| 构建   | yakumo（tsc 出声明 → esbuild 出 JS）              |
| 质量   | oxlint + oxfmt，不手写格式                        |
| 测试   | Vitest，各包 `tests/`，文件名 `<subject>.spec.ts` |

## 三条不变量

1. **弧是数据，动作是代码，判断是追加日志。** 弧要能被 diff、被版本化、被回放；动作是会被执行的东西，不进数据文件。
2. **本层永不同步等模型。** 后台按窗口周期预取，主循环读上一次的结果；每次结果带 TTL 与连接代次，过期或换代一律作废。
3. **保命阈值与动作实现不在可编程范围内。** 编排层改的是弧，不是命。

## 文档地图

| 任务                         | 先读                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| 了解定位与分层               | [docs/00-overview.md](docs/00-overview.md)                                  |
| **动弧模型、判据、写入面**   | [docs/01-reflex-arc.md](docs/01-reflex-arc.md)                              |
| 想知道某个结论怎么来的       | [docs/02-prior-art.md](docs/02-prior-art.md)、[docs/history/](docs/history) |
| **动进程、采样、请求、账本** | [docs/03-implementation.md](docs/03-implementation.md)                      |
| 动验收、消融、指标           | [docs/04-acceptance.md](docs/04-acceptance.md)                              |
| 想知道某一项为什么这么定     | [docs/05-decisions.md](docs/05-decisions.md)                                |
| 想知道接下来做什么           | [ROADMAP.md](ROADMAP.md)                                                    |

**同步义务**：新增分层结论、改弧模型、改三份薄接口、踩到新坑，回来更新上面相应的一篇与 `docs/05-decisions.md`；被推翻的结论写进 `docs/05-decisions.md` 的「被推翻」表，不要删。

## 命令

```bash
bun install
bun run build
bun run test
bun run lint
bun run format
```

`bun run test` 先跑一次全工作区类型检查（含 `tests/`），再跑 vitest。只跑类型检查用 `bun run typecheck`。

新增工作区包时，记得在 `vitest.config.ts` 的 `local` 与 `tsconfig.check.json` 的 `paths` 里各补一个名字。

## 现状与下一步

已建：

- `@sekizui/arc`：弧模型（四件套与守卫）、变量目录、路径投影、问题与回答类型（与判断服务方的契约一致）。
- `@sekizui/spinal`：窗口采样与连接代次、单飞与签名续期、判决缓存与保底判别、决策账本、判断客户端（`HttpDecider`）。
- `@sekizui/nerve-minecraft`：mineflayer 引擎子进程（推帧 + 生命周期）、三十八条世界变量、采样面实现；传出层的四个原语（走、跳、挖、攻击）与各自的终止判据；测试里带一台刚够进入世界的假服务端。

下一步：**动作库**（把弧的判决翻译成原语，形状见 `docs/05-decisions.md` U-03）、编排层的读写工具面（改弧、读账本），以及**方块感知**（采样面读方块，`dig` 的判据要在真世界才立得住）。
