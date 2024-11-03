import fs from "fs";
import { Config, Pair } from "./interfaces";
import { logDebug } from './logger';
import moment from 'moment';

export const config: Config = JSON.parse(
  fs.readFileSync("config.json", "utf-8")
);

export const pairSettings: Record<string, Pair> = config.pairs.reduce(
  (acc: Record<string, Pair>, pair: Pair) => {
    acc[pair.symbol] = pair;
    return acc;
  },
  {}
);

// Log configuration loading
logDebug(
  'SYSTEM',
  "SYSTEM_CONFIG",
  "SYSTEM",
  "Configuration loaded",
  {
    pairs_count: config.pairs.length,
    tokens: config.tokens,
    timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
  }
);
