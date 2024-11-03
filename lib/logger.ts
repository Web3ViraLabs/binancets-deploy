import { tradingLogger, debugLogger } from './base-logger';
import moment from 'moment';

// Logging functions
export const logCandle = (symbol: string, message: string, data: any) => {
    // Log candle data to debug.log
    debugLogger.debug({ 
        type: 'CANDLE',
        event: message.toUpperCase(),
        symbol, 
        message, 
        details: {
            ...data,
            timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
        }
    });
};

export const logTrading = async (event: string, symbol: string, message: string, details: any) => {
    // Log to trading.log and debug.log
    tradingLogger.info({ event, symbol, message, details });
    debugLogger.debug({ 
        type: 'TRADING',
        event, 
        symbol, 
        message, 
        details,
        timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
    });
};

// Add new debug logging function
export const logDebug = (
    type: string,
    event: string,
    symbol: string,
    message: string,
    details: any
) => {
    debugLogger.debug({
        type,
        event,
        symbol,
        message,
        details,
        timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
    });
};

// Helper function for emojis
function getEventEmoji(event: string): string {
    const emojiMap: { [key: string]: string } = {
        CRITERIA_MET: "✨",
        MOVEMENT_DETECTED: "📈",
        POSITION_OPEN: "🚀",
        STOP_LOSS: "🛑",
        TRIGGER_HIT: "🎯",
        POSITION_CLOSE: "🏁",
        ERROR: "❌",
        WARNING: "⚠️"
    };
    return emojiMap[event] || "ℹ️";
}

export const eventEmojis = { getEventEmoji };

export default {
    logCandle,
    logTrading,
    logDebug
};

