import { Bot, InputFile, InlineKeyboard } from "grammy";
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

// ── Messages (HTML parse mode — no special escaping needed) ──────────────────

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

🆓 <b>Cost:</b> Completely free — the AI model runs locally with no third-party API calls.`;

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

// ── Core removal logic (shared between photo and document handlers) ───────────

async function processImage(
  fileUrl: string,
  chatId: number,
  processingMsgId: number,
  ctx: {
    api: {
      deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
    };
    replyWithDocument: (
      file: InputFile,
      opts?: Record<string, unknown>,
    ) => Promise<unknown>;
    reply: (text: string, opts?: Record<string, unknown>) => Promise<unknown>;
  },
  token: string,
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

// ── Bot setup ─────────────────────────────────────────────────────────────────

export async function startBot(): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot will not start");
    return;
  }

  const bot = new Bot(token);

  // /start
  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  // /help
  bot.command("help", async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  // /tips
  bot.command("tips", async (ctx) => {
    await ctx.reply(TIPS_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(),
    });
  });

  // ── Inline button callbacks ────────────────────────────────────────────────

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

  // ── Photo handler ──────────────────────────────────────────────────────────

  bot.on("message:photo", async (ctx) => {
    const processingMsg = await ctx.reply(
      "⏳ <b>Processing your image...</b>\n\n<i>The AI is removing the background — hang tight!</i>",
      { parse_mode: "HTML" },
    );
    const chatId = ctx.chat.id;

    try {
      const photos = ctx.message.photo;
      const bestPhoto = photos[photos.length - 1];

      const file = await ctx.api.getFile(bestPhoto.file_id);
      if (!file.file_path) throw new Error("No file_path from Telegram");

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      logger.info({ chatId, fileId: bestPhoto.file_id }, "Removing background from photo");

      await processImage(fileUrl, chatId, processingMsg.message_id, ctx as never, token);

      logger.info({ chatId }, "Background removal successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal failed");
      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.reply(
        "❌ <b>Something went wrong.</b>\n\nPlease try again with a different photo. For best results, use a clear, well-lit image.\n\nTap 💡 <b>Tips</b> for guidance.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }
  });

  // ── Document (image file) handler ─────────────────────────────────────────

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;

    if (!doc.mime_type?.startsWith("image/")) {
      await ctx.reply(
        "📎 <b>Unsupported file type</b>\n\nPlease send an image file (JPG, PNG, WEBP) or simply send a photo directly.",
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
      logger.info({ chatId, fileId: doc.file_id }, "Removing background from document image");

      await processImage(fileUrl, chatId, processingMsg.message_id, ctx as never, token);

      logger.info({ chatId }, "Background removal from document successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal from document failed");
      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.reply(
        "❌ <b>Something went wrong.</b>\n\nPlease try again. Tap 💡 <b>Tips</b> for best-result guidance.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }
  });

  // ── Catch-all ─────────────────────────────────────────────────────────────

  bot.on("message", async (ctx) => {
    await ctx.reply(
      "📸 <b>Send me a photo to get started!</b>\n\nJust drop any image here and I'll remove the background instantly.",
      { parse_mode: "HTML", reply_markup: mainKeyboard() },
    );
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx?.update }, "Telegram bot error");
  });

  // Start polling
  void bot.start({
    onStart(botInfo) {
      logger.info({ username: botInfo.username }, "Telegram bot started (polling)");
    },
  });
}
