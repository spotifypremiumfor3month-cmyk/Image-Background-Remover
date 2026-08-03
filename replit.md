# Background Remover Telegram Bot

A Telegram bot that removes image backgrounds for free using on-device AI (no paid APIs). Users send a photo; the bot returns a transparent PNG.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Telegram bot (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env secret: `TELEGRAM_BOT_TOKEN` — from @BotFather on Telegram

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot framework: grammy v1
- Background removal: @imgly/background-removal-node (ONNX, free, runs locally)
- DB: PostgreSQL + Drizzle ORM (provisioned, not currently used)

## Where things live

- `artifacts/api-server/src/bot.ts` — all Telegram bot logic
- `artifacts/api-server/src/index.ts` — starts Express server then calls `startBot()`
- `artifacts/api-server/build.mjs` — esbuild config; grammy + @imgly externalized

## Architecture decisions

- Bot runs in the same process as Express via long-polling (no webhook needed)
- `grammy` and `@imgly/background-removal-node` are externalized in esbuild (not bundled) because both rely on relative internal requires / WASM binary loading
- ONNX models are downloaded from jsDelivr CDN on first use, then cached
- `model: "medium"` gives a solid quality/speed balance; swap to `"large"` for max quality

## Product

Users open the bot, send any photo, and receive a transparent PNG with the background cleanly removed — powered by the U2-Net model via @imgly/background-removal-node.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- First background removal takes longer (~15–30s) because the ONNX model downloads from CDN; subsequent requests are fast
- `onnxruntime-node` and `sharp` require native build approval — they are in the `onlyBuiltDependencies` list in `pnpm-workspace.yaml`
- Never add `grammy` or `@imgly/background-removal-node` to the esbuild bundle; keep them external
