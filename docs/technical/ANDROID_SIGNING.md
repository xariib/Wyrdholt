# Android signing and updates

The historical release APK uses application ID `com.emberbound.spike.c2dev`, release key alias `wyrdholt-release`, and certificate SHA-256 fingerprint `C3:54:20:1B:B4:B8:4A:D4:32:A1:1C:5A:85:77:1D:1B:0C:6B:DA:FF:31:E8:94:72:38:F6:F4:C9:A5:6F:3D:18`.

Before a signed release, check the package, signer, and version code against the last distributed APK. Verify the certificate with `apksigner verify --print-certs`. Reuse the existing signing key and start above the last distributed version code. Keep the keystore and passwords outside Git.

Use a separate test device or disposable test installation for debug builds. Verify the signed APK as an in-place update before release and check that the existing save loads afterward.
