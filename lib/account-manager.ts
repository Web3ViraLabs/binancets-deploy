import fs from "fs";
import { Pair, AccountData, PositionsMap, TokenData } from "./interfaces";
import { logTrading } from "./logger";
import moment from "moment";

export class AccountManager {
  private accountData: AccountData;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.accountData = this.loadAccountData();
  }

  private loadAccountData(): AccountData {
    if (fs.existsSync(this.filePath)) {
      const data = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(data) as AccountData;
    } else {
      return {} as AccountData;
    }
  }

  private saveAccountData(): void {
    fs.writeFile(
      this.filePath,
      JSON.stringify(this.accountData, null, 2),
      "utf-8",
      async (err) => {
        if (err) {
          await logTrading(
            "ERROR",
            "SYSTEM",
            "Error saving account data",
            { 
              error: err.message,
              timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
            }
          );
        } else {
          await logTrading(
            "SYSTEM",
            "SYSTEM",
            "Account data saved successfully",
            { 
              timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
            }
          );
        }
      }
    );
  }

  public initializeAccountData(tokens: string[], pairs: Pair[]): void {
    let initialized = false;

    tokens.forEach((token) => {
      if (!this.accountData[token]) {
        this.accountData[token] = {
          positions: {},
        };
        initialized = true;
      }

      pairs.forEach((pair) => {
        if (!this.accountData[token].positions[pair.symbol]) {
          this.accountData[token].positions[pair.symbol] = {
            status: false,
            entry_price: 0.0,
            triggers: [],
            stop_prices: [],
            trigger_side: null,
            lock_close_price: null,
            movement_threshold: null,
            is_placing_stop_loss_running: false,
          };
          initialized = true;
        }
      });
    });

    if (initialized) {
      this.saveAccountData();
    }
  }

  public updatePosition(
    token: string,
    symbol: string,
    updates: Partial<TokenData["positions"][string]>
  ): void {
    if (!this.accountData[token]) {
      throw new Error(`Account for token ${token} does not exist.`);
    }

    if (!this.accountData[token].positions[symbol]) {
      throw new Error(`Symbol ${symbol} does not exist for token ${token}.`);
    }

    this.accountData[token].positions[symbol] = {
      ...this.accountData[token].positions[symbol],
      ...updates,
    };

    this.saveAccountData();
  }

  public getAccountData(token: string): TokenData | null {
    return this.accountData[token] || null;
  }

  public getPositionData(
    token: string,
    symbol: string
  ): TokenData["positions"][string] | null {
    const account = this.getAccountData(token);
    if (account && account.positions[symbol]) {
      return account.positions[symbol];
    }
    return null;
  }

  public deleteAccount(token: string): void {
    if (this.accountData[token]) {
      delete this.accountData[token];
      this.saveAccountData();
    } else {
      throw new Error(`Account for token ${token} does not exist.`);
    }
  }

  public deletePosition(token: string, symbol: string): void {
    const account = this.getAccountData(token);
    if (account && account.positions[symbol]) {
      delete account.positions[symbol];
      this.saveAccountData();
    } else {
      throw new Error(
        `Position for symbol ${symbol} does not exist in token ${token}.`
      );
    }
  }
}
