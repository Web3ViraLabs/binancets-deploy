import { TradeManager } from "./trade-manager";
import { logTrading } from "./logger";
import { pairSettings } from "./load-data";
import { AccountManager } from "./account-manager";
import { calculateTriggers } from "./calculate-triggers";

export async function checkMovementThreshold(
    accountName: string,
    symbol: string,
    currentPrice: number,
    tradeManager: TradeManager,
    accountManager: AccountManager
): Promise<void> {
    const positionData = accountManager.getPositionData(accountName, symbol);

    if (!positionData) {
        await logTrading(
            "ERROR",
            symbol,
            "No position data found",
            {
                account: accountName,
                current_price: currentPrice
            }
        );
        return;
    }

    // Check if there's a locked price for the symbol and no active position
    if (positionData.lock_close_price && !positionData.status) {
        const lockClosePrice = positionData.lock_close_price;
        const movementThreshold = positionData.movement_threshold;

        if (!movementThreshold) {
            await logTrading(
                "ERROR",
                symbol,
                "No movement threshold found",
                {
                    account: accountName,
                    current_price: currentPrice,
                    threshold: movementThreshold
                }
            );
            return;
        }

        const upThreshold = lockClosePrice * (1 + movementThreshold / 100);
        const downThreshold = lockClosePrice * (1 - movementThreshold / 100);
        const usdtAmount = pairSettings[symbol].usdt_amount;

        // Only log when thresholds are actually met
        if (currentPrice >= upThreshold) {
            await logTrading(
                "UPWARD_THRESHOLD_MET",
                symbol,
                "Upward movement threshold met",
                {
                    account: accountName,
                    current_price: currentPrice.toFixed(8),
                    threshold: upThreshold.toFixed(8)
                }
            );

            // Enter a long position
            const response = await tradeManager.placePositionWithStopLoss(
                symbol,
                "BUY",
                usdtAmount,
                currentPrice * (1 - movementThreshold / 100)
            );

            if (response.success) {
                try {
                    const entryPrice = accountManager.getPositionData(accountName, symbol)?.entry_price || currentPrice;
                    const stopPrice = entryPrice * (1 - movementThreshold / 100);

                    await logTrading(
                        "LONG_POSITION_ENTERED",
                        symbol,
                        "Long position entered successfully",
                        {
                            account: accountName,
                            entry_price: entryPrice,
                            stop_price: stopPrice,
                            quantity: usdtAmount
                        }
                    );

                    // Set triggers
                    await calculateTriggers(accountManager, entryPrice, "long", accountName, symbol);
                } catch (error) {
                    await logTrading(
                        "ERROR",
                        symbol,
                        "Error setting buy stop loss",
                        {
                            error: error instanceof Error ? error.message : "Unknown error",
                            account: accountName
                        }
                    );
                }
            }
        }
        // Downward movement threshold met
        else if (currentPrice <= downThreshold) {
            await logTrading(
                "DOWNWARD_THRESHOLD_MET",
                symbol,
                "Downward movement threshold met",
                {
                    account: accountName,
                    current_price: currentPrice.toFixed(8),
                    threshold: downThreshold.toFixed(8)
                }
            );

            // Enter a short position
            const response = await tradeManager.placePositionWithStopLoss(
                symbol,
                "SELL",
                usdtAmount,
                currentPrice * (1 + movementThreshold / 100)
            );

            if (response.success) {
                try {
                    const entryPrice = accountManager.getPositionData(accountName, symbol)?.entry_price || currentPrice;
                    const stopPrice = entryPrice * (1 + movementThreshold / 100);

                    await logTrading(
                        "SHORT_POSITION_ENTERED",
                        symbol,
                        "Short position entered successfully",
                        {
                            account: accountName,
                            entry_price: entryPrice,
                            stop_price: stopPrice,
                            quantity: usdtAmount
                        }
                    );

                    await calculateTriggers(accountManager, entryPrice, "short", accountName, symbol);
                } catch (error) {
                    await logTrading(
                        "ERROR",
                        symbol,
                        "Error setting sell stop loss",
                        {
                            error: error instanceof Error ? error.message : "Unknown error",
                            account: accountName
                        }
                    );
                }
            }
        }
    }
}
