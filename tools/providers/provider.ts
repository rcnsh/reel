import type { AssetEntry } from '../asset-manifest';
import type { HttpEnv } from '../http';

export type ProviderEnv = HttpEnv;

export interface AssetProvider {
  id: string;
  kinds: AssetEntry['kind'][];
  keyVar: string;
  model(env: ProviderEnv['env']): string;
  generate(a: AssetEntry, work: string, ctx: ProviderEnv): Promise<string>;
}
