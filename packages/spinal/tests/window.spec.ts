import type { Sampler } from "@sekizui/arc";
import { SampleError, sample, signatureOf } from "@sekizui/spinal";
import { describe, expect, it } from "vitest";

function makeSampler(values: Record<string, unknown>, generation = 1): Sampler {
  return {
    declares: [
      { path: "hp_percent", type: "number" },
      { path: "enemies", type: "array" },
      { path: "enemies[*].dist", type: "number" },
      { path: "placing_now", type: "boolean" },
    ],
    read: () => values,
    generation: () => generation,
  };
}

describe("sample", () => {
  it("把读数、时刻与代次一起交出来", () => {
    const values = { hp_percent: 45, enemies: [{ dist: 6 }], placing_now: true };
    expect(sample(makeSampler(values, 7), 1_000)).toEqual({ values, observedAt: 1_000, generation: 7 });
  });

  it("根变量缺席就报错", () => {
    expect(() => sample(makeSampler({ hp_percent: 45, placing_now: true }), 0)).toThrow(SampleError);
    expect(() => sample(makeSampler({ hp_percent: 45, placing_now: true }), 0)).toThrow("没有给出根变量 enemies");
  });

  it("根变量类型不符就报错", () => {
    expect(() => sample(makeSampler({ hp_percent: 45, enemies: 3, placing_now: true }), 0)).toThrow("声明 array，实际 number");
  });

  it("叶子取不到不算错，敌人没了是合法的", () => {
    expect(sample(makeSampler({ hp_percent: 45, enemies: [], placing_now: false }), 0).values.enemies).toEqual([]);
  });
});

describe("signatureOf", () => {
  const state = { hp_percent: 45, "enemies[*].dist": [6] };

  it("同一代次下同一个状态是同一个签名", () => {
    expect(signatureOf(state, 1)).toBe(signatureOf({ ...state }, 1));
  });

  it("状态变了就换签名", () => {
    expect(signatureOf(state, 1)).not.toBe(signatureOf({ ...state, hp_percent: 44 }, 1));
  });

  it("换代了就换签名", () => {
    expect(signatureOf(state, 1)).not.toBe(signatureOf(state, 2));
  });
});
