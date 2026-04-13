import { ProviderAdapter } from '../types';
import { worldbankAdapter } from './worldbank';
import { whoAdapter } from './who';
import { faostatAdapter } from './faostat';
import { nasaAdapter } from './nasa';
import { gdeltAdapter } from './gdelt';
import { imfAdapter } from './imf';
import { comtradeAdapter } from './comtrade';
import { noaaAdapter } from './noaa';
import { firmsAdapter } from './firms';
import { openAlexAdapter } from './openAlex';

const adapters: Record<string, ProviderAdapter> = {
  worldbank: worldbankAdapter,
  who_gho: whoAdapter,
  faostat: faostatAdapter,
  nasa_power: nasaAdapter,
  gdelt: gdeltAdapter,
  imf: imfAdapter,
  un_comtrade: comtradeAdapter,
  noaa: noaaAdapter,
  nasa_firms: firmsAdapter,
  openalex: openAlexAdapter,
};

export function getAdapter(providerName: string): ProviderAdapter | null {
  return adapters[providerName] || null;
}

export { type ProviderAdapter } from '../types';
