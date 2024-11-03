import { AccountManager } from "../lib/account-manager";
import * as checkTriggersModule from "../lib/check-triggers";
import { calculateTriggers } from "../lib/calculate-triggers";
import * as sendWebhookModule from "../lib/send-webhook";
import logger from "../lib/logger";

// Dummy TradeManager
class DummyTradeManager {
  async placeTrailStopLoss(
    symbol: string,
    side: "BUY" | "SELL",
    stopPrice: number
  ): Promise<boolean> {
    logger.info(`Placing trail stop loss for ${symbol}, side: ${side}, stopPrice: ${stopPrice}`);
    return true;
  }

  async closePosition(symbol: string): Promise<void> {
    logger.info(`Closing position for ${symbol}`);
  }
}

// Mock modules
jest.mock("../lib/send-webhook");
jest.mock("../lib/logger");

// Don't mock check-triggers, we want to test the actual implementation
// jest.mock("../lib/check-triggers");

describe("checkTriggers", () => {
  let accountManager: AccountManager;
  let tradeManager: DummyTradeManager;
  let mockSendDiscordWebhook: jest.SpyInstance;

  beforeEach(() => {
    accountManager = new AccountManager("test.json");
    tradeManager = new DummyTradeManager();

    // Mock sendDiscordWebhook function
    mockSendDiscordWebhook = jest.spyOn(sendWebhookModule, 'sendDiscordWebhook').mockImplementation(() => Promise.resolve());

    // Initialize account data
    accountManager.initializeAccountData(["test_token"], [{ symbol: "XRPUSDT", threshold: 1, fees_exemption_percentage: 0.1, num_previous_candles: 5, qty: 100, webhook_url: "https://example.com" }]);

    // Update position data
    accountManager.updatePosition("test_token", "XRPUSDT", {
      status: true,
      entry_price: 0.5,
      movement_threshold: 1,
      trigger_side: "long",
    });

    // Calculate triggers
    calculateTriggers(accountManager, 0.5, "long", "test_token", "XRPUSDT", 5);

    // Clear the mock calls after setup
    mockSendDiscordWebhook.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should only execute triggers when price reaches them", async () => {
    const initialTriggers = accountManager.getPositionData("test_token", "XRPUSDT")?.triggers || [];
    expect(initialTriggers.length).toBeGreaterThan(0);

      const prices = [0.5, 0.502, 0.504, 0.506, 0.508, 0.51, 0.512, 0.514, 0.516, 0.518, 0.52, 0.522, 0.524, 0.526];

    for (const price of prices) {
      await checkTriggersModule.checkTriggers("test_token", "XRPUSDT", price, tradeManager as any, accountManager);
      
      const currentTriggers = accountManager.getPositionData("test_token", "XRPUSDT")?.triggers || [];
      const executedTriggers = initialTriggers.filter(trigger => !currentTriggers.includes(trigger));

      console.log(`Price: ${price}, Executed triggers: ${executedTriggers.join(', ')}`);

      // Check if only triggers below or equal to the current price have been executed
      expect(executedTriggers.every(trigger => trigger <= price)).toBe(true);
      
      // Check if all triggers above the current price are still present
      expect(currentTriggers.every(trigger => trigger > price)).toBe(true);
    }

    // Check if all triggers have been executed by the end
    const finalTriggers = accountManager.getPositionData("test_token", "XRPUSDT")?.triggers || [];
    expect(finalTriggers.length).toBe(0);
  });
});