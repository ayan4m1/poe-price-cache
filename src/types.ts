export type CacheConfig = {
  expirationSec: number;
};

export type ListenConfig = {
  host: string;
  port: number;
  corsDomain: string;
  rateLimiter: {
    windowMs: number;
    limit: number;
  };
};
