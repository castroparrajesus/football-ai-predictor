import { ProviderId } from './types.ts';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry<unknown>>();
const lastRequestByProvider = new Map<ProviderId, number>();
const quotaByProvider = new Map<ProviderId, string>();

/**
 * Garantiza un intervalo mínimo entre peticiones por proveedor para respetar límites de cuota gratuita
 * (ej. Football-Data.org = 10 req/min -> mínimo 6200ms entre peticiones; API-Football = 6200ms).
 */
export async function enforceProviderRateLimit(
  provider: ProviderId,
  minIntervalMs: number
): Promise<void> {
  const last = lastRequestByProvider.get(provider) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < minIntervalMs) {
    const waitMs = minIntervalMs - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestByProvider.set(provider, Date.now());
}

export function getCachedProviderResponse<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCachedProviderResponse<T>(
  key: string,
  value: T,
  ttlMs = 120_000
): void {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function updateProviderQuota(provider: ProviderId, quotaText: string | null): void {
  if (quotaText && quotaText.trim().length > 0) {
    quotaByProvider.set(provider, quotaText.trim());
  }
}

export function getProviderQuota(provider: ProviderId): string | null {
  return quotaByProvider.get(provider) ?? null;
}
