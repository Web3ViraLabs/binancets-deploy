import {TradeManager} from "./trade-manager";
import {AccountManager} from "./account-manager";
import {logTrading} from "./logger";

// Keep track of processing triggers
const processingTriggers: Record<string, boolean> = {};

export async function checkTriggers(
    token: string,
    symbol: string,
    currentPrice: number,
    tradeManager: TradeManager,
    accountManager: AccountManager
): Promise<void> {
    const positionData = accountManager.getPositionData(token, symbol);

    if (
        !positionData ||
        !positionData.status ||
        !positionData.triggers.length ||
        !positionData.stop_prices.length
    ) {
        return;
    }

    // Create a unique key for this token-symbol pair
    const lockKey = `${token}-${symbol}`;
    
    // Check if we're already processing a trigger for this pair
    if (processingTriggers[lockKey]) {
        return;
    }

    const triggers = [...positionData.triggers];
    const stopPrices = [...positionData.stop_prices];
    const entryPrice = positionData.entry_price || 0;
    const isLong = positionData.trigger_side === "long";

    const triggerCondition = isLong
        ? (price: number, trigger: number) => price >= trigger
        : (price: number, trigger: number) => price <= trigger;

    if (triggerCondition(currentPrice, triggers[0])) {
        try {
            // Set processing lock
            processingTriggers[lockKey] = true;

            const stopPrice = stopPrices[0];
            let placed = false;

            // Double-check position data to ensure it hasn't changed
            const currentPositionData = accountManager.getPositionData(token, symbol);
            if (!currentPositionData?.status || 
                currentPositionData.triggers[0] !== triggers[0] ||
                currentPositionData.stop_prices[0] !== stopPrices[0]) {
                processingTriggers[lockKey] = false;
                return;
            }

            // Log trigger hit with detailed information
            await logTrading(
                "TRIGGER_HIT",
                symbol,
                `Trigger hit for ${symbol}`,
                {
                    token,
                    trigger_side: positionData.trigger_side,
                    current_price: currentPrice.toFixed(8),
                    trigger_price: triggers[0].toFixed(8),
                    stop_price: stopPrice.toFixed(8),
                    entry_price: entryPrice.toFixed(8),
                    profit_percentage: (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(4) + "%",
                    remaining_triggers: triggers.length - 1
                }
            );

            for (let retryCount = 0; retryCount < 3 && !placed; retryCount++) {
                placed = await tradeManager.placeTrailStopLoss(
                    symbol,
                    isLong ? "BUY" : "SELL",
                    stopPrice
                );

                if (placed) {
                    const newTriggers = triggers.slice(1);
                    const newStopPrices = stopPrices.slice(1);

                    // Log stop loss update with detailed information
                    await logTrading(
                        "STOP_LOSS_UPDATED",
                        symbol,
                        `Stop loss updated for ${symbol}`,
                        {
                            token,
                            current_price: currentPrice.toFixed(8),
                            new_stop_price: stopPrice.toFixed(8),
                            previous_stop_price: stopPrices[0].toFixed(8),
                            entry_price: entryPrice.toFixed(8),
                            remaining_triggers: newTriggers.length,
                            profit_locked: (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(4) + "%",
                            position_side: isLong ? "LONG" : "SHORT"
                        }
                    );

                    // Update position with new triggers and stop prices
                    accountManager.updatePosition(token, symbol, {
                        triggers: newTriggers,
                        stop_prices: newStopPrices,
                    });

                    processingTriggers[lockKey] = false;
                    return;
                } else {
                    await logTrading(
                        "ERROR",
                        symbol,
                        `Failed to place trailing stop loss for ${symbol}`,
                        {
                            retry_count: retryCount + 1,
                            max_retries: 3,
                            stop_price: stopPrice.toFixed(8),
                            current_price: currentPrice.toFixed(8)
                        }
                    );
                }
            }

            if (!placed) {
                await logTrading(
                    "ERROR",
                    symbol,
                    `Failed to place trailing stop loss after all retries for ${symbol}`,
                    {
                        attempts: 3,
                        stop_price: stopPrice.toFixed(8),
                        side: isLong ? "BUY" : "SELL",
                        current_price: currentPrice.toFixed(8)
                    }
                );

                await tradeManager.closePosition(symbol);
            }
        } catch (e: any) {
            await logTrading(
                "ERROR",
                symbol,
                `Failed to place stop loss update for ${symbol}`,
                {
                    error: e.message,
                    current_price: currentPrice.toFixed(8),
                    trigger_price: triggers[0].toFixed(8)
                }
            );
        } finally {
            // Always release the lock
            processingTriggers[lockKey] = false;
        }
    }
}

// simulate trigger hit
// update position data then trigger calculate-triggers

// const accountManager = new AccountManager("test.json");