# sekizui

可编程反射弧的运行时层。

**构想**：让慢模型为合适的阶段编写反射弧，让快模型在运行时执行这些反射弧，预设动作库是两者之间的共享资产。三个角色——慢模型是作者，快模型是脊髓，动作库是词汇表。

> 初始化阶段，接口还会变。

## 三层

| 层         | 周期       | 谁                                 |
| ---------- | ---------- | ---------------------------------- |
| 传出层(腱) | 16–50 ms   | 纯代码：按键、瞄准、时序           |
| 脊髓层     | 100–500 ms | 快模型：门控、仲裁、参数化         |
| 编排层     | 秒–分钟    | 慢模型和人：弧的增删改、动作库草案 |

本仓库只做**脊髓层**。传出层与采样面归 nerve 一侧，编排层通过工具面读写弧。

当前进度：脊髓层与 Minecraft 世界一侧（采样面）都已落地；传出层（执行原语）与编排层的读写工具面还没做。

## 三份薄接口

本层与外部的全部边界：

- **采样面**：取一份带连接代次的世界快照。
- **意图汇**：把判断交给传出层执行。
- **决策账本**：每次判断的记录，可还原、可回放。

## 两个库

- **动作库**：可执行的预设动作，是代码。
- **弧库**：弧实例（触发条件、候选动作子集、判据、退出条件），是数据。

弧引用动作的 id，不复制实现。

## Packages

| Package                                                | 说明                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`@sekizui/arc`](packages/arc)                         | 契约与数据模型：弧声明、状态变量目录、按路径投影。纯数据纯函数，不认识 Cordis |
| [`@sekizui/spinal`](packages/spinal)                   | 唯一知道快模型存在的地方：弧库、窗口采样、判决缓存、决策账本                  |
| [`@sekizui/nerve-minecraft`](packages/nerve-minecraft) | Minecraft 世界一侧：mineflayer 引擎子进程、世界变量目录、采样面               |

## 文档

| 文档                                                   | 内容                               |
| ------------------------------------------------------ | ---------------------------------- |
| [docs/00-overview.md](docs/00-overview.md)             | 定位、三个时间尺度、脊髓层的两半   |
| [docs/01-reflex-arc.md](docs/01-reflex-arc.md)         | 弧的四件套、写入面、闭环           |
| [docs/02-prior-art.md](docs/02-prior-art.md)           | TerraBlind / Cortico / Athena 对照 |
| [docs/03-implementation.md](docs/03-implementation.md) | 进程边界、层内结构、里程碑         |
| [docs/04-acceptance.md](docs/04-acceptance.md)         | 消融与验收                         |
| [docs/05-decisions.md](docs/05-decisions.md)           | 决策索引、被推翻项、未决项         |
| [docs/history/](docs/history)                          | 设计史（可能被取代）               |

## 命令

```bash
bun install
bun run build
bun run test
bun run lint
bun run format
```

## License

[MIT](LICENSE)
