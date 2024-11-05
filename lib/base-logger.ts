import { createLogger, format, transports } from 'winston';
import moment from 'moment';
import colors from 'colors/safe';
import fs from 'fs';

// Custom formats
const detailedFormat = format.printf(
  ({ timestamp, level, event, message, details, account }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}] [${event}]`;
    if (account) logMessage += ` [${account}]`;
    logMessage += `: ${message}`;
    if (details) logMessage += `\nDetails: ${JSON.stringify(details, null, 2)}`;
    return logMessage;
  }
);

// Custom console format with colors
const consoleFormat = format.printf(({ timestamp, level, event, message, details, error }) => {
  const ts = colors.gray(timestamp);
  const lvl = colors.bold(level.toUpperCase());
  const evt = colors.yellow(`[${event}]`);
  const msg = colors.white(message);
  
  let logMessage = `${ts} ${lvl} ${evt}: ${msg}`;
  
  if (details) {
    const detailsStr = colors.cyan(`\nDetails: ${JSON.stringify(details, null, 2)}`);
    logMessage += detailsStr;
  }
  
  if (error) {
    const errorStr = colors.red(`\nError: ${JSON.stringify(error, null, 2)}`);
    logMessage += errorStr;
  }
  
  return logMessage;
});

// WebSocket logger
export const websocketLogger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp({
      format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
    }),
    detailedFormat
  ),
  transports: [
    new transports.File({
      filename: 'websocket.log',
      level: 'debug'
    }),
    new transports.Console({
      format: format.combine(
        format.timestamp({
          format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
        }),
        consoleFormat
      )
    })
  ]
});

// Detailed debug logger
export const debugLogger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp({
      format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
    }),
    detailedFormat
  ),
  transports: [
    new transports.File({
      filename: 'debug.log',
      level: 'debug'
    }),
    new transports.Console({
      format: format.combine(
        format.timestamp({
          format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
        }),
        consoleFormat
      )
    })
  ]
});

// Trading activity logger
export const tradingLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({
      format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
    }),
    detailedFormat
  ),
  transports: [
    new transports.File({
      filename: 'trading.log',
      level: 'info'
    }),
    new transports.Console({
      format: format.combine(
        format.timestamp({
          format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
        }),
        consoleFormat
      ),
      level: 'info'
    })
  ],
});

// Add error handling for loggers
[tradingLogger, debugLogger, websocketLogger].forEach(logger => {
  logger.on('error', (error) => {
    console.error('Error in logger:', error);
  });
});

// Export a function to close loggers
export const closeLoggers = () => {
  tradingLogger.close();
  debugLogger.close();
  websocketLogger.close();
};

// Function to create account-specific logger
export function createAccountLogger(accountName: string) {
  try {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }
    // Create accounts directory if it doesn't exist
    if (!fs.existsSync('logs/accounts')) {
      fs.mkdirSync('logs/accounts');
    }
  } catch (error) {
    console.error('Error creating log directories:', error);
    throw error;
  }

  return createLogger({
    level: 'info',
    format: format.combine(
      format.timestamp({
        format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
      }),
      detailedFormat
    ),
    transports: [
      new transports.File({
        filename: `logs/accounts/${accountName}.log`,
      }),
      new transports.Console({
        format: format.combine(
          format.timestamp({
            format: () => moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
          }),
          consoleFormat
        )
      }),
    ],
  });
}

// Keep track of account loggers
export const accountLoggers: Record<string, any> = {};
