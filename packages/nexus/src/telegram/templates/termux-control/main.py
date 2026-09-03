import json, os, shlex, subprocess
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

USERS = {int(value) for value in os.getenv("TELEGRAM_ALLOWED_USER_IDS", "").split(",") if value.strip().isdigit()}
ALLOWED = set(os.getenv("TERMUX_ALLOWED_COMMANDS", "ls,pwd,whoami,df,uname,ps,termux-battery-status,termux-location").split(","))

def authorized(update):
    return not USERS or update.effective_user.id in USERS

def run(command):
    parts = shlex.split(command)
    if not parts or parts[0] not in ALLOWED:
        return "Blocked. Add only safe commands to TERMUX_ALLOWED_COMMANDS."
    result = subprocess.run(parts, capture_output=True, text=True, timeout=20)
    return (result.stdout + result.stderr)[-3800:] or "(no output)"

async def cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if authorized(update):
        await update.message.reply_text(run(" ".join(context.args)) if context.args else "Usage: /cmd ls -la")

async def battery(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if authorized(update):
        await update.message.reply_text(run("termux-battery-status"))

async def location(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if authorized(update):
        await update.message.reply_text(run("termux-location"))

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(CommandHandler("cmd", cmd))
app.add_handler(CommandHandler("battery", battery))
app.add_handler(CommandHandler("location", location))
app.run_polling(allowed_updates=Update.ALL_TYPES)
