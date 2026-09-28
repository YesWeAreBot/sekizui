# @sekizui/arc

反射弧的契约与数据模型。纯数据与纯函数，不认识 Cordis，也不发请求。

## 三样东西

- **变量目录**（`SampleCatalog`）：采样面能提供哪些变量，归代码所有。
- **采样面**（`Sampler`）：把当前世界读成一份读数，并给出连接代次。
- **弧声明**（`ArcSpec`）：生效条件、失效条件、状态投影、问题与判据、候选动作子集、保底动作、守卫。

另外带上与判断服务方一一对应的问题与回答类型（`Question` / `Answer`）。

## 目录与采样

`path` 有两种用法：

- **根变量**：只写名字（`enemies`）。采样时校验它存在、类型相符。缺席或类型不对就报错。
- **叶子**：写成路径（`enemies[*].dist`）。它只是弧可以引用的白名单；采样时缺席是合法的（敌人没了，自然取不到）。

```ts
import { compileArc, project, type Sampler } from "@sekizui/arc";

const sampler: Sampler = {
  declares: [
    { path: "hp_percent", type: "number", cost: 4 },
    { path: "enemies", type: "array", cost: 24 },
    { path: "enemies[*].dist", type: "number", unit: "格", validWhen: "enemies.length > 0", cost: 8 },
  ],
  read: () => ({ hp_percent: 45, enemies: [{ dist: 6 }, { dist: 12 }] }),
  generation: () => connectionGeneration,
};
```

## 弧与投影

```ts
const arc = compileArc(
  {
    id: "kite",
    on: "场上有敌对",
    off: "敌对清空",
    projection: ["hp_percent", "enemies[*].dist"],
    questions: [{ id: "horiz", type: "choice", instructions: "该拉开还是贴近", criteria: { Away: "太近", Near: "太远" } }],
    liveActions: ["Away", "Hold", "Near"],
    fallbackAction: "Hold",
    guards: { ttlMs: 1_500, minConfidence: 0.6 },
  },
  sampler,
);

project(arc, { values: sampler.read(), observedAt: 1_000, generation: 3 });
// { hp_percent: 45, "enemies[*].dist": [6, 12] }
```

## 问题类型

三种，与判断服务方的契约一致：

| 类型     | 判据                     | 回答                                    |
| -------- | ------------------------ | --------------------------------------- |
| `noul`   | 可选的 `{true, false}`   | `{ noul }`，成立的概率                  |
| `choice` | 选项 → 描述，最多 255 个 | `{ choice, probabilities, confidence }` |
| `score`  | 有序档位，2 到 10 档     | `{ score, legend, confidence }`         |

问题 `id` 只给代码用，不会送进模型。同一条弧里 id 不能重复。

## 置信

`choice` 与 `score` 直接用服务方给的 `confidence`；**`noul` 没有 confidence**，按概率离抛硬币多远折算成 `|2p−1|`。一组回答的整体置信取最弱的一条。

## 约定

- **`Sampler.read()` 可以抛。** 读不到世界就抛，别返回编造的默认值——上层会把这一拍当作没有可用读数，旧判决停止续期、过了存活期就退保底。`generation()` 同理：只在真的读得到世界时才往后走。
- 路径里的下标一律当通配：目录声明 `enemies[*].dist`，弧写 `enemies[0].dist` 或 `enemies[2].dist` 都是同一项，投影出来的字段名统一是 `enemies[*].dist`。
- 可以整个根变量一起投影（`enemies`），拿到的是原样的结构，行与行之间的对应关系不会丢。
- 取不到的字段是 `undefined`，不静默补默认值；通配碰到非数组返回 `[]`。
- 引用了目录外的变量，在装载弧时就报错，不等到渲染时冒出一个 `undefined`。
- `off` 是必填的。只写"何时生效"不写"何时失效"，留下的是僵尸弧。
- 保底动作必须在候选集里。
