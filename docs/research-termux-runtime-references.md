# Termux Runtime References

- Termux Wiki main page: https://wiki.termux.dev/wiki/Main_Page — identifies Termux:API as access to Android/Chrome hardware features and Termux:Boot as boot-script support.
- Termux:API Wiki: https://wiki.termux.com/wiki/Termux:API — documents the add-on API surface for command-line programs in Termux.
- Termux:Boot Wiki: https://wiki.termux.com/wiki/Termux:Boot — documents optional boot execution and the need to manage Android battery optimization deliberately.
- Android Developers, wake locks: https://developer.android.com/develop/background-work/background-tasks/awake/wakelock — describes acquiring/releasing wake locks and their best-practice constraints.

These references support NEXUS's local-first design: Android power/boot integration must remain explicit opt-in, observable, and releasable; it must not be enabled as a hidden background service.
