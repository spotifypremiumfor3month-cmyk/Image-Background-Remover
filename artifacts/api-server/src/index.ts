import app from "./app";
import { logger } from "./lib/logger";
import { startPolling, registerWebhook } from "./bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const token = process.env["TELEGRAM_BOT_TOKEN"];
const isProduction = process.env["NODE_ENV"] === "production";

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot will not start");
    return;
  }

  if (isProduction) {
    // Production: webhook mode — Telegram pushes updates to us.
    // The route is already mounted in app.ts; we just need to tell
    // Telegram which URL to use.
    const domains = process.env["REPLIT_DOMAINS"];
    const primaryDomain = domains?.split(",")[0]?.trim();

    if (!primaryDomain) {
      logger.warn("REPLIT_DOMAINS not set — cannot register webhook");
      return;
    }

    try {
      await registerWebhook(token, `https://${primaryDomain}`);
    } catch (err) {
      logger.error({ err }, "Failed to register Telegram webhook");
    }
  } else {
    // Development: polling mode — bot connects to Telegram directly.
    try {
      await startPolling(token);
    } catch (err) {
      logger.error({ err }, "Failed to start Telegram bot polling");
    }
  }
});
