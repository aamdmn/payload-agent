import type { Lock, QueueEntry, StateAdapter } from "chat";

/**
 * In-memory `StateAdapter` used as the default backing store for conversation
 * history, per-thread locks, message queues, and webhook deduplication.
 *
 * It is inlined here (rather than depending on `@chat-adapter/state-memory`) so
 * `payload-agent` carries no `@chat-adapter/*` runtime dependency. Every chat
 * adapter pins `chat` exactly, so bundling one would risk a second copy of
 * `chat` in the host tree; `chat` is a peer dependency and the only types this
 * file needs from it are erased at build time.
 *
 * State lives in process memory: it does not persist across restarts and is not
 * shared across instances. For production, pass a persistent adapter such as
 * `@chat-adapter/state-redis` or `@chat-adapter/state-pg`.
 *
 * Memory bounds: a 60s sweep reclaims expired cache entries, locks, and queue
 * entries even if their keys are never read again, and `maxEntries` (default
 * 10,000 per map) evicts the oldest inserted entries once capacity is reached.
 * Sweep/capacity eviction never touches the subscriptions set; lock eviction
 * happens only through TTL expiry.
 */

const SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

interface CacheEntry {
  expiresAt: null | number;
  value: unknown;
}

function generateToken(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 15)}`;
}

export class MemoryStateAdapter implements StateAdapter {
  private connected = false;
  private readonly subscriptions = new Set<string>();
  private readonly locks = new Map<string, Lock>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly queues = new Map<string, QueueEntry[]>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private readonly maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer.");
    }
  }

  /** @internal Stored counts for tests; does not trigger expiration cleanup. */
  getStoredCounts(): { cache: number; locks: number; queues: number } {
    return {
      cache: this.cache.size,
      locks: this.locks.size,
      queues: this.queues.size,
    };
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.connected = true;
    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async disconnect(): Promise<void> {
    this.connected = false;
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    this.subscriptions.clear();
    this.locks.clear();
    this.cache.clear();
    this.queues.clear();
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.subscriptions.add(threadId);
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.subscriptions.delete(threadId);
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    return this.subscriptions.has(threadId);
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();
    this.cleanExpiredLocks();

    const existingLock = this.locks.get(threadId);
    if (existingLock && existingLock.expiresAt > Date.now()) {
      return null;
    }

    const lock: Lock = {
      threadId,
      token: generateToken(),
      expiresAt: Date.now() + ttlMs,
    };
    this.locks.set(threadId, lock);
    return lock;
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    this.locks.delete(threadId);
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();
    const existingLock = this.locks.get(lock.threadId);
    if (existingLock && existingLock.token === lock.token) {
      this.locks.delete(lock.threadId);
    }
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();
    const existingLock = this.locks.get(lock.threadId);
    if (!existingLock || existingLock.token !== lock.token) {
      return false;
    }
    if (existingLock.expiresAt < Date.now()) {
      this.locks.delete(lock.threadId);
      return false;
    }
    existingLock.expiresAt = Date.now() + ttlMs;
    return true;
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return cached.value as T;
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();
    this.makeRoom(this.cache, key);
    this.cache.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();
    const existing = this.cache.get(key);
    if (existing) {
      if (existing.expiresAt !== null && existing.expiresAt <= Date.now()) {
        this.cache.delete(key);
      } else {
        return false;
      }
    }
    this.makeRoom(this.cache, key);
    this.cache.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
    return true;
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async delete(key: string): Promise<void> {
    this.ensureConnected();
    this.cache.delete(key);
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();
    const cached = this.cache.get(key);

    let list: unknown[];
    if (cached && Array.isArray(cached.value)) {
      const expired =
        cached.expiresAt !== null && cached.expiresAt <= Date.now();
      list = expired ? [] : cached.value;
    } else {
      list = [];
    }

    list.push(value);
    if (options?.maxLength && list.length > options.maxLength) {
      list = list.slice(list.length - options.maxLength);
    }

    this.makeRoom(this.cache, key);
    this.cache.set(key, {
      value: list,
      expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : null,
    });
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();
    const cached = this.cache.get(key);
    if (!cached) {
      return [];
    }
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return [];
    }
    if (Array.isArray(cached.value)) {
      return cached.value as T[];
    }
    return [];
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    this.ensureConnected();
    this.cleanExpiredQueue(threadId, Date.now());
    const queue = this.queues.get(threadId) ?? [];
    if (entry.expiresAt > Date.now()) {
      queue.push(entry);
    }
    if (queue.length > maxSize) {
      queue.splice(0, queue.length - maxSize);
    }
    if (queue.length === 0) {
      this.queues.delete(threadId);
    } else {
      this.makeRoom(this.queues, threadId);
      this.queues.set(threadId, queue);
    }
    return queue.length;
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();
    this.cleanExpiredQueue(threadId, Date.now());
    const queue = this.queues.get(threadId);
    if (!queue || queue.length === 0) {
      return null;
    }
    const entry = queue.shift();
    if (queue.length === 0) {
      this.queues.delete(threadId);
    }
    return entry ?? null;
  }

  // biome-ignore lint/suspicious/useAwait: interface requires an async method
  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();
    this.cleanExpiredQueue(threadId, Date.now());
    return this.queues.get(threadId)?.length ?? 0;
  }

  /**
   * Bounds a map at `maxEntries`. The key being written is exempt so updates
   * to an existing entry never evict it, and held locks are never evicted by
   * the queue path because locks live in their own map.
   */
  private makeRoom<T>(entries: Map<string, T>, key: string): void {
    if (entries.has(key) || entries.size < this.maxEntries) {
      return;
    }
    this.sweepExpired();
    if (entries.size >= this.maxEntries) {
      const oldest = entries.keys().next();
      if (!oldest.done) {
        entries.delete(oldest.value);
      }
    }
  }

  /**
   * Reclaims expired entries across cache, locks, and queues so memory does
   * not grow with keys that are never read again. Runs on a timer started by
   * `connect()` and opportunistically when capacity pressure requires it.
   */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
    this.cleanExpiredLocks();
    for (const threadId of this.queues.keys()) {
      this.cleanExpiredQueue(threadId, now);
    }
  }

  private cleanExpiredQueue(threadId: string, now: number): void {
    const queue = this.queues.get(threadId);
    if (!queue) {
      return;
    }
    const active = queue.filter((entry) => entry.expiresAt > now);
    if (active.length === 0) {
      this.queues.delete(threadId);
    } else if (active.length !== queue.length) {
      this.queues.set(threadId, active);
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "MemoryStateAdapter is not connected. Call connect() first."
      );
    }
  }

  private cleanExpiredLocks(): void {
    const now = Date.now();
    for (const [threadId, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(threadId);
      }
    }
  }
}

/** Create an in-memory `StateAdapter` (development/testing default). */
export function createMemoryState(
  options: ConstructorParameters<typeof MemoryStateAdapter>[0] = {}
): StateAdapter {
  return new MemoryStateAdapter(options);
}
