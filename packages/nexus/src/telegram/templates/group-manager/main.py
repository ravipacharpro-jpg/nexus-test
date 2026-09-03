import os, time
from collections import defaultdict, deque
from telegram import Update
from telegram.ext import Application, ChatMemberHandler, CommandHandler, MessageHandler, ContextTypes, filters

WINDOW = int(os.getenv("FLOOD_WINDOW_SECONDS", "8"))
LIMIT = int(os.getenv("FLOOD_MESSAGE_LIMIT", "6"))
activity = defaultdict(deque)

async def is_admin(update, user_id):
    member = await update.effective_chat.get_member(user_id)
    return member.status in {"administrator", "creator"}

async def welcome(update: Update, context: ContextTypes.DEFAULT_TYPE):
    for user in update.chat_member.new_chat_members:
        await context.bot.send_message(update.effective_chat.id, f"Welcome {user.full_name}!")

async def moderate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.from_user or await is_admin(update, update.message.from_user.id):
        return
    key = (update.effective_chat.id, update.message.from_user.id)
    now = time.monotonic()
    activity[key].append(now)
    while activity[key] and now - activity[key][0] > WINDOW:
        activity[key].popleft()
    if len(activity[key]) > LIMIT:
        await update.message.delete()

async def ban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if await is_admin(update, update.effective_user.id) and update.message.reply_to_message:
        await context.bot.ban_chat_member(update.effective_chat.id, update.message.reply_to_message.from_user.id)

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(ChatMemberHandler(welcome, ChatMemberHandler.CHAT_MEMBER))
app.add_handler(CommandHandler("ban", ban))
app.add_handler(MessageHandler(filters.ALL, moderate))
app.run_polling(allowed_updates=Update.ALL_TYPES)
