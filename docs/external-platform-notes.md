# External Platform Notes

The implementation research consulted these official sources:

- Termux documentation: https://termux.dev/en/docs/
  - Termux is an Android terminal emulator and Linux environment. The official documentation notes that its documentation is still being expanded and points to the Termux wiki as the primary documentation source.
- Termux:API repository: https://github.com/termux/termux-api
  - Termux:API is an Android add-on exposing Android functions to command-line scripts and programs; device integration requires the companion add-on where applicable.
- Android Gradle build overview: https://developer.android.com/build/gradle-build-overview
  - Android projects can be built from the command line using Gradle tasks.
- Android command-line testing: https://developer.android.com/studio/test/command-line
  - The Android Gradle plugin supports running tests from the command line, including Gradle test tasks.

These sources support a capability-detection design: Termux and APK workers must detect available packages, Gradle/Android SDK/ADB/emulator capabilities, and add-on availability rather than assuming every Android device can run emulator or instrumentation tests.
