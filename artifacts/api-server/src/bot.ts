import { Bot, InputFile, InlineKeyboard, webhookCallback } from "grammy";
import { type RequestHandler } from "express";
import { logger } from "./lib/logger";

// @imgly/background-removal-node loaded dynamically to avoid bundling issues
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

// ── Messages ──────────────────────────────────────────────────────────────────

const WELCOME_MESSAGE = `✨ <b>Background Remover Pro</b>

Remove backgrounds from any photo instantly — powered by AI, completely free, and professional quality.

──────────────────
📸 <b>Send a photo to get started!</b>
──────────────────

The result is returned as a transparent PNG, ready to use in any design, presentation, or social post.`;

const TIPS_MESSAGE = `💡 <b>Tips for Best Results</b>

Follow these guidelines to get the cleanest cut:

<b>🖼 Image quality</b>
• Use clear, sharp, well-lit photos
• Avoid blurry or pixelated images
• Higher resolution = cleaner edges

<b>🎨 Background contrast</b>
• High contrast between subject and background works best
• Solid-color backgrounds (white, grey) give perfect results
• Complex busy backgrounds may need a touch-up

<b>🧑 Portraits &amp; people</b>
• Works great on people, hair, and fine details
• Face the camera directly for cleanest results

<b>🐾 Objects &amp; products</b>
• Products on flat surfaces work very well
• Keep the subject centred in the frame

<b>📤 Sending photos</b>
• Send as a <b>photo</b> for standard quality
• Send as a <b>file / document</b> to preserve full resolution

<i>⏱ First request may take 20–30 seconds while the AI model loads. All requests after that are much faster.</i>`;

const HOW_IT_WORKS_MESSAGE = `⚙️ <b>How It Works</b>

<b>Step 1 — Send a photo</b>
Drop any image into the chat.

<b>Step 2 — AI processing</b>
The bot runs an on-device AI model (U2-Net) to precisely detect the subject and cleanly separate it from the background.

<b>Step 3 — Get your PNG</b>
You receive a transparent PNG in seconds — no watermarks, no limits, no cost.

──────────────────
🔒 <b>Privacy:</b> Images are processed on the server and never stored or shared.

🆓 <b>Cost:</b> Completely free — the AI runs locally with no third-party API calls.`;

const READY_TO_REMOVE_MESSAGE = `🖼️ <b>Ready to remove a background!</b>

Send me your photo now and I'll process it instantly.

<i>You can send it as a photo or as a file for full resolution.</i>`;

// ── Keyboards ─────────────────────────────────────────────────────────────────

function mainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🖼️ Remove Background", "remove_bg")
    .row()
    .text("💡 Tips for best results", "tips")
    .text("⚙️ How it works", "how_it_works");
}

function afterResultKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🖼️ Remove Another", "remove_bg")
    .row()
    .text("💡 Tips", "tips")
    .text("⚙️ How it works", "how_it_works");
}

// ── Shared image processing ───────────────────────────────────────────────────

async function handleImageUrl(
  fileUrl: string,
  chatId: number,
  processingMsgId: number,
  ctx: {
    api: { deleteMessage(a: number, b: number): Promise<unknown> };
    replyWithDocument(
      f: InputFile,
      o?: Record<string, unknown>,
    ): Promise<unknown>;
    reply(t: string, o?: Record<string, unknown>): Promise<unknown>;
  },
): Promise<void> {
  const removeBackground = await getRemoveBackground();
  const resultBlob = await removeBackground(fileUrl, {
    model: "medium",
    output: { format: "image/png", quality: 1.0 },
  });

  const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

  await ctx.api.deleteMessage(chatId, processingMsgId).catch(() => {});

  await ctx.replyWithDocument(
    new InputFile(resultBuffer, "background_removed.png"),
    {
      caption:
        "✅ <b>Done!</b> Your transparent PNG is ready.\n\n<i>Send another photo anytime to remove its background.</i>",
      parse_mode: "HTML",
      reply_markup: afterResultKeyboard(),
    },
  );
}

// ── Bot factory ───────────────────────────────────────────────────────────────

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Commands
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  bot.command("tips", async (ctx) => {
    await ctx.reply(TIPS_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  // Inline button callbacks
  bot.callbackQuery("remove_bg", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(READY_TO_REMOVE_MESSAGE, { parse_mode: "HTML" });
  });

  bot.callbackQuery("tips", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(TIPS_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  bot.callbackQuery("how_it_works", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(HOW_IT_WORKS_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  // Photo handler
  bot.on("message:photo", async (ctx) => {
    const processingMsg = await ctx.reply(
      "⏳ <b>Processing your image...</b>\n\n<i>The AI is removing the background — hang tight!</i>",
      { parse_mode: "HTML" },
    );
    const chatId = ctx.chat.id;

    try {
      const bestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(bestPhoto.file_id);
      if (!file.file_path) throw new Error("No file_path from Telegram");

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      logger.info({ chatId, fileId: bestPhoto.file_id }, "Removing background from photo");

      await handleImageUrl(fileUrl, chatId, processingMsg.message_id, ctx as never);

      logger.info({ chatId }, "Background removal successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal failed");
      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.reply(
        "❌ <b>Something went wrong.</b>\n\nPlease try again with a different photo. Tap 💡 <b>Tips</b> for guidance.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }
  });

  // Document (image file) handler
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;

    if (!doc.mime_type?.startsWith("image/")) {
      await ctx.reply(
        "📎 <b>Unsupported file type</b>\n\nPlease send an image file (JPG, PNG, WEBP) or send a photo directly.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
      return;
    }

    const processingMsg = await ctx.reply(
      "⏳ <b>Processing your image...</b>\n\n<i>The AI is removing the background — hang tight!</i>",
      { parse_mode: "HTML" },
    );
    const chatId = ctx.chat.id;

    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error("No file_path from Telegram");

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      logger.info({ chatId, fileId: doc.file_id }, "Removing background from document");

      await handleImageUrl(fileUrl, chatId, processingMsg.message_id, ctx as never);

      logger.info({ chatId }, "Background removal from document successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal from document failed");
      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.reply(
        "❌ <b>Something went wrong.</b>\n\nPlease try again. Tap 💡 <b>Tips</b> for guidance.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }
  });

  // Catch-all
  bot.on("message", async (ctx) => {
    await ctx.reply(
      "📸 <b>Send me a photo to get started!</b>\n\nJust drop any image here and I'll remove the background instantly.",
      { parse_mode: "HTML", reply_markup: mainKeyboard() },
    );
  });

  // Error handler
  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx?.update }, "Telegram bot error");
  });

  return bot;
}

// ── Public API ────────────────────────────────────────────────────────────────

let botInstance: Bot | null = null;

/**
 * Returns an Express middleware that handles Telegram webhook POSTs.
 * Call this once and mount the result at /api/telegram-webhook.
 * The handler sends 200 immediately then processes the update asynchronously
 * so Telegram never times out waiting for the response.
 */
export function createWebhookHandler(token: string): RequestHandler {
  botInstance = createBot(token);
  const handler = webhookCallback(botInstance, "express");

  // Fire-and-forget wrapper: respond 200 immediately, process in background.
  // This is critical for autoscale deployments — long background-removal jobs
  // must not block the HTTP response or Telegram will retry the update.
  return (req, res, next) => {
    res.sendStatus(200);
    // Pass a fake res to grammy so it doesn't try to write again
    const fakeRes = {
      ...res,
      end: () => {},
      send: () => fakeRes,
      sendStatus: () => fakeRes,
      status: () => fakeRes,
      json: () => fakeRes,
    } as unknown as typeof res;
    handler(req, fakeRes, next);
  };
}

/**
 * Registers the webhook URL with Telegram. Call this after the server is
 * listening and the public URL is known.
 */
export async function registerWebhook(token: string, publicUrl: string): Promise<void> {
  const webhookUrl = `${publicUrl}/api/telegram-webhook`;
  await botInstance!.api.setWebhook(webhookUrl);
  logger.info({ webhookUrl }, "Telegram webhook registered");
}

/**
 * Starts the bot in polling mode (development only).
 */
export async function startPolling(token: string): Promise<void> {
  const bot = createBot(token);
  botInstance = bot;
  // Make sure no stale webhook is set
  await bot.api.deleteWebhook();
  void bot.start({
    onStart(info) {
      logger.info({ username: info.username }, "Telegram bot started (polling)");
    },
  });
}
