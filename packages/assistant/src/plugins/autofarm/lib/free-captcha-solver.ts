// free-captcha-solver: last-resort fallback for when playwright-stealth
// fails and the user actually hits a captcha. The most reliable free
// technique is the audio-challenge route:
//
//   1. reCAPTCHA exposes a headphone icon. Click it.
//   2. A short MP3 of garbled numbers is downloaded.
//   3. We fetch the MP3, transcribe it with the FREE
//      speech_recognition Python package (uses Google's free
//      endpoint, no API key needed), and submit the digits back
//      into the answer field.
//
// Why audio instead of image:
//   - Image captchas (reCAPTCHA v2 "select all squares with…") are
//     adversarial: no free solver beats them reliably. Audio is
//     simpler (digits, predictable vocabulary) and Google itself
//     ships a speech_recognition tutorial using its own audio
//     challenge as the demo, so we know the round-trip is feasible.
//   - We only attempt this when the user already has Python +
//     browser-use installed. No extra dependency.
//
// Cross-platform: pure fetch + optional Python subprocess for
// transcription. Works on Termux, Linux, macOS, Windows.

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** Free digit-by-digit transcription of an audio URL. */
export async function transcribeAudio(audioUrl: string, opts: { python?: string; timeoutMs?: number } = {}): Promise<string | undefined> {
  const py = opts.python ?? (process.env.PYTHON ?? "python3")
  const timeoutMs = opts.timeoutMs ?? 20_000
  const script = `
import sys, json, urllib.request, io
try:
    import speech_recognition as sr
except ImportError:
    print(json.dumps({"err": "speech_recognition not installed"}))
    sys.exit(0)
raw = urllib.request.urlopen("${audioUrl.replace(/"/g, '\\"')}", timeout=15).read()
rec = sr.Recognizer()
src = sr.AudioFile(io.BytesIO(raw))
with src as f:
    audio = rec.record(f)
try:
    text = rec.recognize_google(audio)
    print(json.dumps({"text": text}))
except Exception as e:
    print(json.dumps({"err": str(e)}))
`
  try {
    const { stdout } = await execFileAsync(py, ["-c", script], { timeout: timeoutMs })
    const j = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as { text?: string; err?: string }
    if (j.text) {
      // Audio captchas want digits only. Strip everything else.
      return j.text.replace(/\D+/g, "")
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Try to solve a reCAPTCHA v2 audio challenge end-to-end. Returns
 * the digits string the user (or browser-use) can type into the
 * answer field, or undefined if anything in the chain fails.
 *
 * Required: pip install SpeechRecognition pydub
 * (apt package: `pkg install python python-pip` on Termux).
 */
export async function solveAudioCaptcha(audioUrl: string): Promise<string | undefined> {
  return transcribeAudio(audioUrl)
}
