# Build and deploy

Use the npm workspaces from the repository root. [README](../../README.md) lists the clean-install, build, and save checks. The built browser game lives in `apps/mobile/dist` and uses relative asset URLs. Serve it with `npm run preview:web` or use a static HTTPS host.

## Android

The imported Android project uses JDK 21 and Android SDK platform 36. Install build-tools 35.0.0 and 36.0.0 and use the checked-in Gradle wrapper.

```sh
npm run build:web
cd apps/mobile
npx cap sync android
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`. Set `ANDROID_HOME` or point the local, ignored `local.properties` to the SDK. The debug APK is under `apps/mobile/android/app/build/outputs/apk/debug/`.

A signed update must use the installed app's package ID and signing certificate, and its version code must exceed the last distributed APK's. See [Android signing](ANDROID_SIGNING.md). Validate the signed update and save preservation on a physical device before distributing it. Keep signing secrets outside Git.

The signed APK workflow also accepts a committed release request: change `.github/android-release.json` on `main` with a new `versionName`, a strictly increasing `versionCode`, and `publishRelease`. Only changes to that file trigger an automatic Android build. Manual workflow dispatch remains available. Both paths run the same tests and verify the existing signing certificate before publishing. Publishing exposes the update through Menu → App updates.

## iOS

On macOS with Xcode, build the web app, then run `npx cap sync ios` and `npx cap open ios` from `apps/mobile`. The imported Xcode project uses Swift Package Manager.
