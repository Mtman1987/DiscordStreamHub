type RuntimeConfigResponse = {
  publicUrls?: Record<string, string>;
  publicIds?: Record<string, string>;
  publicText?: Record<string, string>;
  publicNumbers?: Record<string, number>;
  publicFlags?: Record<string, boolean>;
};

let cachedConfig: RuntimeConfigResponse | null = null;
let inflight: Promise<RuntimeConfigResponse | null> | null = null;

export async function getRuntimeConfigClient(): Promise<RuntimeConfigResponse | null> {
  if (cachedConfig) return cachedConfig;
  if (inflight) return inflight;

  inflight = fetch('/api/runtime-config', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (data && typeof data === 'object') {
        cachedConfig = data;
        return data as RuntimeConfigResponse;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getRuntimeConfigFallback(): RuntimeConfigResponse {
  return {
    publicUrls: {},
    publicIds: {},
    publicText: {},
    publicNumbers: {},
    publicFlags: {},
  };
}
