import { TradeManager } from "./trade-manager";
import { AccountManager } from "./account-manager";
import { pairSettings } from "./load-data";
import { calculateTriggers } from "./calculate-triggers";
import { logTrading } from "./logger";

export async function checkMovementThreshold(
    token: string,
    symbol: string,
    currentPrice: number,
    tradeManager: TradeManager,
    accountManager: AccountManager
): Promise<void> {
    const tokenData = accountManager.getPositionData(token, symbol);

    // Check if there's a locked price for the symbol and no active position
    if (tokenData && tokenData.lock_close_price && !tokenData.status) {
        const lockClosePrice = tokenData.lock_close_price;
        const movementThreshold = tokenData.movement_threshold;

        if (!movementThreshold) {
            await logTrading(
                "ERROR",
                symbol,
                "No movement threshold found",
                {
                    token,
                    lock_close_price: lockClosePrice,
                    current_price: currentPrice
                }
            );
            return;
        }

        const upThreshold = lockClosePrice * (1 + movementThreshold / 100);
        const downThreshold = lockClosePrice * (1 - movementThreshold / 100);
        const qty = pairSettings[symbol].qty;

        // Only log when thresholds are actually met
        if (currentPrice >= upThreshold) {
            await logTrading(
                "UPWARD_THRESHOLD_MET",
                symbol,
                "Upward movement threshold met",
                {
                    current_price: currentPrice.toFixed(8),
                    threshold: upThreshold.toFixed(8)
                }
            );

            // Enter a long position
            const response = await tradeManager.placePositionWithStopLoss(
                symbol,
                "BUY",
                qty,
                currentPrice * (1 - movementThreshold / 100)
            );

            if (response.success) {
                try {
                    const entryPrice = accountManager.getPositionData(token, symbol)?.entry_price || currentPrice;
                    const stopPrice = entryPrice * (1 - movementThreshold / 100);

                    await logTrading(
                        "LONG_POSITION_ENTERED",
                        symbol,
                        "Long position entered successfully",
                        {
                            entry_price: entryPrice,
                            stop_price: stopPrice,
                            quantity: qty
                        }
                    );

                    // Set triggers
                    await calculateTriggers(accountManager, entryPrice, "long", token, symbol);
                } catch (error) {
                    await logTrading(
                        "ERROR",
                        symbol,
                        "Error setting buy stop loss",
                        {
                            error: error instanceof Error ? error.message : "Unknown error",
                            token
                        }
                    );
                }
            } else {
                await logTrading(
                    "ERROR",
                    symbol,
                    "Failed to enter position",
                    {
                        error: response.error,
                        token
                    }
                );
            }
        }
        // Downward movement threshold met
        else if (currentPrice <= downThreshold) {
            await logTrading(
                "DOWNWARD_THRESHOLD_MET",
                symbol,
                "Downward movement threshold met",
                {
                    current_price: currentPrice.toFixed(8),
                    threshold: downThreshold.toFixed(8)
                }
            );

            // Enter a short position
            const response = await tradeManager.placePositionWithStopLoss(
                symbol,
                "SELL",
                qty,
                currentPrice * (1 + movementThreshold / 100)
            );

            if (response.success) {
                try {
                    const entryPrice = accountManager.getPositionData(token, symbol)?.entry_price || currentPrice;
                    const stopPrice = entryPrice * (1 + movementThreshold / 100);

                    await logTrading(
                        "SHORT_POSITION_ENTERED",
                        symbol,
                        "Short position entered successfully",
                        {
                            entry_price: entryPrice,
                            stop_price: stopPrice,
                            quantity: qty
                        }
                    );

                    await calculateTriggers(accountManager, entryPrice, "short", token, symbol);
                } catch (error) {
                    await logTrading(
                        "ERROR",
                        symbol,
                        "Error setting sell stop loss",
                        {
                            error: error instanceof Error ? error.message : "Unknown error",
                            token
                        }
                    );
                }
            } else {
                await logTrading(
                    "ERROR",
                    symbol,
                    "Failed to enter position",
                    {
                        error: response.error,
                        token
                    }
                );
            }
        }
    }
}
