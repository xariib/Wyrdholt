# Android signing and updates

The historical release APK uses application ID `com.emberbound.spike.c2dev`, release key alias `wyrdholt-release`, and certificate SHA-256 fingerprint `C3:54:20:1B:B4:B8:4A:D4:32:A1:1C:5A:85:77:1D:1B:0C:6B:DA:FF:31:E8:94:72:38:F6:F4:C9:A5:6F:3D:18`.

Before a signed release, check the package, signer, and version code against the last distributed APK. Verify the certificate with `apksigner verify --print-certs`. Reuse the existing signing key and start above the last distributed version code. Keep the keystore and passwords outside Git.

Use a separate test device or disposable test installation for debug builds. Verify the signed APK as an in-place update before release and check that the existing save loads afterward.

## In-game updates

On the release-signed Android build, go to Character → App updates. Check for an update, download it, and choose **Install update**. Wyrdholt saves before handing off to Android. If prompted, allow installs from Wyrdholt, confirm the update, then tap **Open** on Android's completion screen. The new app displays its installed version under App updates.

The updater reads the latest stable GitHub release in `xariib/Wyrdholt`. It checks the APK size, SHA-256, package ID, signer, Android compatibility, and version before opening the installer. The **Build signed Android APK** workflow runs manually on `main` and uploads the verified APK and checksum as an Actions artifact. Enable **Publish to GitHub Releases** when the build should appear in App updates. Set a version code greater than the last distributed APK, including builds published before the repository move. Configure the existing release key using the repository's `WYRDHOLT_KEYSTORE_BASE64`, `WYRDHOLT_KEYSTORE_PASSWORD`, `WYRDHOLT_KEY_ALIAS`, and `WYRDHOLT_KEY_PASSWORD` Actions secrets.

Install the first updater-enabled APK manually as an in-place update. To verify the updater, start from that build with an existing save, install a second higher-version release through App updates, then check **Open**, the installed version, and the retained save on the target device.
