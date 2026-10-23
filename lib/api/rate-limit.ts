/**
 * 极简滑动窗口限流（进程内）。
 *
 * 用途：给 `/api/recommend`、`/api/stores` 这类会打到上游第三方接口的路由
 * 加一层"调用量保护"，避免一个页面刷爆麦当劳接口，也避免被当成免费代理。
 *
 * 明确的局限（不要高估它）：
 * - **进程内**，不支持多实例/多副本共享；生产环境应换成 Redis/网关限流；
 * - 以 IP 为键，NAT 后的用户会共享配额；
 * - 只在单次请求内做判断，不排队、不阻塞。
 *
 * 状态挂在 `globalThis` 上，兼容 Next.js 开发模式的热替换。
 */

export interface RateLimitOptions {
  /** 窗口内允许的最大次数，默认 20 */
  limit?: number;
  /** 窗口长度（毫秒），默认 60_000 */
  windowMs?: number;
  /** 当前时间（便于测试注入） */
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** 建议的重试等待秒数（仅在 allowed=false 时有意义） */
  retryAfterSec: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 60_000;
/** 键数量上限，超过后清理过期键，防止内存无限增长 */
const MAX_KEYS = 5_000;

interface Bucket {
  hits: number[];
}

interface Store {
  buckets: Map<string, Bucket>;
}

const globalKey = Symbol.for("mealmate.rate-limit.store");

function getStore(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  let store = holder[globalKey];
  if (!store) {
    store = { buckets: new Map() };
    holder[globalKey] = store;
  }
  return store;
}

export function checkRateLimit(key: string, options: RateLimitOptions = {}): RateLimitResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now();
  const store = getStore();

  if (store.buckets.size > MAX_KEYS) {
    for (const [k, bucket] of store.buckets) {
      const fresh = bucket.hits.filter((t) => now - t < windowMs);
      if (fresh.length === 0) store.buckets.delete(k);
      else bucket.hits = fresh;
    }
  }

  const bucket = store.buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    store.buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, limit, remaining: 0, retryAfterSec };
  }

  bucket.hits.push(now);
  store.buckets.set(key, bucket);
  return { allowed: true, limit, remaining: Math.max(0, limit - bucket.hits.length), retryAfterSec: 0 };
}

/** 仅供测试：清空计数 */
export function resetRateLimit(): void {
  getStore().buckets.clear();
}

/**
 * 取客户端标识。
 * 只信任反向代理写入的 `x-forwarded-for` 第一段；本机直连时退化为固定键。
 */
export function clientKey(request: Request, scope = "default"): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim() || realIp?.trim() || "local";
  return `${scope}:${ip}`;
}
