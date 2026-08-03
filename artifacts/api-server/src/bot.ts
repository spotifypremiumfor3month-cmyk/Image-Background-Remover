import { Bot, InputFile } from "grammy";
import { logger } from "./lib/logger";

// @imgly/background-removal-node is loaded dynamically to avoid bundling issues
type RemoveBackground = (
  image: string | URL | ArrayBuffer | Uint8Array | Blob,
  config?: Record<string, unknown>,
) => Promise<Blob>;

let removeBackgroundFn: RemoveBackground | null = null;

async function getRemoveBackground(): Promise<RemoveBackground> {
  if (!removeBackgroundFn) {
    const mod = await import("@imgly/background-removal-node");
    removeBackgroundFn = mod.default as RemoveBackground;
  }
  return removeBackgroundFn;
}

const WELCOME_MESSAGE = `👋 Welcome to *Background Remover Bot*\\!

Send me any photo and I'll instantly remove the background — completely free, AI\\-powered, and professional quality\\.

📌 *How to use:*
• Send a photo directly
• Or forward an image

The result will be returned as a transparent PNG file, ready to use anywhere\\.`;

const PROCESSING_MESSAGE = `⏳ Processing your image\\.\\.\\.

The AI is removing the background\\. This usually takes 10–30 seconds on first use \\(the model needs to load\\), then much faster afterwards\\.`;

export async function startBot(): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot will not start");
    return;
  }

  const bot = new Bot(token);

  // /start and /help commands
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE, { parse_mode: "MarkdownV2" });
  });

  // Handle photos
  bot.on("message:photo", async (ctx) => {
    const processingMsg = await ctx.reply(PROCESSING_MESSAGE, {
      parse_mode: "MarkdownV2",
    });
    const chatId = ctx.chat.id;

    try {
      // Get the highest-resolution version of the photo
      const photos = ctx.message.photo;
      const bestPhoto = photos[photos.length - 1];

      // Get download URL from Telegram
      const file = await ctx.api.getFile(bestPhoto.file_id);
      if (!file.file_path) {
        throw new Error("No file_path returned from Telegram");
      }
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      logger.info(
        { chatId, fileId: bestPhoto.file_id },
        "Removing background from photo",
      );

      // Run background removal
      const removeBackground = await getRemoveBackground();
      const resultBlob = await removeBackground(fileUrl, {
        model: "medium",
        output: {
          format: "image/png",
          quality: 1.0,
        },
      });

      const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

      // Delete the "processing..." message and send the result
      await ctx.api
        .deleteMessage(chatId, processingMsg.message_id)
        .catch(() => {});

      await ctx.replyWithDocument(
        new InputFile(resultBuffer, "background_removed.png"),
        {
          caption:
            "✅ Background removed! Your transparent PNG is ready.\n\nSend another photo to process more.",
        },
      );

      logger.info({ chatId }, "Background removal successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal failed");

      await ctx.api
        .deleteMessage(chatId, processingMsg.message_id)
        .catch(() => {});

      await ctx.reply(
        "❌ Sorry, something went wrong while processing your image. Please try again — send a clear, well-lit photo for best results.",
      );
    }
  });

  // Handle documents that are images (high-res photos sent as files)
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) {
      await ctx.reply(
        "📎 I can only process images. Please send a photo or an image file.",
      );
      return;
    }

    const processingMsg = await ctx.reply(PROCESSING_MESSAGE, {
      parse_mode: "MarkdownV2",
    });
    const chatId = ctx.chat.id;

    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) {
        throw new Error("No file_path returned from Telegram");
      }
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      logger.info(
        { chatId, fileId: doc.file_id },
        "Removing background from document image",
      );

      const removeBackground = await getRemoveBackground();
      const resultBlob = await removeBackground(fileUrl, {
        model: "medium",
        output: {
          format: "image/png",
          quality: 1.0,
        },
      });

      const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

      await ctx.api
        .deleteMessage(chatId, processingMsg.message_id)
        .catch(() => {});

      await ctx.replyWithDocument(
        new InputFile(resultBuffer, "background_removed.png"),
        {
          caption:
            "✅ Background removed! Your transparent PNG is ready.\n\nSend another photo to process more.",
        },
      );

      logger.info({ chatId }, "Background removal from document successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal from document failed");

      await ctx.api
        .deleteMessage(chatId, processingMsg.message_id)
        .catch(() => {});

      await ctx.reply(
        "❌ Sorry, something went wrong while processing your image. Please try again.",
      );
    }
  });

  // Catch-all for non-image messages
  bot.on("message", async (ctx) => {
    await ctx.reply(
      "📷 Please send me a photo or image file and I'll remove the background\\!\n\nUse /help to see instructions\\.",
      { parse_mode: "MarkdownV2" },
    );
  });

  // Error handler
  bot.catch((err) => {
    logger.error(
      { err: err.error, update: err.ctx?.update },
      "Telegram bot error",
    );
  });

  // Start polling
  void bot.start({
    onStart(botInfo) {
      logger.info(
        { username: botInfo.username },
        "Telegram bot started (polling)",
      );
    },
  });
}
