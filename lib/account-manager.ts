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
              file: this.filePath,
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

  public initializeAccountData(accountName: string, pairs: Pair[]): void {
    let initialized = false;

    if (!this.accountData[accountName]) {
      this.accountData[accountName] = {
        positions: {},
      };
      initialized = true;
    }

    pairs.forEach((pair) => {
      if (!this.accountData[accountName].positions[pair.symbol]) {
        this.accountData[accountName].positions[pair.symbol] = {
          status: false,
          entry_price: null,
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

    if (initialized) {
      this.saveAccountData();
    }
  }

  public updatePosition(
    accountName: string,
    symbol: string,
    updates: Partial<TokenData["positions"][string]>
  ): void {
    if (!this.accountData[accountName]) {
      throw new Error(`Account for ${accountName} does not exist.`);
    }

    if (!this.accountData[accountName].positions[symbol]) {
      throw new Error(`Symbol ${symbol} does not exist for account ${accountName}.`);
    }

    this.accountData[accountName].positions[symbol] = {
      ...this.accountData[accountName].positions[symbol],
      ...updates,
    };

    this.saveAccountData();
  }

  public getAccountData(accountName: string): TokenData | null {
    return this.accountData[accountName] || null;
  }

  public getPositionData(
    accountName: string,
    symbol: string
  ): TokenData["positions"][string] | null {
    const account = this.getAccountData(accountName);
    if (account && account.positions[symbol]) {
      return account.positions[symbol];
    }
    return null;
  }

  public deleteAccount(accountName: string): void {
    if (this.accountData[accountName]) {
      delete this.accountData[accountName];
      this.saveAccountData();
    } else {
      throw new Error(`Account for ${accountName} does not exist.`);
    }
  }

  public deletePosition(accountName: string, symbol: string): void {
    const account = this.getAccountData(accountName);
    if (account && account.positions[symbol]) {
      delete account.positions[symbol];
      this.saveAccountData();
    } else {
      throw new Error(
        `Position for symbol ${symbol} does not exist in account ${accountName}.`
      );
    }
  }
}
