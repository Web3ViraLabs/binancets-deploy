import {Candle, Pair} from "./interfaces";
import {config} from "./load-data";
import moment from "moment";
import * as math from "mathjs";
import {symbolCandles} from "./deque";
import {AccountManager} from "./account-manager";
import {logTrading, logDebug} from "./logger";

// Helper function to convert timestamp to IST
function getISTTime(timestamp: number): string {
    return moment(timestamp).utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS');
}

// Function to process the candle and check if it meets criteria
export async function processCandles(
    symbol: string,
    currentCandle: Candle,
    accountManager: AccountManager
): Promise<boolean> {
    const candles = symbolCandles[symbol];

    if (!candles || candles.length === 0) {
        throw new Error(`No candles found for symbol: ${symbol}`);
    }

    // Convert to a DataFrame-like structure using an array of objects
    const df = candles.map((candle: Candle) => ({
        open_time: moment(candle.openTime).valueOf(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
    }));

    // Calculate percentage difference between close and open prices
    const diffs = df.map(
        (row) => math.abs((row.close - row.open) / row.open) * 100
    );

    // Get the pair configuration for the current symbol
    const pairConfig: Pair | undefined = config.pairs.find(
        (pair) => pair.symbol === symbol
    );

    if (!pairConfig) {
        throw new Error(`No configuration found for symbol: ${symbol}`);
    }

    const {threshold, num_previous_candles} = pairConfig;

    // Calculate average difference and dynamic threshold
    const averageDiff = math.mean(diffs);
    const dynamicThreshold = threshold * averageDiff;

    // Calculate the difference for the current candle
    const currentDiff =
        (math.abs(currentCandle.close - currentCandle.open) / currentCandle.open) *
        100;

    // Sum of differences for the past N candles
    const pastDiffsSum = math.sum(diffs.slice(-num_previous_candles));

    // Log candle analysis
    logDebug(
        'ANALYSIS',
        'CANDLE_ANALYSIS',
        symbol,
        'Analyzing candle movement',
        {
            candle: {
                open: currentCandle.open,
                high: currentCandle.high,
                low: currentCandle.low,
                close: currentCandle.close,
                volume: currentCandle.volume,
                openTime_ist: getISTTime(currentCandle.openTime),
                closeTime_ist: getISTTime(currentCandle.closeTime),
                openTime: currentCandle.openTime,
                closeTime: currentCandle.closeTime
            },
            analysis: {
                current_movement: currentDiff.toFixed(4) + "%",
                threshold: dynamicThreshold.toFixed(4) + "%",
                past_movements_sum: pastDiffsSum.toFixed(4) + "%",
                average_movement: averageDiff.toFixed(4) + "%",
                conditions: {
                    threshold_met: currentDiff > dynamicThreshold ? "✅" : "❌",
                    past_movements_met: currentDiff > pastDiffsSum ? "✅" : "❌"
                }
            }
        }
    );

    // Check if the current candle meets the criteria
    if (currentDiff > dynamicThreshold && currentDiff > pastDiffsSum) {
        logTrading(
            "CRITERIA_MET",
            symbol,
            "✨ Trading criteria met",
            {
                current_diff: currentDiff.toFixed(4) + "%",
                threshold: dynamicThreshold.toFixed(4) + "%",
                past_diffs_sum: pastDiffsSum.toFixed(4) + "%",
                average_diff: averageDiff.toFixed(4) + "%",
                candle_data: {
                    open: currentCandle.open,
                    high: currentCandle.high,
                    low: currentCandle.low,
                    close: currentCandle.close,
                    volume: currentCandle.volume,
                    openTime_ist: getISTTime(currentCandle.openTime),
                    closeTime_ist: getISTTime(currentCandle.closeTime),
                    openTime: currentCandle.openTime,
                    closeTime: currentCandle.closeTime
                }
            }
        );

        // Lock the close price and adjust thresholds for all tokens
        const tokens = config.tokens;
        for (const token of tokens) {
            accountManager.updatePosition(token, symbol, {
                lock_close_price: currentCandle.close,
                movement_threshold: dynamicThreshold / 2,
            });

            logTrading(
                "PRICE_THRESHOLD_LOCKED",
                symbol,
                "🔒 Price thresholds have been set",
                {
                    token,
                    lock_price: currentCandle.close.toFixed(8),
                    movement_threshold: (dynamicThreshold / 2).toFixed(4) + "%",
                    up_threshold: (currentCandle.close * (1 + dynamicThreshold / 200)).toFixed(8),
                    down_threshold: (currentCandle.close * (1 - dynamicThreshold / 200)).toFixed(8),
                    timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
                }
            );
        }

        return true;
    }

    return false;
}
