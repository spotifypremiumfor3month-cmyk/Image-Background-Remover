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

// ── Messages ─────────────────────────────────────────────────────────────────

const WELCOME_MESSAGE = `✨ *Background Remover Pro*

Remove backgrounds from any photo instantly — powered by AI, completely free, and professional quality\\.

━━━━━━━━━━━━━━━━━━
📸 *Just send a photo to get started\\!*
━━━━━━━━━━━━━━━━━━

The result is returned as a transparent PNG, ready to drop into any design, presentation, or social post\\.`;

const TIPS_MESSAGE = `💡 *Tips for Best Results*

Follow these guidelines to get the cleanest cut:

*🖼 Image quality*
• Use clear, sharp, well\\-lit photos
• Avoid blurry or pixelated images
• Higher resolution = cleaner edges

*🎨 Background contrast*
• High contrast between subject and background works best
• Solid\\-color backgrounds \\(white, grey\\) give perfect results
• Complex busy backgrounds may need a touch\\-up

*🧑 Portraits & people*
• Works great on people, hair, and fine details
• Face the camera directly for cleanest results

*🐾 Objects & products*
• Products on flat surfaces work very well
• Keep the subject centred in the frame

*📤 Sending photos*
• Send as a *photo* for regular quality
• Send as a *file / document* to preserve full resolution

_Tip: The first request may take 20–30 seconds while the AI model loads\\. All requests after that are much faster\\._`;

const HOW_IT_WORKS_MESSAGE = `⚙️ *How It Works*

*Step 1 — Send a photo*
Just drop any image into the chat\\.

*Step 2 — AI processing*
The bot runs an on\\-device AI model \\(U2\\-Net\\) to detect the subject and cleanly separate it from the background\\.

*Step 3 — Get your PNG*
You receive a transparent PNG file in seconds — no watermarks, no limits, no cost\\.

━━━━━━━━━━━━━━━━━━
🔒 *Privacy*: Images are processed on the server and never stored or shared\\.

🆓 *Cost*: Completely free — the AI model runs locally with no third\\-party API calls\\.`;

// ── Keyboards ─────────────────────────────────────────────────────────────────

function mainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💡 Tips for best results", "tips")
    .text("⚙️ How it works", "how_it_works");
}

function afterResultKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💡 Tips", "tips")
    .text("⚙️ How it works", "how_it_works");
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
      parse_mode: "MarkdownV2",
      reply_markup: mainKeyboard(),
    });
  });

  // /help
  bot.command("help", async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE, {
      parse_mode: "MarkdownV2",
      reply_markup: mainKeyboard(),
    });
  });

  // /tips
  bot.command("tips", async (ctx) => {
    await ctx.reply(TIPS_MESSAGE, { parse_mode: "MarkdownV2" });
  });

  // Inline button — Tips
  bot.callbackQuery("tips", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(TIPS_MESSAGE, { parse_mode: "MarkdownV2" });
  });

  // Inline button — How it works
  bot.callbackQuery("how_it_works", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(HOW_IT_WORKS_MESSAGE, { parse_mode: "MarkdownV2" });
  });

  // ── Photo handler ──────────────────────────────────────────────────────────

  bot.on("message:photo", async (ctx) => {
    const processingMsg = await ctx.reply(
      "⏳ *Processing your image\\.\\.\\.*\n\n_The AI is removing the background — hang tight\\!_",
      { parse_mode: "MarkdownV2" },
    );
    const chatId = ctx.chat.id;

    try {
      const photos = ctx.message.photo;
      const bestPhoto = photos[photos.length - 1];

      const file = await ctx.api.getFile(bestPhoto.file_id);
      if (!file.file_path) throw new Error("No file_path from Telegram");

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      logger.info({ chatId, fileId: bestPhoto.file_id }, "Removing background from photo");

      const removeBackground = await getRemoveBackground();
      const resultBlob = await removeBackground(fileUrl, {
        model: "medium",
        output: { format: "image/png", quality: 1.0 },
      });

      const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

      await ctx.replyWithDocument(
        new InputFile(resultBuffer, "background_removed.png"),
        {
          caption:
            "✅ *Done\\!* Your transparent PNG is ready\\.\n\n_Send another photo anytime to remove its background\\._",
          parse_mode: "MarkdownV2",
          reply_markup: afterResultKeyboard(),
        },
      );

      logger.info({ chatId }, "Background removal successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal failed");
      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.reply(
        "❌ *Something went wrong\\.*\n\nPlease try again with a different photo\\. For best results, use a clear, well\\-lit image\\.\n\nTap 💡 *Tips* for guidance\\.",
        {
          parse_mode: "MarkdownV2",
          reply_markup: mainKeyboard(),
        },
      );
    }
  });

  // ── Document (image file) handler ─────────────────────────────────────────

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;

    if (!doc.mime_type?.startsWith("image/")) {
      await ctx.reply(
        "📎 *Unsupported file type*\n\nPlease send an image file \\(JPG, PNG, WEBP\\) or simply send a photo directly\\.",
        {
          parse_mode: "MarkdownV2",
          reply_markup: mainKeyboard(),
        },
      );
      return;
    }

    const processingMsg = await ctx.reply(
      "⏳ *Processing your image\\.\\.\\.*\n\n_The AI is removing the background — hang tight\\!_",
      { parse_mode: "MarkdownV2" },
    );
    const chatId = ctx.chat.id;

    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error("No file_path from Telegram");

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      logger.info({ chatId, fileId: doc.file_id }, "Removing background from document image");

      const removeBackground = await getRemoveBackground();
      const resultBlob = await removeBackground(fileUrl, {
        model: "medium",
        output: { format: "image/png", quality: 1.0 },
      });

      const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

      await ctx.replyWithDocument(
        new InputFile(resultBuffer, "background_removed.png"),
        {
          caption:
            "✅ *Done\\!* Your transparent PNG is ready\\.\n\n_Send another photo anytime to remove its background\\._",
          parse_mode: "MarkdownV2",
          reply_markup: afterResultKeyboard(),
        },
      );

      logger.info({ chatId }, "Background removal from document successful");
    } catch (err) {
      logger.error({ err, chatId }, "Background removal from document failed");
      await ctx.api.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.reply(
        "❌ *Something went wrong\\.*\n\nPlease try again\\. Tap 💡 *Tips* for best\\-result guidance\\.",
        {
          parse_mode: "MarkdownV2",
          reply_markup: mainKeyboard(),
        },
      );
    }
  });

  // ── Catch-all ─────────────────────────────────────────────────────────────

  bot.on("message", async (ctx) => {
    await ctx.reply(
      "📸 *Send me a photo to get started\\!*\n\nJust drop any image here and I'll remove the background instantly\\.",
      {
        parse_mode: "MarkdownV2",
        reply_markup: mainKeyboard(),
      },
    );
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  bot.catch((err) => {
    logger.error(
      { err: err.error, update: err.ctx?.update },
      "Telegram bot error",
    );
  });

  // Start polling
  void bot.start({
    onStart(botInfo) {
      logger.info({ username: botInfo.username }, "Telegram bot started (polling)");
    },
  });
}
