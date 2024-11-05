import { pairSettings } from "./load-data";
import { AccountManager } from "./account-manager";
import { tradingLogger } from './base-logger';
import moment from 'moment';

export async function calculateTriggers(
  accountManager: AccountManager,
  entryPrice: number,
  direction: "long" | "short",
  accountName: string,
  symbol: string,
  count: number = 20
): Promise<{ triggers: number[]; stopPrices: number[] }> {
  const triggers: number[] = [];
  const stopPrices: number[] = [];

  // Retrieve the movement threshold and fee exemption percentage
  const positionData = accountManager.getPositionData(accountName, symbol);
  if (!positionData || !positionData.movement_threshold) {
    tradingLogger.info({
      event: "ERROR",
      symbol,
      message: `No position data found for token ${accountName} and symbol ${symbol}`,
      details: { token: accountName, symbol }
    });
    throw new Error(
      `No position data found for token ${accountName} and symbol ${symbol}`
    );
  }

  const movementThreshold = positionData.movement_threshold;
  const feesExemptionPercentage = pairSettings[symbol].fees_exemption_percentage;

  // Calculate initial stop price with fees exemption
  let initialStopPrice: number;
  if (direction === "long") {
    initialStopPrice =
      entryPrice *
      (1 - movementThreshold / 100 - feesExemptionPercentage / 100);
  } else {
    initialStopPrice =
      entryPrice *
      (1 + movementThreshold / 100 + feesExemptionPercentage / 100);
  }

  let currentStopPrice = initialStopPrice;

  tradingLogger.info({
    event: "INITIAL_STOP_PRICE",
    symbol,
    message: "Initial stop price calculated",
    details: {
      initial_stop_price: initialStopPrice.toFixed(8),
      direction,
      movement_threshold: movementThreshold,
      fees_exemption: feesExemptionPercentage,
      timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
    }
  });

  for (let i = 1; i <= count; i++) {
    let triggerPrice: number;
    let stopPrice: number;

    if (direction === "long") {
      triggerPrice = entryPrice * (1 + (i * movementThreshold) / 100);
      stopPrice =
        currentStopPrice *
        (1 + movementThreshold / 100 + feesExemptionPercentage / 100);
    } else {
      triggerPrice = entryPrice * (1 - (i * movementThreshold) / 100);
      stopPrice =
        currentStopPrice *
        (1 - movementThreshold / 100 - feesExemptionPercentage / 100);
    }

    currentStopPrice = stopPrice;
    triggers.push(parseFloat(triggerPrice.toFixed(8)));
    stopPrices.push(parseFloat(stopPrice.toFixed(8)));
  }

  // Store the calculated triggers and stop prices
  accountManager.updatePosition(accountName, symbol, {
    triggers,
    stop_prices: stopPrices,
    trigger_side: direction,
  });

  tradingLogger.info({
    event: "TRIGGERS_CALCULATED",
    symbol,
    message: "Triggers and stop prices calculated",
    details: {
      direction: direction.toUpperCase(),
      triggers_count: triggers.length,
      triggers: triggers.map((trigger, index) => ({
        level: index + 1,
        trigger_price: trigger.toFixed(8),
        stop_price: stopPrices[index].toFixed(8)
      })),
      timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
    }
  });

  return { triggers, stopPrices };
}
