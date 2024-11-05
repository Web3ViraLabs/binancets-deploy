import { tradingLogger, debugLogger, accountLoggers, createAccountLogger } from './base-logger';
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
    // Add console.log for debugging
    console.log('Logging trading event:', { event, symbol, message, details });
    
    // Ensure both loggers receive the event
    await Promise.all([
        tradingLogger.info({ 
            event, 
            symbol, 
            message, 
            details: {
                ...details,
                timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
            }
        }),
        debugLogger.debug({ 
            type: 'TRADING',
            event, 
            symbol, 
            message, 
            details: {
                ...details,
                timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
            }
        })
    ]);
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

// Account specific logging
export const logAccount = async (
    accountName: string,
    event: string,
    symbol: string,
    message: string,
    details: any
) => {
    // Create logger if it doesn't exist
    if (!accountLoggers[accountName]) {
        accountLoggers[accountName] = createAccountLogger(accountName);
    }

    accountLoggers[accountName].info({
        event,
        symbol,
        message,
        details: {
            ...details,
            timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
        }
    });
};

export default {
    logCandle,
    logTrading,
    logDebug,
    logAccount
};

