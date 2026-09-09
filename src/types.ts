export const stashItemTypes = [
  'Wombgift',
  'Corpse',
  'Incubator',
  'UniqueWeapon',
  'UniqueArmour',
  'UniqueAccessory',
  'UniqueFlask',
  'UniqueJewel',
  'ForbiddenJewel',
  'ShrineBelt',
  'UniqueTincture',
  'UniqueRelic',
  'SkillGem',
  'ImbuedGem',
  'ClusterJewel',
  'Map',
  'BlightedMap',
  'BlightRavagedMap',
  'UniqueMap',
  'ValdoMap',
  'Invitation',
  'Memory',
  'IncursionTemple',
  'ScryingOrb',
  'BaseType',
  'Flask',
  'Beast',
  'Vial'
] as const;

export type StashItemType = (typeof stashItemTypes)[number];

export const exchangeItemTypes = [
  'Currency',
  'Fragment',
  'Runegraft',
  'AllflameEmber',
  'Tattoo',
  'Omen',
  'DjinnCoin',
  'Ducat',
  'EnshroudingCrystal',
  'DivinationCard',
  'Artifact',
  'Oil',
  'DeliriumOrb',
  'Scarab',
  'Astrolabe',
  'Fossil',
  'Resonator',
  'Essence'
] as const;

export type ExchangeItemType = (typeof exchangeItemTypes)[number];

export const stashCurrencyTypes = ['Currency', 'Fragment'] as const;

export type StashCurrencyType = (typeof stashCurrencyTypes)[number];

export type CacheConfig = {
  expirationSec: number;
};

export type ListenConfig = {
  host: string;
  port: number;
  corsDomain: string;
  trustProxy: boolean;
  rateLimiter: {
    windowMs: number;
    limit: number;
  };
};

export type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type CacheResult<T> = {
  value: T;
  hit: boolean;
};

export type NinjaConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type AppConfig = {
  cache: CacheConfig;
  listen: ListenConfig;
  ninja: NinjaConfig;
};
