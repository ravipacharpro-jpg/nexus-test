import os
from pathlib import Path
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

ROOT = Path(os.getenv("FILE_ROOT", "~/storage/shared")).expanduser().resolve()

def safe_path(value):
    path = (ROOT / value).resolve()
    return path if path == ROOT or ROOT in path.parents else None

async def ls(update: Update, context: ContextTypes.DEFAULT_TYPE):
    path = safe_path(" ".join(context.args) if context.args else ".")
    if not path or not path.is_dir():
        await update.message.reply_text("Path is outside FILE_ROOT or missing.")
        return
    await update.message.reply_text("\n".join(item.name for item in path.iterdir())[:4000] or "(empty)")

async def get_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    path = safe_path(" ".join(context.args) if context.args else "")
    if not path or not path.is_file():
        await update.message.reply_text("File is outside FILE_ROOT or missing.")
        return
    with path.open("rb") as handle:
        await update.message.reply_document(handle)

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(CommandHandler("ls", ls))
app.add_handler(CommandHandler("file", get_file))
app.run_polling(allowed_updates=Update.ALL_TYPES)
