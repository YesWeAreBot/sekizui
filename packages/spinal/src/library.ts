import { readFile } from "node:fs/promises";

import { ArcSpecError, arcDocumentSchema, compileArc, type CompiledArc, type SampleCatalog } from "@sekizui/arc";

const emptyCatalog: SampleCatalog = { declares: [] };

/**
 * 弧库：一份弧声明文档，加载时校验并预编译。
 *
 * 整份加载，不做部分加载：任一条不合法就整份拒绝，避免库里留下一半新一半旧。
 * 写入与版本号留给编排层的工具面。
 */
export class ArcLibrary {
  private arcs: CompiledArc[] = [];

  /** 变量目录归采样面所有；没有目录时任何弧都加载不了，这是有意的。 */
  constructor(private readonly catalog: SampleCatalog = emptyCatalog) {}

  get size(): number {
    return this.arcs.length;
  }

  list(): readonly CompiledArc[] {
    return this.arcs;
  }

  get(id: string): CompiledArc | undefined {
    return this.arcs.find((arc) => arc.spec.id === id);
  }

  load(document: unknown): void {
    const { arcs } = arcDocumentSchema.parse(document);
    const compiled = arcs.map((arc) => compileArc(arc, this.catalog));
    const ids = compiled.map((arc) => arc.spec.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate !== undefined) throw new ArcSpecError(`弧 id 重复：${duplicate}`);
    this.arcs = compiled;
  }

  async loadFile(path: string): Promise<void> {
    this.load(JSON.parse(await readFile(path, "utf8")));
  }
}
