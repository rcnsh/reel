import type { AssetEntry } from '../asset-manifest';
import { elevenlabsSound } from './elevenlabs-sound';
import { openaiImage } from './openai-image';
import type { AssetProvider } from './provider';

export const PROVIDERS: AssetProvider[] = [openaiImage, elevenlabsSound];

export const providerFor = (kind: AssetEntry['kind']) => PROVIDERS.find((p) => p.kinds.includes(kind))!;

export type { AssetProvider, ProviderEnv } from './provider';
