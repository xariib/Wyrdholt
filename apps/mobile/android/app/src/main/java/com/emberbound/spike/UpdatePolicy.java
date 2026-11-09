// Adapted from the Lumenfall Android updater. See assets/licenses/lumenfall-updater.txt.
package com.emberbound.spike;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Shared, platform-independent trust and bounds checks. */
final class UpdatePolicy {
    static final String PACKAGE = "com.xariib.wyrdholt";
    static final String CERT = "fc4252be43679975154230c0a90dad8f1853dcef2f7530809d9fd2ecdbf3ea93";
    static final String RELEASES = "https://api.github.com/repos/xariib/Wyrdholt/releases/latest";
    private static final String DOWNLOADS = "https://github.com/xariib/Wyrdholt/releases/download/";
    static final String APK = "Wyrdholt-Idle.apk";
    static final String CHECKSUM = APK + ".sha256";
    static final String LATEST_APK = "https://github.com/xariib/Wyrdholt/releases/latest/download/" + APK;
    static final long MAX_APK = 256L * 1024 * 1024;

    private static final Pattern RELEASE_TAG = Pattern.compile(
        "android-v([0-9]+\\.[0-9]+\\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?)-([0-9]{1,10})");

    static Matcher releaseTag(String tag) {
        Matcher match = RELEASE_TAG.matcher(tag);
        if (!match.matches()) throw new IllegalArgumentException("Unsupported Android release version.");
        long code = Long.parseLong(match.group(2));
        if (code < 1 || code > 2100000000L) throw new IllegalArgumentException("Invalid release version.");
        return match;
    }

    static void trustedUrl(String value, boolean api) {
        URI u = URI.create(value);
        String host = u.getHost();
        if (!"https".equals(u.getScheme()) || u.getUserInfo() != null ||
            (u.getPort() != -1 && u.getPort() != 443) || u.getFragment() != null ||
            host == null || !(api ? "api.github.com".equals(host) :
            "github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) ||
            "objects.githubusercontent.com".equals(host)))
            throw new IllegalArgumentException("Untrusted update address.");
    }

    static void assetUrl(String value, String tag, String name) {
        trustedUrl(value, false);
        if (!value.equals(assetUrl(tag, name)))
            throw new IllegalArgumentException("Update asset is not from the official release.");
    }

    static String assetUrl(String tag, String name) {
        return DOWNLOADS + tag + "/" + name;
    }

    static String apkTag(String value) {
        String suffix = "/" + APK;
        int end = value.length() - suffix.length();
        if (end <= DOWNLOADS.length() || !value.startsWith(DOWNLOADS) || !value.endsWith(suffix))
            throw new IllegalArgumentException("Update asset is not from the official release.");
        String tag = value.substring(DOWNLOADS.length(), end);
        releaseTag(tag);
        return tag;
    }

    static void validateSize(long size) {
        if (size <= 0 || size > MAX_APK) throw new IllegalArgumentException("Invalid update size.");
    }

    static String checksum(String text) {
        String[] fields = text.trim().split("\\s+");
        if (fields.length != 2 || !fields[0].matches("[a-fA-F0-9]{64}") ||
            !(APK.equals(fields[1]) || ("*" + APK).equals(fields[1])))
            throw new IllegalArgumentException("Invalid release checksum.");
        return fields[0].toLowerCase(Locale.ROOT);
    }

    static void archive(String name, long code, String version, long installed, long expected, String expectedVersion, int sdk, int deviceSdk, String cert) {
        if (!PACKAGE.equals(name) || code != expected || code <= installed || !expectedVersion.equals(version) || sdk > deviceSdk || !CERT.equals(cert))
            throw new IllegalArgumentException("APK identity, version, compatibility or signing verification failed.");
    }
}
