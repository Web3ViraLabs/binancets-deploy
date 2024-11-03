export interface Pair {
  symbol: string;
  threshold: number;
  fees_exemption_percentage: number;
  num_previous_candles: number;
  qty: number;
}

export interface Config {
  order_url: string;
  websocket_interval: string;
  api_interval: string;
  tokens: string[];
  pairs: Pair[];
}

// Updated Position interface with lock_close_price and movement_thresholds inside
export interface Position {
  status: boolean;
  entry_price: number | null; // Nullable because we sometimes set it to null
  triggers: number[]; // Array of trigger prices
  stop_prices: number[]; // Array of stop prices
  trigger_side: "long" | "short" | null;
  lock_close_price: number | null; // Lock price for the position
  movement_threshold: number | null; // Movement threshold for the position
  is_placing_stop_loss_running: boolean | false;
}

// Interface for the positions mapped by the symbol
export interface PositionsMap {
  [symbol: string]: Position;
}

// Interface for the structure of account data for a single token
export interface TokenData {
  positions: PositionsMap; // Positions by symbol
}

// Interface for the account data object that contains multiple tokens
export interface AccountData {
  [token: string]: TokenData;
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  ignore: number;
}

export interface ApiCredentials {
  api_key: string;
  secret_key: string;
  webhook_url: string;
}

export interface ApiCredentialsMap {
  [token: string]: ApiCredentials;
}

export interface OrderResult {
  success: boolean;
  positionOrderId?: number;
  stopLossOrderId?: number;
  positionDetails?: Record<string, any>;
  stopLossDetails?: Record<string, any>;
  error?: string;
}
