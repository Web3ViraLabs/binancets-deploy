import { sendDiscordWebhook } from './send-webhook';
import { Candle } from './interfaces';
import moment from 'moment';
import { logTrading } from './logger';

export const sendTradeWebhook = {
    significantMovement: async (symbol: string, data: {
        candle: Candle,
        currentDiff: number,
        dynamicThreshold: number,
        pastDiffsSum: number,
        averageDiff: number
    }) => {
        try {
            await logTrading(
                "WEBHOOK_ATTEMPT",
                symbol,
                "Attempting to send significant movement webhook",
                { data }
            );

            await sendDiscordWebhook(
                symbol,
                {
                    event: "SIGNIFICANT_MOVEMENT_DETECTED",
                    timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
                    details: {
                        current_movement: data.currentDiff.toFixed(4) + "%",
                        threshold: data.dynamicThreshold.toFixed(4) + "%",
                        past_sum: data.pastDiffsSum.toFixed(4) + "%",
                        average: data.averageDiff.toFixed(4) + "%"
                    },
                    candle_data: {
                        open: data.candle.open,
                        high: data.candle.high,
                        low: data.candle.low,
                        close: data.candle.close,
                        volume: data.candle.volume
                    }
                },
                "🔍 Significant Movement Detected",
                "A significant price movement has been detected",
                true
            );
        } catch (error) {
            await logTrading(
                "ERROR",
                symbol,
                "Failed to send significant movement webhook",
                { error: error instanceof Error ? error.message : "Unknown error" }
            );
        }
    },

    priceThresholdLocked: async (symbol: string, data: {
        lockPrice: number,
        movementThreshold: number,
        upThreshold: number,
        downThreshold: number
    }) => {
        try {
            await logTrading(
                "WEBHOOK_ATTEMPT",
                symbol,
                "Attempting to send price threshold webhook",
                { data }
            );

            await sendDiscordWebhook(
                symbol,
                {
                    event: "PRICE_THRESHOLD_LOCKED",
                    timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
                    details: {
                        lock_price: data.lockPrice.toFixed(8),
                        movement_threshold: data.movementThreshold.toFixed(4) + "%",
                        entry_zones: {
                            long_entry: data.upThreshold.toFixed(8),
                            short_entry: data.downThreshold.toFixed(8)
                        }
                    }
                },
                "🔒 Price Threshold Locked",
                "Price thresholds have been set for potential trade entry",
                true
            );
        } catch (error) {
            await logTrading(
                "ERROR",
                symbol,
                "Failed to send price threshold webhook",
                { error: error instanceof Error ? error.message : "Unknown error" }
            );
        }
    }
}; 