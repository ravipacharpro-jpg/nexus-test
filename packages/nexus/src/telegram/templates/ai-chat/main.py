import asyncio, os, sqlite3, requests
from telegram import Update
from telegram.ext import Application, MessageHandler, ContextTypes, filters

DB = os.path.expanduser(os.getenv("AI_DB", "~/.nexus/ai-chat.sqlite3"))
os.makedirs(os.path.dirname(DB), exist_ok=True)
db = sqlite3.connect(DB, check_same_thread=False)
db.execute("create table if not exists memory (user_id text, role text, content text, created integer default (unixepoch()))")
db.commit()

def history(user_id):
    rows = db.execute("select role, content from memory where user_id=? order by created desc limit 12", (str(user_id),)).fetchall()
    return [{"role": role, "content": content} for role, content in rows[::-1]]

def ask(messages):
    if os.getenv("OLLAMA_URL"):
        response = requests.post(os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat"), json={"model": os.getenv("OLLAMA_MODEL", "llama3.2:1b"), "messages": messages, "stream": False}, timeout=120)
        response.raise_for_status()
        return response.json()["message"]["content"]
    response = requests.post(os.getenv("AI_BASE_URL", "https://api.openai.com/v1/chat/completions"), headers={"Authorization": f"Bearer {os.environ['AI_API_KEY']}"}, json={"model": os.getenv("AI_MODEL", "gpt-4o-mini"), "messages": messages}, timeout=120)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]

async def chat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private" and not (update.message.text and (f"@{context.bot.username}" in update.message.text or update.message.reply_to_message)):
        return
    text = update.message.text or ""
    user_id = update.effective_user.id
    try:
        answer = await asyncio.to_thread(ask, history(user_id) + [{"role": "user", "content": text}])
        db.execute("insert into memory(user_id, role, content) values(?,?,?)", (str(user_id), "user", text))
        db.execute("insert into memory(user_id, role, content) values(?,?,?)", (str(user_id), "assistant", answer))
        db.commit()
        await update.message.reply_text(answer[:4096])
    except Exception as exc:
        await update.message.reply_text(f"AI error: {exc}")

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, chat))
app.run_polling(allowed_updates=Update.ALL_TYPES)
