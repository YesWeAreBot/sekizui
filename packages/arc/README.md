# @sekizui/arc

反射弧的契约与数据模型。纯数据与纯函数，不认识 Cordis，也不发请求。

## 三样东西

- **状态变量目录**（`SampleCatalog`）：采样面能提供哪些变量，归代码所有。弧只能引用目录里已有的路径，引用别的当场报错，而不是在渲染时冒出一个 `undefined`。
- **弧声明**（`ArcSpec`）：生效条件、失效条件、状态投影、问题与判据、候选动作子集、保底动作、守卫（TTL 与最低置信）。
- **投影**（`compileArc` + `project`）：把一份快照按弧声明的路径取出这一步要用的 state。路径在加载时就解析成路径段，渲染时不再解析字符串。

## 用法

```ts
import { compileArc, project, type SampleCatalog, type Snapshot } from "@sekizui/arc";

const catalog: SampleCatalog = {
  declares: [
    { path: "hp_percent", type: "number", cost: 4 },
    { path: "enemies[*].dist", type: "number", unit: "格", validWhen: "enemies.length > 0", cost: 8 },
  ],
};

const arc = compileArc(
  {
    id: "kite",
    on: "场上有敌对",
    off: "敌对清空",
    projection: ["hp_percent", "enemies[*].dist"],
    questions: [{ id: "horiz", instructions: "该拉开还是贴近", criteria: { Away: "太近", Near: "太远" } }],
    liveActions: ["Away", "Hold", "Near"],
    fallbackAction: "Hold",
    guards: { ttlMs: 1500, minConfidence: 0.6 },
  },
  catalog,
);

const snapshot: Snapshot = { values: { hp_percent: 45, enemies: [{ dist: 6 }] }, observedAt: 1_000, generation: 3 };
project(arc, snapshot);
// { hp_percent: 45, "enemies[*].dist": [6] }
```

state 的字段名就是目录里的路径，判断日志据此能直接还原"它当时看到什么"。

## 约定

- 路径里的下标一律当通配：目录声明 `enemies[*].dist`，弧写 `enemies[0].dist` 或 `enemies[2].dist` 都指向同一项。
- 取不到的字段是 `undefined`，不静默补默认值。
- 投影路径没有通配时碰到数组，返回 `[]`；碰到非对象，返回 `undefined`。
- `off` 是必填的。只写"何时生效"不写"何时失效"，留下的是僵尸弧。
