#!/data/data/com.termux/files/usr/bin/bash
set -eu
pkg update -y
pkg install -y python
python -m pip install --upgrade --no-cache-dir python-telegram-bot requests
