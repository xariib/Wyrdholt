# Android signing and updates

The current Android release uses application ID `com.xariib.wyrdholt`, release key alias `wyrdholt-release`, and certificate SHA-256 fingerprint `FC:42:52:BE:43:67:99:75:15:42:30:C0:A9:0D:AD:8F:18:53:DC:EF:2F:75:30:80:9D:9F:D2:EC:DB:F3:EA:93`.

The first release starts at version code 1 and installs separately from the historical package `com.emberbound.spike.c2dev`. Before later releases, check the package, signer, and version code against the last APK for `com.xariib.wyrdholt`. Verify the certificate with `apksigner verify --print-certs`. Keep the PKCS#12 keystore and passwords outside Git.

Use a separate test device or disposable test installation for debug builds. Verify the signed APK as an in-place update before release and check that the existing save loads afterward.

## In-game updates

Install the [latest signed APK](https://github.com/xariib/Wyrdholt/releases/latest/download/Wyrdholt-Idle.apk) for the first setup. Wyrdholt checks for updates when you start playing, when you return to the app, and while the game is open. Automatic checks are at least 30 minutes apart. Tap **View update** on the **Update available** notice or check manually under **Character → App updates**.

Download the update and choose **Install update**. Wyrdholt saves before handing off to Android. If prompted, allow installs from Wyrdholt, confirm the update, then tap **Open** on Android's completion screen. The new app displays its installed version under App updates.

The updater reads the latest stable GitHub release in `xariib/Wyrdholt`. It checks the APK size, SHA-256, package ID, signer, Android compatibility, and version before opening the installer. The **Build signed Android APK** workflow runs manually on `main` and uploads the verified APK and checksum as an Actions artifact. Enable **Publish to GitHub Releases** when the build should appear in App updates. The workflow reads the repository's `WYRDHOLT_KEYSTORE_BASE64`, `WYRDHOLT_KEYSTORE_PASSWORD`, `WYRDHOLT_KEY_ALIAS`, and `WYRDHOLT_KEY_PASSWORD` Actions secrets.

Install the first updater-enabled APK manually and create a character. To verify the updater, install a second higher-version release through App updates, then check **Open**, the installed version, and the retained save on the target device.
