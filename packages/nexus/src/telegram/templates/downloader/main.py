import asyncio, os, shutil, tempfile
from pathlib import Path
from urllib.parse import urlparse
import yt_dlp
from telegram import Update
from telegram.ext import Application, MessageHandler, ContextTypes, filters

MAX_BYTES = 2 * 1024 * 1024 * 1024

def is_url(value):
    return urlparse(value).scheme in {"http", "https"}

async def download(update: Update, context: ContextTypes.DEFAULT_TYPE):
    url = (update.message.text or "").strip()
    if not is_url(url):
        await update.message.reply_text("Send a valid http(s) video URL.")
        return
    status = await update.message.reply_text("Downloading: 0%")
    folder = Path(tempfile.mkdtemp(prefix="nexus-download-"))
    loop = asyncio.get_running_loop()
    last = [-1]
    def progress(data):
        if data.get("status") != "downloading":
            return
        total = data.get("total_bytes") or data.get("total_bytes_estimate")
        done = data.get("downloaded_bytes", 0)
        percent = int(done * 100 / total) if total else 0
        if percent >= last[0] + 10:
            last[0] = percent
            asyncio.run_coroutine_threadsafe(status.edit_text(f"Downloading: {percent}%"), loop)
    try:
        options = {"outtmpl": str(folder / "%(title).80s.%(ext)s"), "format": "best[ext=mp4]/best", "noplaylist": True, "progress_hooks": [progress], "quiet": True}
        def fetch():
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(url, download=True)
                return Path(ydl.prepare_filename(info))
        path = await asyncio.to_thread(fetch)
        if not path.exists() or path.stat().st_size > MAX_BYTES:
            await status.edit_text("File is missing or larger than Telegram's 2GB limit.")
            return
        await status.edit_text("Uploading...")
        with path.open("rb") as handle:
            await update.message.reply_document(handle, caption="Downloaded by NEXUS")
    except Exception as exc:
        await status.edit_text(f"Download failed: {exc}")
    finally:
        shutil.rmtree(folder, ignore_errors=True)

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, download))
app.run_polling(allowed_updates=Update.ALL_TYPES)
