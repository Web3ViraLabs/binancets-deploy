import axios from "axios";
import { config } from "./load-data";
import { Candle } from "./interfaces";
import { logDebug } from './logger';
import moment from 'moment';

export async function fetchInitialCandles(symbol: string): Promise<Candle[]> {
  const endpoint = "/fapi/v1/klines";
  const params = {
    symbol: symbol,
    interval: config.api_interval,
    limit: 20,
  };

  try {
    logDebug(
      'SYSTEM',
      "FETCH_CANDLES",
      symbol,
      "Fetching initial candles",
      {
        endpoint,
        params,
        timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
      }
    );

    const response = await axios.get(`https://fapi.binance.com${endpoint}`, {
      params,
    });

    if (response.status !== 200) {
      logDebug(
        'ERROR',
        "API_ERROR",
        symbol,
        "Error fetching initial candles",
        {
          status_code: response.status,
          response_data: response.data
        }
      );
      return [];
    }

    const candles: Candle[] = response.data.map((candle: any) => ({
      openTime: parseInt(candle[0]),
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
      closeTime: parseInt(candle[6]),
      quoteAssetVolume: parseFloat(candle[7]),
      numberOfTrades: parseInt(candle[8]),
      takerBuyBaseAssetVolume: parseFloat(candle[9]),
      takerBuyQuoteAssetVolume: parseFloat(candle[10]),
      ignore: parseFloat(candle[11]),
    }));

    logDebug(
      'SYSTEM',
      "CANDLES_FETCHED",
      symbol,
      "Initial candles fetched successfully",
      {
        candles_count: candles.length,
        first_candle: candles[0],
        last_candle: candles[candles.length - 1]
      }
    );

    return candles;
  } catch (error) {
    logDebug(
      'ERROR',
      "API_ERROR",
      symbol,
      "Error fetching initial candles",
      {
        error: error instanceof Error ? error.message : "Unknown error"
      }
    );
    return [];
  }
}
