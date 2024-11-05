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

// Add validation for API credentials
if (!config.accounts.every(acc => acc.api_key && acc.api_secret)) {
    throw new Error('Missing API credentials in config');
}

// Add validation for USDT amounts
if (!config.pairs.every(pair => pair.usdt_amount > 0)) {
    throw new Error('Invalid USDT amount in config');
}