import asyncio, os, re, sqlite3, time
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

DB = os.path.expanduser("~/.nexus/reminders.sqlite3")
os.makedirs(os.path.dirname(DB), exist_ok=True)
db = sqlite3.connect(DB, check_same_thread=False)
db.execute("create table if not exists reminders(id integer primary key, user integer, at integer, text text)")
db.commit()

async def remind(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /remind 10m text")
        return
    match = re.fullmatch(r"(\\d+)([smhd])", context.args[0])
    if not match:
        await update.message.reply_text("Use 10m, 2h, or 1d.")
        return
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    at = int(time.time()) + int(match.group(1)) * units[match.group(2)]
    db.execute("insert into reminders(user, at, text) values(?, ?, ?)", (update.effective_user.id, at, " ".join(context.args[1:]) or "Reminder"))
    db.commit()
    await update.message.reply_text("Reminder set.")

async def worker(app):
    while True:
        rows = db.execute("select id, user, text from reminders where at<=?", (int(time.time()),)).fetchall()
        for reminder_id, user_id, text in rows:
            await app.bot.send_message(user_id, text)
            db.execute("delete from reminders where id=?", (reminder_id,))
        db.commit()
        await asyncio.sleep(15)

async def startup(app):
    asyncio.create_task(worker(app))

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).post_init(startup).build()
app.add_handler(CommandHandler("remind", remind))
app.run_polling(allowed_updates=Update.ALL_TYPES)
