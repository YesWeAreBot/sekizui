import { createServer, type AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

/** 一个确实没人监听的端口：先占住 0 拿到号，再放掉。 */
export async function closedPort(): Promise<number> {
  const server = createServer();
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const { port } = server.address() as AddressInfo;
  const closed = Promise.withResolvers<void>();
  server.close((error) => (error ? closed.reject(error) : closed.resolve()));
  await closed.promise;
  return port;
}

/** 等一个读数出现。读数是 undefined 就再等一会儿。 */
export async function waitFor<T>(read: () => T | undefined, timeoutMs = 40_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`等超时：${timeoutMs}ms`);
    await delay(100);
  }
}
