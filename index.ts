import { AccountManager } from './lib/account-manager';
import { addCandleToQueue, symbolCandles } from './lib/deque';
import { fetchInitialCandles } from './lib/fetch-kline';
import { Candle } from './lib/interfaces';
import { config, pairSettings } from './lib/load-data';
import { processCandles } from './lib/process-candles';
import {
  KlineInterval,
  WebsocketClient,
  WsMessageKlineRaw,
  WsRawMessage,
} from 'binance';
import { TradeManager } from './lib/trade-manager';
import { checkMovementThreshold } from './lib/movement-threshold';
import { checkTriggers } from './lib/check-triggers';
import {
  tradingLogger,
  debugLogger,
  websocketLogger,
  closeLoggers,
} from './lib/base-logger';
import { logCandle, logDebug, logTrading } from './lib/logger';
import moment from 'moment';
import { startServer } from './lib/server';

// Initialize TradeManager instances for each account
const tradeManagers = new Map<string, TradeManager>();

// Initialize for each account
config.accounts.forEach((account) => {
  const accountManager = new AccountManager(
    `account-data-${account.name}.json`
  );
  accountManager.initializeAccountData(account.name, config.pairs);

  // Create trade manager for each account and store in Map
  tradeManagers.set(
    account.name,
    new TradeManager(
      account.name,
      accountManager,
      account.api_key,
      account.api_secret
    )
  );
});

const wsClient = new WebsocketClient({
  beautify: true,
});

function isWsMessageKlineRaw(data: WsRawMessage): data is WsMessageKlineRaw {
  return (data as WsMessageKlineRaw).e === 'kline';
}

// Helper function to convert timestamp to IST
function getISTTime(timestamp: number): string {
  return moment(timestamp)
    .utcOffset('+05:30')
    .format('YYYY-MM-DD HH:mm:ss.SSS');
}

let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

wsClient.on('message', async (data: WsRawMessage) => {
  if (isWsMessageKlineRaw(data)) {
    try {
      const kline = data.k;
      const candle: Candle = {
        openTime: kline.t,
        open: parseFloat(kline.o as string),
        high: parseFloat(kline.h as string),
        low: parseFloat(kline.l as string),
        close: parseFloat(kline.c as string),
        volume: parseFloat(kline.v as string),
        closeTime: kline.T,
        quoteAssetVolume: parseFloat(kline.q as string),
        numberOfTrades: kline.n,
        takerBuyBaseAssetVolume: parseFloat(kline.V as string),
        takerBuyQuoteAssetVolume: parseFloat(kline.Q as string),
        ignore: 0,
      };

      // Process for each account
      for (const account of config.accounts) {
        const tradeManager = tradeManagers.get(account.name);
        if (!tradeManager) {
          debugLogger.debug({
            type: 'SYSTEM',
            event: 'ERROR',
            symbol: kline.s,
            message: `No trade manager found for account ${account.name}`,
          });
          continue;
        }

        const accountManager = tradeManager.getAccountManager();
        await processAllTokens(
          account.name,
          kline.s,
          candle.close,
          tradeManager,
          accountManager
        );
      }

      // Only log and process completed candles
      if (kline.x) {
        debugLogger.debug({
          type: 'CANDLE',
          event: 'CANDLE_CLOSED',
          symbol: kline.s,
          message: 'Processing closed candle',
          details: {
            candle,
            openTime_ist: getISTTime(candle.openTime),
            closeTime_ist: getISTTime(candle.closeTime),
            timestamp: moment()
              .utcOffset('+05:30')
              .format('YYYY-MM-DD HH:mm:ss.SSS'),
          },
        });

        // Process candles for each account
        for (const account of config.accounts) {
          const tradeManager = tradeManagers.get(account.name);
          if (!tradeManager) continue;

          const accountManager = tradeManager.getAccountManager();
          const processResult = await processCandles(
            account.name,
            kline.s,
            candle,
            accountManager
          );

          debugLogger.debug({
            type: 'CANDLE',
            event: 'CANDLE_PROCESSED',
            symbol: kline.s,
            message: 'Candle processing result',
            details: {
              process_result: processResult,
              current_candles_count: symbolCandles[kline.s].length,
              candle_times: {
                openTime_ist: getISTTime(candle.openTime),
                closeTime_ist: getISTTime(candle.closeTime),
              },
            },
          });
        }

        symbolCandles[kline.s] = addCandleToQueue(
          symbolCandles[kline.s],
          candle
        );
      }
    } catch (error) {
      websocketLogger.debug({
        type: 'WEBSOCKET',
        event: 'MESSAGE_ERROR',
        symbol: 'SYSTEM',
        message: 'Error processing WebSocket message',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }
});

// Add WebSocket connection event handlers
wsClient.on('open', () => {
  wsReconnectAttempts = 0;
  websocketLogger.debug({
    type: 'WEBSOCKET',
    event: 'CONNECTION_OPENED',
    symbol: 'SYSTEM',
    message: 'WebSocket connection opened',
  });
});

wsClient.on('error', (error) => {
  websocketLogger.debug({
    type: 'WEBSOCKET',
    event: 'CONNECTION_ERROR',
    symbol: 'SYSTEM',
    message: 'WebSocket error occurred',
    details: {
      error: error instanceof Error ? error.message : 'Unknown error',
    },
  });
});

wsClient.on('close', async () => {
  if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    websocketLogger.debug({
      type: 'WEBSOCKET',
      event: 'RECONNECTING',
      symbol: 'SYSTEM',
      message: `Attempting to reconnect (${wsReconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`
    });
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    config.pairs.forEach(pair => {
      wsClient.subscribeKlines(
        pair.symbol,
        config.websocket_interval as KlineInterval,
        'usdm'
      );
    });
    wsReconnectAttempts++;
  } else {
    websocketLogger.debug({
      type: 'WEBSOCKET',
      event: 'MAX_RECONNECT_REACHED',
      symbol: 'SYSTEM',
      message: 'Maximum reconnection attempts reached'
    });
  }
});

async function processAllTokens(
  accountName: string,
  symbol: string,
  currentPrice: number,
  tradeManager: TradeManager,
  accountManager: AccountManager
): Promise<void> {
  try {
    await checkMovementThreshold(
      accountName,
      symbol,
      currentPrice,
      tradeManager,
      accountManager
    );

    await checkTriggers(
      accountName,
      symbol,
      currentPrice,
      tradeManager,
      accountManager
    );
  } catch (error) {
    tradingLogger.info({
      event: 'ERROR',
      symbol,
      message: `Error processing for account: ${accountName}`,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        account: accountName,
        current_price: currentPrice,
      },
    });
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  tradingLogger.info({
    event: "SHUTDOWN",
    symbol: "SYSTEM",
    message: "Gracefully shutting down",
    details: { timestamp: new Date().toISOString() }
  });
  
  wsClient.close('usdm', true);
  closeLoggers();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
});

async function main() {
  try {
    // Validate configuration
    if (!config.pairs.length) {
      throw new Error('No trading pairs configured');
    }

    if (!config.accounts.length) {
      throw new Error('No trading accounts configured');
    }

    await logTrading('SYSTEM_START', 'SYSTEM', 'Trading system starting', {
      timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
      config: {
        pairs: config.pairs.length,
        accounts: config.accounts.length,
      },
    });

    // Start the health check server
    startServer();

    const fetchPromises = config.pairs.map(async (pair) => {
      const symbol = pair.symbol;
      debugLogger.debug({
        type: 'SYSTEM',
        event: 'FETCH_CANDLES',
        symbol,
        message: 'Fetching initial candles',
        details: { symbol },
      });

      const candles = await fetchInitialCandles(symbol);
      for (const candle of candles) {
        symbolCandles[symbol] = addCandleToQueue(symbolCandles[symbol], candle);
      }

      debugLogger.debug({
        type: 'WEBSOCKET',
        event: 'SUBSCRIBE_KLINES',
        symbol,
        message: 'Subscribing to klines',
        details: {
          symbol,
          interval: config.websocket_interval,
        },
      });

      wsClient.subscribeKlines(
        symbol,
        config.websocket_interval as KlineInterval,
        'usdm'
      );
    });

    await Promise.all(fetchPromises);
  } catch (error) {
    tradingLogger.info({
      event: 'STARTUP_ERROR',
      symbol: 'SYSTEM',
      message: 'Error during startup',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    process.exit(1);
  }
}

main();
