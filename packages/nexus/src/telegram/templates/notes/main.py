import os, sqlite3
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

DB = os.path.expanduser("~/.nexus/notes.sqlite3")
os.makedirs(os.path.dirname(DB), exist_ok=True)
db = sqlite3.connect(DB, check_same_thread=False)
db.execute("create table if not exists notes(id integer primary key, user integer, text text)")
db.commit()

async def note(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = " ".join(context.args).strip()
    if not text:
        await update.message.reply_text("Usage: /note text")
        return
    db.execute("insert into notes(user, text) values(?, ?)", (update.effective_user.id, text))
    db.commit()
    await update.message.reply_text("Saved.")

async def notes(update: Update, context: ContextTypes.DEFAULT_TYPE):
    rows = db.execute("select id, text from notes where user=? order by id desc limit 20", (update.effective_user.id,)).fetchall()
    await update.message.reply_text("\n".join(f"{note_id}: {text}" for note_id, text in rows) or "No notes.")

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(CommandHandler("note", note))
app.add_handler(CommandHandler("notes", notes))
app.run_polling(allowed_updates=Update.ALL_TYPES)
