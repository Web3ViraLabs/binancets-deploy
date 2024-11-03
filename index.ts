import {AccountManager} from "./lib/account-manager";
import {addCandleToQueue, symbolCandles} from "./lib/deque";
import {fetchInitialCandles} from "./lib/fetch-kline";
import {Candle} from "./lib/interfaces";
import {config, pairSettings} from "./lib/load-data";
import {processCandles} from "./lib/process-candles";
import {
    KlineInterval,
    WebsocketClient,
    WsMessageKlineRaw,
    WsRawMessage,
} from "binance";
import {TradeManager} from "./lib/trade-manager";
import {checkMovementThreshold} from "./lib/movement-threshold";
import {checkTriggers} from "./lib/check-triggers";
import { tradingLogger, debugLogger, websocketLogger } from './lib/base-logger';
import { logCandle, logDebug } from './lib/logger';
import moment from 'moment';
import { startServer } from './lib/server';

const accountManager = new AccountManager("account-data.json");
accountManager.initializeAccountData(config.tokens, config.pairs);

// Initialize TradeManager instances for each token
const tradeManagers: Record<string, TradeManager> = {};

config.tokens.forEach((token) => {
    tradeManagers[token] = new TradeManager(token, accountManager);
});

const wsClient = new WebsocketClient({
    beautify: true,
});

function isWsMessageKlineRaw(data: WsRawMessage): data is WsMessageKlineRaw {
    return (data as WsMessageKlineRaw).e === "kline";
}

// Helper function to convert timestamp to IST
function getISTTime(timestamp: number): string {
    return moment(timestamp).utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS');
}

wsClient.on("message", async (data: WsRawMessage) => {
    if (isWsMessageKlineRaw(data)) {
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

        // Silently process price updates for movement threshold and triggers
        await processAllTokens(
            config.tokens,
            kline.s,
            candle.close,
            accountManager
        );

        // Only log and process completed candles
        if (kline.x) {  // If candle is closed
            debugLogger.debug({
                type: 'CANDLE',
                event: 'CANDLE_CLOSED',
                symbol: kline.s,
                message: 'Processing closed candle',
                details: { 
                    candle,
                    openTime_ist: getISTTime(candle.openTime),
                    closeTime_ist: getISTTime(candle.closeTime),
                    timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
                }
            });

            const result = await processCandles(kline.s, candle, accountManager);
            symbolCandles[kline.s] = addCandleToQueue(symbolCandles[kline.s], candle);

            debugLogger.debug({
                type: 'CANDLE',
                event: 'CANDLE_PROCESSED',
                symbol: kline.s,
                message: 'Candle processing result',
                details: { 
                    result,
                    current_candles_count: symbolCandles[kline.s].length,
                    candle_times: {
                        openTime_ist: getISTTime(candle.openTime),
                        closeTime_ist: getISTTime(candle.closeTime)
                    },
                    timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
                }
            });
        }
    }
});

// Add WebSocket connection event handlers
wsClient.on('open', (event) => {
    websocketLogger.debug({
        type: 'WEBSOCKET',
        event: 'CONNECTION_OPENED',
        symbol: 'SYSTEM',
        message: 'WebSocket connection opened',
        details: event
    });
});

wsClient.on('error', (error) => {
    websocketLogger.debug({
        type: 'WEBSOCKET',
        event: 'ERROR',
        symbol: 'SYSTEM',
        message: 'WebSocket error occurred',
        details: {
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    });
});

wsClient.on('close', () => {
    websocketLogger.debug({
        type: 'WEBSOCKET',
        event: 'CONNECTION_CLOSED',
        symbol: 'SYSTEM',
        message: 'WebSocket connection closed'
    });
});

async function processAllTokens(
    tokens: string[],
    symbol: string,
    currentPrice: number,
    accountManager: AccountManager
): Promise<void> {
    const thresholdPromises = tokens.map((token) => {
        const tradeManager = tradeManagers[token];
        return checkMovementThreshold(
            token,
            symbol,
            currentPrice,
            tradeManager,
            accountManager
        ).catch((error) => {
            tradingLogger.info({
                event: "ERROR",
                symbol,
                message: `Error checking movement threshold for token: ${token}`,
                details: { error: error instanceof Error ? error.message : "Unknown error" }
            });
        });
    });

    await Promise.all(thresholdPromises);

    const triggerPromises = tokens.map((token) => {
        const tradeManager = tradeManagers[token];
        return checkTriggers(
            token,
            symbol,
            currentPrice,
            tradeManager,
            accountManager
        ).catch((error) => {
            tradingLogger.info({
                event: "ERROR",
                symbol,
                message: `Error checking triggers for token: ${token}`,
                details: { error: error instanceof Error ? error.message : "Unknown error" }
            });
        });
    });

    await Promise.all(triggerPromises);
}

async function main() {
    tradingLogger.info({
        event: "SYSTEM_START",
        symbol: "SYSTEM",
        message: "Starting trading system",
        details: { pair_settings: pairSettings }
    });

    // Start the health check server
    startServer();

    const fetchPromises = config.pairs.map(async (pair) => {
        const symbol = pair.symbol;
        debugLogger.debug({
            type: 'SYSTEM',
            event: "FETCH_CANDLES",
            symbol,
            message: "Fetching initial candles",
            details: { symbol }
        });
        
        const candles = await fetchInitialCandles(symbol);
        for (const candle of candles) {
            symbolCandles[symbol] = addCandleToQueue(symbolCandles[symbol], candle);
        }

        debugLogger.debug({
            type: 'WEBSOCKET',
            event: "SUBSCRIBE_KLINES",
            symbol,
            message: "Subscribing to klines",
            details: { 
                symbol,
                interval: config.websocket_interval 
            }
        });

        // Subscribe to kline data
        wsClient.subscribeKlines(
            symbol,
            config.websocket_interval as KlineInterval,
            "usdm"
        );
    });

    await Promise.all(fetchPromises);
}

main();
