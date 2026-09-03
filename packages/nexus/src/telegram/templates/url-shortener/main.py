import os, requests
from telegram import Update
from telegram.ext import Application, MessageHandler, ContextTypes, filters

async def shorten(update: Update, context: ContextTypes.DEFAULT_TYPE):
    url = (update.message.text or "").strip()
    if not url.startswith(("http://", "https://")):
        await update.message.reply_text("Send an http(s) URL.")
        return
    try:
        response = requests.get("https://tinyurl.com/api-create.php", params={"url": url}, timeout=20)
        response.raise_for_status()
        await update.message.reply_text(response.text)
    except Exception as exc:
        await update.message.reply_text(f"Shortener error: {exc}")

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, shorten))
app.run_polling(allowed_updates=Update.ALL_TYPES)
