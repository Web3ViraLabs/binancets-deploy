import { Pair, Candle } from "./interfaces";
import { config } from "./load-data";
import { logCandle } from "./logger";

// Define the type for symbol candles
type SymbolCandles = Record<string, Candle[]>;

// Function to add a new candle to the queue
export function addCandleToQueue(
  candles: Candle[],
  candle: Candle,
  maxLength: number = 20
): Candle[] {
  if (candles.length >= maxLength) {
    candles.shift(); // Remove the oldest candle
  }
  candles.push(candle); // Add the new candle
  return candles;
}

// Initialize symbolCandles
export const symbolCandles: SymbolCandles = config.pairs.reduce(
  (acc: SymbolCandles, pair: Pair) => {
    acc[pair.symbol] = []; // Empty array for each symbol
    logCandle(pair.symbol, "Initialized candle queue", {
      symbol: pair.symbol,
      timestamp: new Date().toISOString()
    });
    return acc;
  },
  {}
);

// // Example: Mock candle data
// for (let i = 1; i <= 21; i++) {
//   const newCandle: Candle = {
//     openTime: i,
//     open: (i + 0.1).toString(),
//     high: (i + 0.2).toString(),
//     low: (i + 0.3).toString(),
//     close: (i + 0.4).toString(),
//     volume: (i + 0.5).toString(),
//     closeTime: i + 1000,
//     quoteAssetVolume: (i + 0.6).toString(),
//     numberOfTrades: i + 10,
//     takerBuyBaseAssetVolume: (i + 0.7).toString(),
//     takerBuyQuoteAssetVolume: (i + 0.8).toString(),
//     ignore: "0",
//   };

//   symbolCandles["XRPUSDT"] = addCandleToQueue(
//     symbolCandles["XRPUSDT"],
//     newCandle
//   );
// }

// logger.info(symbolCandles); // Logs updated candles for XRPUSDT
