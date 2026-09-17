import type { Lock, Message, QueueEntry } from "chat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryStateAdapter } from "./memory-state.js";

const SWEEP_INTERVAL_MS = 60_000;

let adapter: MemoryStateAdapter;

function queueEntry(id: string, ttlMs: number): QueueEntry {
  const now = Date.now();
  return {
    enqueuedAt: now,
    expiresAt: now + ttlMs,
    message: { id, threadId: "thread-1" } as unknown as Message,
  };
}

async function acquire(threadId: string, ttlMs = 1000): Promise<Lock> {
  const lock = await adapter.acquireLock(threadId, ttlMs);
  if (!lock) {
    throw new Error(`expected a lock for ${threadId}`);
  }
  return lock;
}

beforeEach(async () => {
  vi.useFakeTimers();
  adapter = new MemoryStateAdapter();
  await adapter.connect();
});

afterEach(async () => {
  await adapter.disconnect();
  vi.useRealTimers();
});

describe("cache", () => {
  test("stores a value without a ttl", async () => {
    await adapter.set("key", { hello: "world" });
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 10);
    expect(await adapter.get("key")).toEqual({ hello: "world" });
  });

  test("expires a value once its ttl elapses", async () => {
    await adapter.set("key", "value", 1000);
    expect(await adapter.get("key")).toBe("value");
    vi.advanceTimersByTime(1001);
    expect(await adapter.get("key")).toBeNull();
  });

  test("setIfNotExists does not overwrite a live key", async () => {
    expect(await adapter.setIfNotExists("key", "first", 1000)).toBe(true);
    expect(await adapter.setIfNotExists("key", "second", 1000)).toBe(false);
    expect(await adapter.get("key")).toBe("first");
  });

  test("setIfNotExists succeeds once the existing key expires", async () => {
    await adapter.setIfNotExists("key", "first", 1000);
    vi.advanceTimersByTime(1001);
    expect(await adapter.setIfNotExists("key", "second")).toBe(true);
    expect(await adapter.get("key")).toBe("second");
  });
});

describe("lists", () => {
  test("trims to maxLength keeping the newest entries", async () => {
    await adapter.appendToList("list", "a", { maxLength: 2 });
    await adapter.appendToList("list", "b", { maxLength: 2 });
    await adapter.appendToList("list", "c", { maxLength: 2 });
    expect(await adapter.getList("list")).toEqual(["b", "c"]);
  });

  test("expires the whole list once its ttl elapses", async () => {
    await adapter.appendToList("list", "a", { ttlMs: 1000 });
    expect(await adapter.getList("list")).toEqual(["a"]);
    vi.advanceTimersByTime(1001);
    expect(await adapter.getList("list")).toEqual([]);
  });
});

describe("locks", () => {
  test("a held lock blocks a second acquire until released", async () => {
    const lock = await acquire("thread");
    expect(await adapter.acquireLock("thread", 1000)).toBeNull();
    await adapter.releaseLock(lock);
    expect(await adapter.acquireLock("thread", 1000)).not.toBeNull();
  });

  test("release only clears the matching token", async () => {
    const lock = await acquire("thread");
    await adapter.releaseLock({ ...lock, token: "other" });
    expect(await adapter.acquireLock("thread", 1000)).toBeNull();
  });

  test("extend refreshes the ttl of a held lock", async () => {
    const lock = await acquire("thread", 1000);
    vi.advanceTimersByTime(900);
    expect(await adapter.extendLock(lock, 5000)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(await adapter.acquireLock("thread", 1000)).toBeNull();
  });

  test("extend fails for a token mismatch or an expired lock", async () => {
    const lock = await acquire("thread", 1000);
    const mismatch = { ...lock, token: "other" };
    expect(await adapter.extendLock(mismatch, 1000)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(await adapter.extendLock(lock, 1000)).toBe(false);
    expect(await adapter.acquireLock("thread", 1000)).not.toBeNull();
  });

  test("an expired lock does not block a new acquire", async () => {
    await acquire("thread", 1000);
    vi.advanceTimersByTime(1001);
    expect(await adapter.acquireLock("thread", 1000)).not.toBeNull();
  });
});

describe("sweep", () => {
  test("reclaims expired entries whose keys are never read again", async () => {
    await adapter.set("cache", "value", 1000);
    await adapter.set("live", "value", SWEEP_INTERVAL_MS * 2);
    await acquire("lock", 1000);
    await adapter.enqueue("thread", queueEntry("msg-1", 1000), 10);

    expect(adapter.getStoredCounts()).toEqual({
      cache: 2,
      locks: 1,
      queues: 1,
    });

    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);

    expect(adapter.getStoredCounts()).toEqual({
      cache: 1,
      locks: 0,
      queues: 0,
    });
    expect(await adapter.get("live")).toBe("value");
  });
});

describe("capacity", () => {
  test("evicts the oldest cache entry once maxEntries is reached", async () => {
    const bounded = new MemoryStateAdapter({ maxEntries: 2 });
    await bounded.connect();
    await bounded.set("first", 1);
    await bounded.set("second", 2);
    await bounded.set("third", 3);

    expect(await bounded.get("first")).toBeNull();
    expect(await bounded.get("second")).toBe(2);
    expect(await bounded.get("third")).toBe(3);
    expect(bounded.getStoredCounts().cache).toBe(2);
    await bounded.disconnect();
  });

  test("evicts the oldest queue once maxEntries is reached", async () => {
    const bounded = new MemoryStateAdapter({ maxEntries: 2 });
    await bounded.connect();
    await bounded.enqueue("a", queueEntry("a", 5000), 10);
    await bounded.enqueue("b", queueEntry("b", 5000), 10);
    await bounded.enqueue("c", queueEntry("c", 5000), 10);

    expect(await bounded.queueDepth("a")).toBe(0);
    expect(await bounded.queueDepth("c")).toBe(1);
    await bounded.disconnect();
  });

  test("never evicts held locks", async () => {
    const bounded = new MemoryStateAdapter({ maxEntries: 1 });
    await bounded.connect();
    await bounded.acquireLock("locked", 60_000);
    await bounded.set("first", 1);
    await bounded.set("second", 2);

    expect(bounded.getStoredCounts().locks).toBe(1);
    expect(await bounded.acquireLock("locked", 1000)).toBeNull();
    await bounded.disconnect();
  });

  test("rejects a maxEntries below 1", () => {
    expect(() => new MemoryStateAdapter({ maxEntries: 0 })).toThrow();
    expect(() => new MemoryStateAdapter({ maxEntries: 1.5 })).toThrow();
  });
});

describe("lifecycle", () => {
  test("connect starts one sweep timer and disconnect stops it", async () => {
    await adapter.disconnect();
    const baseline = vi.getTimerCount();

    await adapter.connect();
    expect(vi.getTimerCount()).toBe(baseline + 1);
    await adapter.connect();
    expect(vi.getTimerCount()).toBe(baseline + 1);

    await adapter.disconnect();
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
