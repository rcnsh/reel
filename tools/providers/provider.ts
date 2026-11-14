// What a generated-asset provider gives `reel assets`. One file per provider in tools/providers/, listed in index.ts.
import type { AssetEntry } from '../asset-manifest';

export interface ProviderEnv { env: Record<string, string | undefined>; fetch: typeof fetch }

export interface AssetProvider {
  /** 'openai-image': what the record names. */
  id: string;
  kinds: AssetEntry['kind'][];
  /** The environment variable that holds its key: nothing is sent unless it is set. */
  keyVar: string;
  /** The model, part of each asset's cache key. */
  model(env: ProviderEnv['env']): string;
  /** Generate the asset into a file in `work` (any format ffmpeg reads); reel assets fits it to the asset's size and format. */
  generate(a: AssetEntry, work: string, ctx: ProviderEnv): Promise<string>;
}
