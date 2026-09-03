# Termux Keyboard Setup Sources

The `nexus setup termux` implementation uses the documented `~/.termux/termux.properties` format and the official Termux extra-key examples. The generated NEXUS-managed block preserves all user content outside its own markers, adds the documented `KEYBOARD` special key, and adds the officially supported `PASTE` special key.

- [Termux properties template](https://raw.githubusercontent.com/termux/termux-tools/master/termux.properties) — documents `extra-keys`, `KEYBOARD`, the keyboard-toggle behavior, reload guidance, and relevant terminal settings.
- [Termux Terminal Settings wiki](https://wiki.termux.com/wiki/Terminal_Settings) — documents the properties file and configuration reload/restart guidance.
- [Termux ExtraKeys constants](https://github.com/termux/termux-app/blob/master/termux-shared/src/main/java/com/termux/shared/termux/extrakeys/ExtraKeysConstants.java) — defines the `KEYBOARD` and `PASTE` special-key labels used by the generated configuration.
