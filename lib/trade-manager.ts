import {
  USDMClient,
  NewFuturesOrderParams,
  ModifyFuturesOrderParams,
  NewOrderResult,
  NewOrderError,
  WebsocketClient,
  WsMessageFuturesUserDataTradeUpdateEventFormatted,
  WsMessageFuturesUserDataAccountUpdateFormatted,
} from "binance";
import { OrderResult } from "./interfaces";
import { AccountManager } from "./account-manager";
import {FuturesExchangeInfo} from "binance/lib/types/futures";
import { logTrading } from "./logger";
import { BINANCE_API_KEY, BINANCE_SECRET_KEY } from './config';

export class TradeManager {
  private client: USDMClient;
  private wsClient: WebsocketClient;
  private token: string;
  private apiKey: string;
  private secretKey: string;
  private accountManager: AccountManager;
  private exchangeInfo: FuturesExchangeInfo | null = null;
  private positionLocks: Record<string, boolean> = {};

  constructor(token: string, accountManager: AccountManager) {
    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
        throw new Error('Binance API credentials not found in environment variables');
    }

    this.apiKey = BINANCE_API_KEY;
    this.secretKey = BINANCE_SECRET_KEY;
    this.token = token;
    this.accountManager = accountManager;

    this.client = new USDMClient({
      api_key: this.apiKey,
      api_secret: this.secretKey,
    });

    this.wsClient = new WebsocketClient({
      api_key: this.apiKey,
      api_secret: this.secretKey,
      beautify: true,
    });

    this.startStream();
  }

  async startStream() {
    this.wsClient.on("formattedUserDataMessage", async (data) => {
      if (data.eventType === "ACCOUNT_UPDATE") {
        await this.handleAccountUpdate(data);
      } else if (data.eventType === "ORDER_TRADE_UPDATE") {
        await this.handleOrderTradeUpdate(data);
      }
    });

    this.wsClient.subscribeUsdFuturesUserDataStream();
  }

  private async handleAccountUpdate(
    data: WsMessageFuturesUserDataAccountUpdateFormatted
  ): Promise<void> {
    const token = this.token;
    const updateData = data.updateData;

    for (const position of updateData.updatedPositions) {
      if (position.positionAmount === 0) {
        this.accountManager.updatePosition(token, position.symbol, {
          status: false,
          entry_price: null,
          lock_close_price: null,
          movement_threshold: null,
          triggers: [],
          stop_prices: [],
          trigger_side: null,
        });
        await logTrading(
          "POSITION_CLOSED",
          position.symbol,
          `Position closed for ${position.symbol}`,
          { token }
        );
      } else {
        this.accountManager.updatePosition(token, position.symbol, {
          status: true,
          entry_price: position.entryPrice,
        });
        await logTrading(
          "POSITION_UPDATED",
          position.symbol,
          `Position updated for ${position.symbol}`,
          { token, entry_price: position.entryPrice }
        );
      }
    }
  }

  private async handleOrderTradeUpdate(
    data: WsMessageFuturesUserDataTradeUpdateEventFormatted
  ): Promise<void> {
    const order = data.order;
    const token = this.token;
    const symbol = order.symbol;
    const averagePrice = order.averagePrice;

    if (order.orderStatus === "FILLED" && order.orderType === "MARKET") {
      await logTrading(
        "MARKET_ORDER_FILLED",
        symbol,
        `Market order filled for ${symbol} at price ${averagePrice}`,
        { token }
      );
    }

    if (order.orderStatus === "NEW" && order.orderType === "STOP_MARKET") {
      await logTrading(
        "STOP_MARKET_ORDER_PLACED",
        symbol,
        `Stop market order placed for ${symbol} with stop price ${order.stopPrice}`,
        { token }
      );
    }
  }

  private async getSymbolPrecision(
    symbol: string
  ): Promise<{ pricePrecision: number; quantityPrecision: number }> {
    if (!this.exchangeInfo) {
      this.exchangeInfo = await this.client.getExchangeInfo();
    }
    const symbolInfo = this.exchangeInfo.symbols.find(
      (s) => s.symbol === symbol.toUpperCase()
    );
    if (symbolInfo) {
      return {
        pricePrecision: symbolInfo.pricePrecision,
        quantityPrecision: symbolInfo.quantityPrecision,
      };
    }
    throw new Error(`Precision information not found for symbol ${symbol}`);
  }

  private roundToPrecision(value: number, precision: number): number {
    return parseFloat(value.toFixed(precision));
  }

  private isOrderError(
    order: NewOrderResult | NewOrderError
  ): order is NewOrderError {
    return (order as NewOrderError).code !== undefined;
  }

  async sync(): Promise<void> {
    const sync = await this.client.syncTime();
    await logTrading(
        "SYSTEM",
        "TradeManager",
        "Time sync completed",
        { sync_result: sync }
    );
  }

  async balance(): Promise<string[]> {
    try {
      const balance = await this.client.getBalanceV3();
      return balance.map((b) => b.asset + ": " + b.balance);
    } catch (error) {
      await logTrading(
        "ERROR",
        "TradeManager",
        "Error fetching balance",
        { error: error instanceof Error ? error.message : "Unknown error" }
      );
      return [];
    }
  }

  async placePositionWithStopLoss(
    symbol: string,
    side: "BUY" | "SELL",
    qty: number,
    stopPrice: number
  ): Promise<OrderResult> {
    if (this.positionLocks[symbol]) {
        await logTrading(
            "POSITION_LOCKED",
            symbol,
            "Position entry already in progress",
            { timestamp: new Date().toISOString() }
        );
        return { success: false, error: "Position entry in progress" };
    }

    try {
        this.positionLocks[symbol] = true;

        await new Promise(resolve => setTimeout(resolve, 1000));
        const positionExists = await this.inExistingPosition(symbol);
        if (positionExists) {
            await logTrading(
                "POSITION_ALREADY_EXISTS",
                symbol,
                "Position already exists",
                { timestamp: new Date().toISOString() }
            );
            return { success: false, error: "Position already exists" };
        }

        const { pricePrecision, quantityPrecision } = await this.getSymbolPrecision(symbol);
        const roundedQty = this.roundToPrecision(qty, quantityPrecision);
        const roundedStopPrice = this.roundToPrecision(stopPrice, pricePrecision);

        const orderParams: NewFuturesOrderParams<string> = {
            symbol: symbol.toUpperCase(),
            side,
            type: "MARKET",
            quantity: roundedQty.toString(),
            positionSide: side === "BUY" ? "LONG" : "SHORT",
        };

        const stopLossParams: NewFuturesOrderParams<string> = {
            symbol: symbol.toUpperCase(),
            side: side === "BUY" ? "SELL" : "BUY",
            positionSide: side === "BUY" ? "LONG" : "SHORT",
            type: "STOP_MARKET",
            stopPrice: roundedStopPrice.toString(),
            workingType: "MARK_PRICE",
            closePosition: "true",
        };

        const orders = await this.client.submitMultipleOrders([
            orderParams,
            stopLossParams,
        ]);

        await logTrading(
            "ORDERS_PLACED",
            symbol,
            `Orders placed successfully`,
            { orders }
        );

        const positionOrder = orders[0] as NewOrderResult;

        if (this.isOrderError(orders[1])) {
            await this.closePosition(symbol);
            return { success: false, error: "Stop loss placement failed" };
        }

        const stopLossOrder = orders[1] as NewOrderResult;

        return {
            success: true,
            positionOrderId: positionOrder.orderId,
            stopLossOrderId: stopLossOrder.orderId,
            positionDetails: positionOrder,
            stopLossDetails: stopLossOrder,
        };
    } finally {
        this.positionLocks[symbol] = false;
    }
  }

  async placeTrailStopLoss(
    symbol: string,
    forSide: "BUY" | "SELL",
    stopPrice: number
  ): Promise<boolean> {
    try {
        // Check for existing stop loss orders
        const openOrders = await this.client.getAllOpenOrders({ symbol });
        const existingStopLoss = openOrders.find(order => 
            order.type === "STOP_MARKET" && 
            order.stopPrice === stopPrice.toString()
        );
        
        if (existingStopLoss) {
            await logTrading(
                "WARNING",
                symbol,
                "Stop loss order already exists",
                {
                    stop_price: stopPrice,
                    existing_order_id: existingStopLoss.orderId
                }
            );
            return true;
        }

        const { pricePrecision } = await this.getSymbolPrecision(symbol);
        const roundedStopPrice = this.roundToPrecision(stopPrice, pricePrecision);

        // Cancel existing stop loss orders
        await this.cancelAllOrder(symbol);

        // Place new stop loss order
        const stopLossParams: NewFuturesOrderParams = {
            symbol: symbol.toUpperCase(),
            side: forSide === "BUY" ? "SELL" : "BUY",
            type: "STOP_MARKET",
            stopPrice: roundedStopPrice,
            positionSide: forSide === "BUY" ? "LONG" : "SHORT",
            workingType: "MARK_PRICE",
            closePosition: "true",
        };

        const stopLossOrder = await this.client.submitNewOrder(stopLossParams);
        await logTrading(
            "STOP_LOSS_PLACED",
            symbol,
            "New stop loss placed",
            { 
                stop_price: roundedStopPrice,
                order_details: stopLossOrder
            }
        );

        return true;
    } catch (error) {
        await logTrading(
            "ERROR",
            symbol,
            "Error placing trail stop loss",
            { error: error instanceof Error ? error.message : "Unknown error" }
        );
        throw error;
    }
  }

  async cancelAllOrder(symbol: string): Promise<void> {
    try {
      const result = await this.client.cancelAllOpenOrders({
        symbol: symbol.toUpperCase(),
      });
      await logTrading(
        "ORDERS_CANCELLED",
        symbol,
        "All orders cancelled",
        { result }
      );
    } catch (error) {
      await logTrading(
        "ERROR",
        symbol,
        "Error canceling orders",
        { error: error instanceof Error ? error.message : "Unknown error" }
      );
      throw error;
    }
  }

  async closePosition(symbol: string): Promise<void> {
    symbol = symbol.toUpperCase();
    try {
      const position = await this.client.getPositionsV3({ symbol });
      for (const pos of position) {
        if (parseFloat(pos.positionAmt.toString()) !== 0) {
          const { quantityPrecision } = await this.getSymbolPrecision(symbol);
          const roundedQty = this.roundToPrecision(
            Math.abs(parseFloat(pos.positionAmt.toString())),
            quantityPrecision
          );

          const closePayload: NewFuturesOrderParams = {
            symbol,
            side: parseFloat(pos.positionAmt.toString()) > 0 ? "SELL" : "BUY",
            type: "MARKET",
            quantity: roundedQty,
            positionSide: pos.positionSide,
          };

          const closeOrder = await this.client.submitNewOrder(closePayload);
          await logTrading(
            "POSITION_CLOSED",
            symbol,
            "Position closed",
            { close_order: closeOrder }
          );
          return;
        }
      }
      await logTrading(
        "NO_POSITION",
        symbol,
        "No open position to close",
        {}
      );
    } catch (error) {
      await logTrading(
        "ERROR",
        symbol,
        "Error closing position",
        { error: error instanceof Error ? error.message : "Unknown error" }
      );
      throw error;
    }
  }

  async enterPosition(
    symbol: string,
    side: "BUY" | "SELL",
    qty: number
  ): Promise<void> {
    const { quantityPrecision } = await this.getSymbolPrecision(symbol);
    const roundedQty = this.roundToPrecision(qty, quantityPrecision);

    try {
        const positionExists = await this.inExistingPosition(symbol);
        if (positionExists) {
            await logTrading(
                "POSITION_EXISTS",
                symbol,
                "Position already exists",
                {}
            );
            return;
        }

        const orderParams: NewFuturesOrderParams = {
            symbol: symbol.toUpperCase(),
            side,
            type: "MARKET",
            quantity: roundedQty,
            positionSide: side === "BUY" ? "LONG" : "SHORT",
            workingType: "MARK_PRICE",
        };

        const order = await this.client.submitNewOrder(orderParams);
        await logTrading(
            "POSITION_ENTERED",
            symbol,
            "Position entered",
            { order }
        );
    } catch (error) {
        await logTrading(
            "ERROR",
            symbol,
            "Error entering position",
            { error: error instanceof Error ? error.message : "Unknown error" }
        );
        throw error;
    }
  }

  private async inExistingPosition(symbol: string): Promise<boolean> {
    try {
        const position = await this.client.getPositionsV3({ symbol });
        const openOrders = await this.client.getAllOpenOrders({ symbol });
        
        return position.some((pos) => parseFloat(pos.positionAmt.toString()) !== 0) ||
               openOrders.some(order => order.type === "MARKET");
    } catch (error) {
        await logTrading(
            "ERROR",
            symbol,
            "Error checking existing position",
            { error: error instanceof Error ? error.message : "Unknown error" }
        );
        return true;
    }
  }
}
