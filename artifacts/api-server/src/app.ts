import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createWebhookHandler } from "./bot";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, Telegram sends updates here via webhook.
// The handler responds 200 immediately so autoscale never times out.
const token = process.env["TELEGRAM_BOT_TOKEN"];
if (process.env["NODE_ENV"] === "production" && token) {
  app.post("/api/telegram-webhook", createWebhookHandler(token));
  logger.info("Telegram webhook route registered at /api/telegram-webhook");
}

export default app;
