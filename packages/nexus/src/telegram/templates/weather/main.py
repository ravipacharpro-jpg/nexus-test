import os, requests
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

async def weather(update: Update, context: ContextTypes.DEFAULT_TYPE):
    city = " ".join(context.args).strip() or os.getenv("DEFAULT_CITY", "Delhi")
    try:
        response = requests.get(f"https://wttr.in/{city}", params={"format": "3"}, headers={"User-Agent": "NEXUSBot/1.0"}, timeout=20)
        response.raise_for_status()
        await update.message.reply_text(response.text)
    except Exception as exc:
        await update.message.reply_text(f"Weather error: {exc}")

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(CommandHandler("weather", weather))
app.run_polling(allowed_updates=Update.ALL_TYPES)
