import axios from "axios";
import { pairSettings } from "./load-data";
import { Embed, WebhookPayload } from "./interfaces";
import { DEBUG_WEBHOOK_URL } from "./config";
import { tradingLogger } from './base-logger';
import { webhookLogger } from './base-logger';
import { eventEmojis } from './logger';

export async function sendDiscordWebhook(
  symbol: string,
  data: Record<string, any>,
  title: string = "Notification",
  description: string = "Details",
  isDebugLog: boolean = true
): Promise<void> {
  const url = isDebugLog 
    ? DEBUG_WEBHOOK_URL 
    : pairSettings[symbol]?.webhook_url;

  if (!url) {
    tradingLogger.info({ 
        event: "ERROR", 
        symbol, 
        message: "No webhook URL configured",
        details: { isDebugLog, symbol }
    });
    return;
  }

  // Log the webhook URL being used (masked for security)
  webhookLogger.info({
    symbol,
    event: 'WEBHOOK_ATTEMPT',
    data: {
      webhook_type: isDebugLog ? 'DEBUG' : 'SYMBOL_SPECIFIC',
      url_masked: url.substring(0, 30) + '...',
      title,
      description
    },
    url: isDebugLog ? 'DEBUG_WEBHOOK' : symbol
  });

  const formattedData = `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;

  const embed: Embed = {
    title,
    description,
    color: 0x00ff00,
    fields: [
      {
        name: "Data",
        value: formattedData,
        inline: false,
      },
    ],
  };

  const payload: WebhookPayload = {
    embeds: [embed],
  };

  try {
    // Log the actual request being made
    webhookLogger.info({
      symbol,
      event: 'WEBHOOK_REQUEST',
      data: {
        url_masked: url.substring(0, 30) + '...',
        payload: payload
      },
      url: isDebugLog ? 'DEBUG_WEBHOOK' : symbol
    });

    const response = await axios.post(url, payload);
    
    // Log successful webhook
    webhookLogger.info({
      symbol,
      event: 'WEBHOOK_SUCCESS',
      data: {
        status: response.status,
        status_text: response.statusText,
        title: title.toUpperCase().replace(/\s+/g, '_'),
        response_headers: response.headers
      },
      url: isDebugLog ? 'DEBUG_WEBHOOK' : symbol
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const axiosError = error as any;
    
    // Log detailed error information
    webhookLogger.info({
      symbol,
      event: 'WEBHOOK_ERROR',
      data: {
        error: errorMessage,
        status: axiosError.response?.status,
        status_text: axiosError.response?.statusText,
        response_data: axiosError.response?.data,
        request_url: url.substring(0, 30) + '...',
        request_payload: payload
      },
      url: isDebugLog ? 'DEBUG_WEBHOOK' : symbol
    });

    tradingLogger.info({ 
        event: "ERROR", 
        symbol, 
        message: "Error sending Discord webhook",
        details: { 
          error: errorMessage,
          status: axiosError.response?.status,
          response: axiosError.response?.data
        }
    });
  }
}
