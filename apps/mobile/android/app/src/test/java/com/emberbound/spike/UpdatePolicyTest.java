package com.emberbound.spike;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class UpdatePolicyTest {
    private static final String APK = "Wyrdholt-Idle.apk";
    private static final String TAG = "android-v0.2.0-candidate.1-100008";

    @Test public void acceptsOfficialVersionAndAssets() {
        var release = UpdatePolicy.releaseTag(TAG);
        assertEquals("0.2.0-candidate.1", release.group(1));
        assertEquals("100008", release.group(2));
        UpdatePolicy.assetUrl("https://github.com/xariib/Wyrdholt/releases/download/" + TAG + "/" + APK, TAG, APK);
        UpdatePolicy.trustedUrl("https://release-assets.githubusercontent.com/blob?signature=test", false);
        UpdatePolicy.validateSize(UpdatePolicy.MAX_APK);
        assertEquals(UpdatePolicy.CERT, UpdatePolicy.checksum(UpdatePolicy.CERT + " *" + APK));
    }

    @Test public void rejectsWrongSourceChecksumAndVersion() {
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.releaseTag("android-v0.2.0-0"));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.releaseTag("android-v0.2.0-2100000001"));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.trustedUrl("http://github.com/update", false));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.trustedUrl("https://github.com.example.test/update", false));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.assetUrl("https://github.com/xariib/Lumenfall/releases/download/" + TAG + "/" + APK, TAG, APK));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.checksum(UpdatePolicy.CERT + " another.apk"));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.validateSize(UpdatePolicy.MAX_APK + 1));
    }

    @Test public void acceptsOnlyCompatibleNewerApkWithPinnedIdentity() {
        UpdatePolicy.archive(UpdatePolicy.PACKAGE, 100008, "0.2.0", 100007, 100008, "0.2.0", 24, 36, UpdatePolicy.CERT);
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.archive(
            UpdatePolicy.PACKAGE, 100008, "0.2.0", 100008, 100008, "0.2.0", 24, 36, UpdatePolicy.CERT));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.archive(
            UpdatePolicy.PACKAGE, 100008, "0.2.0", 100007, 100008, "0.2.1", 24, 36, UpdatePolicy.CERT));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.archive(
            UpdatePolicy.PACKAGE, 100008, "0.2.0", 100007, 100008, "0.2.0", 36, 35, UpdatePolicy.CERT));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.archive(
            UpdatePolicy.PACKAGE, 100008, "0.2.0", 100007, 100008, "0.2.0", 24, 36, "wrong"));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.archive(
            "com.other.app", 100008, "0.2.0", 100007, 100008, "0.2.0", 24, 36, UpdatePolicy.CERT));
    }
}
