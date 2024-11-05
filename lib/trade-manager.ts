import {
  USDMClient,
  NewFuturesOrderParams,
  ModifyFuturesOrderParams,
  NewOrderResult,
  NewOrderError,
  WebsocketClient,
  WsMessageFuturesUserDataTradeUpdateEventFormatted,
  WsMessageFuturesUserDataAccountUpdateFormatted,
} from 'binance';
import { OrderResult } from './interfaces';
import { AccountManager } from './account-manager';
import { FuturesExchangeInfo } from 'binance/lib/types/futures';
import { logTrading, logAccount } from './logger';

export class TradeManager {
  private client: USDMClient;
  private wsClient: WebsocketClient;
  private accountManager: AccountManager;
  private exchangeInfo: FuturesExchangeInfo | null = null;
  private positionLocks: Record<string, boolean> = {};

  constructor(
    private accountName: string,
    accountManager: AccountManager,
    private apiKey: string,
    private apiSecret: string
  ) {
    this.accountManager = accountManager;

    this.client = new USDMClient({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
    });

    this.wsClient = new WebsocketClient({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      beautify: true,
    });

    this.startStream();
  }

  async startStream() {
    this.wsClient.on('formattedUserDataMessage', async (data) => {
      if (data.eventType === 'ACCOUNT_UPDATE') {
        await this.handleAccountUpdate(data);
      } else if (data.eventType === 'ORDER_TRADE_UPDATE') {
        await this.handleOrderTradeUpdate(data);
      }
    });

    this.wsClient.subscribeUsdFuturesUserDataStream();
  }

  private async handleAccountUpdate(
    data: WsMessageFuturesUserDataAccountUpdateFormatted
  ): Promise<void> {
    const accountName = this.accountName;
    const updateData = data.updateData;

    for (const position of updateData.updatedPositions) {
      if (position.positionAmount === 0) {
        this.accountManager.updatePosition(accountName, position.symbol, {
          status: false,
          entry_price: null,
          lock_close_price: null,
          movement_threshold: null,
          triggers: [],
          stop_prices: [],
          trigger_side: null,
        });
        await logAccount(
          this.accountName,
          'POSITION_CLOSED',
          position.symbol,
          `Position closed for ${position.symbol}`,
          { account: this.accountName }
        );
      } else {
        this.accountManager.updatePosition(accountName, position.symbol, {
          status: true,
          entry_price: position.entryPrice,
        });
        await logTrading(
          'POSITION_UPDATED',
          position.symbol,
          `Position updated for ${position.symbol}`,
          { account: accountName, entry_price: position.entryPrice }
        );
      }
    }
  }

  private async handleOrderTradeUpdate(
    data: WsMessageFuturesUserDataTradeUpdateEventFormatted
  ): Promise<void> {
    const order = data.order;
    const symbol = order.symbol;
    const price = Number(order.lastFilledPrice || order.stopPrice || 0);

    if (order.orderStatus === 'FILLED' && order.orderType === 'MARKET') {
      await logTrading(
        'MARKET_ORDER_FILLED',
        symbol,
        `Market order filled for ${symbol} at price ${price}`,
        {}
      );
    }

    if (order.orderStatus === 'NEW' && order.orderType === 'STOP_MARKET') {
      await logTrading(
        'STOP_MARKET_ORDER_PLACED',
        symbol,
        `Stop market order placed for ${symbol} with stop price ${order.stopPrice}`,
        {}
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
    await logTrading('SYSTEM', 'TradeManager', 'Time sync completed', {
      sync_result: sync,
    });
  }

  async balance(): Promise<string[]> {
    try {
      const balance = await this.client.getBalanceV3();
      return balance.map((b) => b.asset + ': ' + b.balance);
    } catch (error) {
      await logTrading('ERROR', 'TradeManager', 'Error fetching balance', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  private async calculateQuantity(
    symbol: string,
    currentPrice: number,
    usdtAmount: number
  ): Promise<number> {
    try {
      const { quantityPrecision } = await this.getSymbolPrecision(symbol);
      const rawQuantity = usdtAmount / currentPrice;
      return this.roundToPrecision(rawQuantity, quantityPrecision);
    } catch (error) {
      await logTrading('ERROR', symbol, 'Error calculating quantity', {
        account: this.accountName,
        error: error instanceof Error ? error.message : 'Unknown error',
        usdt_amount: usdtAmount,
        current_price: currentPrice,
      });
      throw error;
    }
  }

  async placePositionWithStopLoss(
    symbol: string,
    side: 'BUY' | 'SELL',
    usdtAmount: number,
    stopPrice: number
  ): Promise<OrderResult> {
    if (this.positionLocks[symbol]) {
      return { success: false, error: 'Position entry in progress' };
    }

    try {
      this.positionLocks[symbol] = true;

      const currentPrice = stopPrice / (1 + (side === 'BUY' ? -0.01 : 0.01));
      const quantity = await this.calculateQuantity(
        symbol,
        currentPrice,
        usdtAmount
      );

      const { pricePrecision, quantityPrecision } =
        await this.getSymbolPrecision(symbol);
      const roundedQty = this.roundToPrecision(quantity, quantityPrecision);
      const roundedStopPrice = this.roundToPrecision(stopPrice, pricePrecision);

      const positionExists = await this.inExistingPosition(symbol);
      if (positionExists) {
        await logTrading('POSITION_EXISTS', symbol, 'Position already exists', {
          timestamp: new Date().toISOString(),
        });
        return { success: false, error: 'Position already exists' };
      }

      // In placePositionWithStopLoss method:
      const orderParams: NewFuturesOrderParams<string> = {
        symbol: symbol.toUpperCase(),
        side,
        type: 'MARKET',
        quantity: roundedQty.toString(), // Convert to string
        positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
      };

      const stopLossParams: NewFuturesOrderParams<string> = {
        // Must use <string>
        symbol: symbol.toUpperCase(),
        side: side === 'BUY' ? 'SELL' : 'BUY',
        type: 'STOP_MARKET',
        stopPrice: roundedStopPrice.toString(), // Convert to string
        positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
        workingType: 'MARK_PRICE',
        closePosition: 'true',
      };

      const orders = await this.client.submitMultipleOrders([
        orderParams,
        stopLossParams,
      ]);

      const positionOrder = orders[0] as NewOrderResult;

      if (this.isOrderError(orders[1])) {
        await this.closePosition(symbol);
        return { success: false, error: 'Stop loss placement failed' };
      }

      const stopLossOrder = orders[1] as NewOrderResult;

      await logAccount(
        this.accountName,
        'POSITION_OPENED',
        symbol,
        'Position opened with stop loss',
        {
          side,
          quantity: quantity,
          entry_price: Number(positionOrder.avgPrice),
          stop_price: stopPrice,
          position_details: positionOrder,
          stop_loss_details: stopLossOrder,
        }
      );

      return {
        success: true,
        positionOrderId: positionOrder.orderId,
        stopLossOrderId: stopLossOrder.orderId,
        positionDetails: positionOrder,
        stopLossDetails: stopLossOrder,
      };
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Unknown error';
      await logTrading('ERROR', symbol, 'Error placing position or stop loss', {
        error: message,
      });
      await this.closePosition(symbol);
      return { success: false, error: message };
    } finally {
      this.positionLocks[symbol] = false;
    }
  }

  async placeTrailStopLoss(
    symbol: string,
    forSide: 'BUY' | 'SELL',
    stopPrice: number
  ): Promise<boolean> {
    try {
      const openOrders = await this.client.getAllOpenOrders({ symbol });
      const existingStopLoss = openOrders.find(
        (order) =>
          order.type === 'STOP_MARKET' && Number(order.stopPrice) === stopPrice
      );

      if (existingStopLoss) {
        await logTrading('WARNING', symbol, 'Stop loss order already exists', {
          account: this.accountName,
          stop_price: stopPrice,
          existing_order_id: existingStopLoss.orderId,
        });
        return true;
      }

      const { pricePrecision } = await this.getSymbolPrecision(symbol);
      const roundedStopPrice = this.roundToPrecision(stopPrice, pricePrecision);

      await this.cancelAllOrder(symbol);

      const stopLossParams: NewFuturesOrderParams = {
        // no <string> here
        symbol: symbol.toUpperCase(),
        side: forSide === 'BUY' ? 'SELL' : 'BUY',
        type: 'STOP_MARKET',
        stopPrice: roundedStopPrice, // Convert to string
        positionSide: forSide === 'BUY' ? 'LONG' : 'SHORT',
        workingType: 'MARK_PRICE',
        closePosition: 'true',
      };

      const stopLossOrder = await this.client.submitNewOrder(stopLossParams);

      await logAccount(
        this.accountName,
        'STOP_LOSS_UPDATED',
        symbol,
        'Stop loss updated',
        {
          new_stop_price: stopPrice,
          order_details: stopLossOrder,
        }
      );

      return true;
    } catch (error) {
      await logTrading('ERROR', symbol, 'Error placing trail stop loss', {
        account: this.accountName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async cancelAllOrder(symbol: string): Promise<void> {
    try {
      const result = await this.client.cancelAllOpenOrders({
        symbol: symbol.toUpperCase(),
      });
      await logTrading('ORDERS_CANCELLED', symbol, 'All orders cancelled', {
        result,
      });
    } catch (error) {
      await logTrading('ERROR', symbol, 'Error canceling orders', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async closePosition(symbol: string): Promise<void> {
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
            side: parseFloat(pos.positionAmt.toString()) > 0 ? 'SELL' : 'BUY',
            type: 'MARKET',
            quantity: roundedQty,
            positionSide: pos.positionSide,
          };

          const closeOrder = await this.client.submitNewOrder(closePayload);
          await logTrading('POSITION_CLOSED', symbol, 'Position closed', {
            account: this.accountName,
            close_order: closeOrder,
          });
          return;
        }
      }
      await logTrading('NO_POSITION', symbol, 'No open position to close', {});
    } catch (error) {
      await logTrading('ERROR', symbol, 'Error closing position', {
        account: this.accountName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async inExistingPosition(symbol: string): Promise<boolean> {
    try {
      const position = await this.client.getPositionsV3({ symbol });
      const openOrders = await this.client.getAllOpenOrders({ symbol });

      return (
        position.some((pos) => parseFloat(pos.positionAmt.toString()) !== 0) ||
        openOrders.some((order) => order.type === 'MARKET')
      );
    } catch (error) {
      await logTrading('ERROR', symbol, 'Error checking existing position', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return true;
    }
  }

  public getAccountManager(): AccountManager {
    return this.accountManager;
  }

  public getPositionData(accountName: string, symbol: string) {
    return this.accountManager.getPositionData(accountName, symbol);
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const ticker = await this.client.getMarkPrice({ symbol });
      return Number(ticker.markPrice);
    } catch (error) {
      await logTrading('ERROR', symbol, 'Error getting current price', {
        account: this.accountName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
