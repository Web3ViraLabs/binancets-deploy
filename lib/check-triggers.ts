import { TradeManager } from "./trade-manager";
import { AccountManager } from "./account-manager";
import { logTrading } from "./logger";

// Keep track of processing triggers
const processingTriggers: Record<string, boolean> = {};

export async function checkTriggers(
    accountName: string,
    symbol: string,
    currentPrice: number,
    tradeManager: TradeManager,
    accountManager: AccountManager
): Promise<void> {
    const positionData = accountManager.getPositionData(accountName, symbol);

    if (
        !positionData ||
        !positionData.status ||
        !positionData.triggers.length ||
        !positionData.stop_prices.length
    ) {
        return;
    }

    // Create a unique key for this token-symbol pair
    const lockKey = `${accountName}-${symbol}`;
    
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
            processingTriggers[lockKey] = true;

            const stopPrice = stopPrices[0];
            let placed = false;

            // Double-check position data
            const currentPositionData = accountManager.getPositionData(accountName, symbol);
            if (!currentPositionData?.status || 
                currentPositionData.triggers[0] !== triggers[0] ||
                currentPositionData.stop_prices[0] !== stopPrices[0]) {
                processingTriggers[lockKey] = false;
                return;
            }

            await logTrading(
                "TRIGGER_HIT",
                symbol,
                `Trigger hit for ${symbol}`,
                {
                    account: accountName,
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

                    await logTrading(
                        "STOP_LOSS_UPDATED",
                        symbol,
                        `Stop loss updated for ${symbol}`,
                        {
                            account: accountName,
                            current_price: currentPrice.toFixed(8),
                            new_stop_price: stopPrice.toFixed(8),
                            previous_stop_price: stopPrices[0].toFixed(8),
                            entry_price: entryPrice.toFixed(8),
                            remaining_triggers: newTriggers.length,
                            profit_locked: (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(4) + "%",
                            position_side: isLong ? "LONG" : "SHORT"
                        }
                    );

                    await accountManager.updatePosition(accountName, symbol, {
                        triggers: newTriggers,
                        stop_prices: newStopPrices,
                    });

                    processingTriggers[lockKey] = false;
                    return;
                }
            }

            if (!placed) {
                await logTrading(
                    "ERROR",
                    symbol,
                    `Failed to place trailing stop loss after all retries for ${symbol}`,
                    {
                        account: accountName,
                        attempts: 3,
                        stop_price: stopPrice.toFixed(8),
                        side: isLong ? "BUY" : "SELL",
                        current_price: currentPrice.toFixed(8)
                    }
                );

                await tradeManager.closePosition(symbol);
            }
        } catch (error) {
            await logTrading(
                "ERROR",
                symbol,
                `Failed to place stop loss update for ${symbol}`,
                {
                    error: error instanceof Error ? error.message : "Unknown error",
                    current_price: currentPrice.toFixed(8),
                    trigger_price: triggers[0].toFixed(8)
                }
            );
        } finally {
            processingTriggers[lockKey] = false;
        }
    }
}

// simulate trigger hit
// update position data then trigger calculate-triggers

// const accountManager = new AccountManager("test.json");