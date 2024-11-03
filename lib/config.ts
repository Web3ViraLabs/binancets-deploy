import dotenv from 'dotenv';
import { Config } from './interfaces';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Load config.json
const configFile: Config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

export const config: Config = {
    ...configFile,  // Use all configurations from config.json
    order_url: process.env.ORDER_URL || configFile.order_url,
};

// Export sensitive configurations from .env
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
export const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;