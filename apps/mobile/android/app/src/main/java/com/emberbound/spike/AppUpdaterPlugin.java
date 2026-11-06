// Adapted from the Lumenfall Android updater. See assets/licenses/lumenfall-updater.txt.
package com.emberbound.spike;

import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean downloading;
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    private SharedPreferences prefs() { return getContext().getSharedPreferences("app-updates", 0); }
    private File directory() throws IOException {
        // APKs are disposable cache, never player data or Android cloud-backup payloads.
        File dir = new File(getContext().getCacheDir(), "app-update");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot prepare update storage.");
        return dir;
    }
    private File apk() throws IOException { return new File(directory(), "update.apk"); }
    private long version(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private PackageInfo installed() throws PackageManager.NameNotFoundException {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signingFlags());
    }

    private String fingerprint(PackageInfo info) throws Exception {
        if (info == null) return "";
        Signature[] signers = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners())
            : info.signatures;
        if (signers == null || signers.length != 1) return "";
        return hex(MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray()));
    }

    private boolean supported(PackageInfo info) throws Exception {
        return UpdatePolicy.PACKAGE.equals(info.packageName) && UpdatePolicy.CERT.equals(fingerprint(info));
    }

    private PackageInfo requireSupported() throws Exception {
        PackageInfo info = installed();
        if (!supported(info)) throw new IOException("In-game updates require a Wyrdholt release-signed installation.");
        return info;
    }
    private JSONObject pending() throws Exception {
        String data = prefs().getString("release", null);
        return data == null ? null : new JSONObject(data);
    }
    private JSObject state() throws Exception {
        new File(directory(), "update.part.apk").delete(); // Discard an interrupted previous process's download.
        PackageInfo current = installed();
        JSONObject release = pending();
        if (release != null && release.getLong("code") <= version(current)) {
            prefs().edit().remove("release").remove("ready").apply();
            apk().delete();
            release = null;
        }
        JSObject result = new JSObject();
        result.put("currentVersion", current.versionName);
        result.put("supported", supported(current));
        result.put("published", !prefs().getBoolean("noRelease", false));
        result.put("available", release != null);
        result.put("ready", release != null && prefs().getString("ready", "").equals(release.toString()) && apk().isFile());
        if (release != null) {
            result.put("version", release.getString("version"));
            result.put("bytes", release.getLong("size"));
        }
        return result;
    }
    private interface Work { Runnable run() throws Exception; }
    private void run(PluginCall call, Work work) {
        run(call, false, work);
    }

    private void run(PluginCall call, boolean download, Work work) {
        if (!busy.compareAndSet(false, true)) { call.reject("An update operation is already running."); return; }
        cancelled = false;
        downloading = download;
        worker.execute(() -> {
            Runnable completion;
            try { completion = work.run(); }
            catch (Exception e) {
                String error = cancelled ? "Download cancelled." : message(e);
                completion = () -> call.reject(error);
            }
            finally {
                downloading = false;
                busy.set(false);
            }
            // Release the operation only after cleanup, before JS can request
            // installation/retry from the resolved or rejected promise.
            completion.run();
        });
    }
    private Runnable resolveState(PluginCall call) throws Exception {
        JSObject result = state();
        return () -> call.resolve(result);
    }
    private static class NoRelease extends IOException {}

    private String message(Exception e) {
        return e instanceof IllegalArgumentException || e instanceof IOException ? e.getMessage() :
            "The update could not be verified. Please try again.";
    }

    // Redirects are followed explicitly, keeping every hop HTTPS and on GitHub's asset hosts.
    private HttpURLConnection open(String address, boolean api) throws Exception {
        for (int redirects = 0; redirects < 6; redirects++) {
            UpdatePolicy.trustedUrl(address, api);
            HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
            connection = c;
            if (cancelled) {
                c.disconnect();
                throw new IOException("Download cancelled.");
            }
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent", "Wyrdholt-Android-Updater");
            c.setRequestProperty("Accept", api ? "application/vnd.github+json" : "application/octet-stream");
            c.setRequestProperty("Accept-Encoding", "identity");
            int status = c.getResponseCode();
            if (status >= 300 && status <= 399) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null) throw new IOException("Invalid update redirect.");
                address = new URL(new URL(address), location).toString();
                continue;
            }
            if (status != 200) {
                c.disconnect();
                if (api && status == 404) throw new NoRelease();
                throw new IOException(status == 403 || status == 429 ? "Update service is busy. Try again later." :
                    "Cannot reach the update service. Check your connection and try again.");
            }
            return c;
        }
        throw new IOException("Too many update redirects.");
    }
    private String text(String url, boolean api, int limit) throws Exception {
        long started = android.os.SystemClock.elapsedRealtime();
        HttpURLConnection c = open(url, api);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[8192]; int n;
            while ((n = in.read(bytes)) != -1) {
                if (android.os.SystemClock.elapsedRealtime() - started > 60000) throw new IOException("Update check timed out. Try again.");
                if (out.size() + n > limit) throw new IOException("Update information is too large.");
                out.write(bytes, 0, n);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        } finally { c.disconnect(); connection = null; }
    }

    @PluginMethod public void getState(PluginCall call) { run(call, () -> resolveState(call)); }

    @PluginMethod public void check(PluginCall call) {
        run(call, () -> {
            PackageInfo installed = requireSupported();
            JSONObject release;
            try {
                release = new JSONObject(text(UpdatePolicy.RELEASES, true, 1024 * 1024));
            } catch (NoRelease e) {
                prefs().edit().remove("release").remove("ready").putBoolean("noRelease", true).apply();
                apk().delete();
                return resolveState(call);
            }
            if (release.getBoolean("draft") || release.getBoolean("prerelease")) throw new IOException("No stable update is available.");
            String tag = release.getString("tag_name");
            Matcher version = UpdatePolicy.releaseTag(tag);
            long code = Long.parseLong(version.group(2));
            if (code <= version(installed)) {
                prefs().edit().remove("release").remove("ready").remove("noRelease").apply();
                apk().delete();
                return resolveState(call);
            }
            JSONArray assets = release.getJSONArray("assets");
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                if ("Wyrdholt-Idle.apk".equals(asset.getString("name"))) binary = asset;
                if ("Wyrdholt-Idle.apk.sha256".equals(asset.getString("name"))) checksum = asset;
            }
            if (binary == null || checksum == null) throw new IOException("This release is missing verified update files.");
            long size = binary.getLong("size"); UpdatePolicy.validateSize(size);
            String url = binary.getString("browser_download_url"), sumUrl = checksum.getString("browser_download_url");
            UpdatePolicy.assetUrl(url, tag, "Wyrdholt-Idle.apk");
            UpdatePolicy.assetUrl(sumUrl, tag, "Wyrdholt-Idle.apk.sha256");
            String hash = UpdatePolicy.checksum(text(sumUrl, false, 1024));
            JSONObject data = new JSONObject();
            data.put("code", code); data.put("version", version.group(1));
            data.put("size", size); data.put("sha256", hash); data.put("url", url);
            JSONObject old = pending();
            if (old == null || !old.toString().equals(data.toString())) {
                prefs().edit().remove("ready").apply(); apk().delete();
            }
            prefs().edit().putString("release", data.toString()).remove("noRelease").apply();
            return resolveState(call);
        });
    }

    private static String hex(byte[] value) {
        StringBuilder out = new StringBuilder();
        for (byte b : value) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    private void verify(File file, JSONObject release) throws Exception {
        if (file.length() != release.getLong("size")) throw new IOException("Update size verification failed. Download it again.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[65536]; int n;
            while ((n = in.read(bytes)) != -1) digest.update(bytes, 0, n);
        }
        if (!release.getString("sha256").equals(hex(digest.digest()))) throw new IOException("Update checksum verification failed. Download it again.");
        PackageManager pm = getContext().getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(file.getAbsolutePath(), signingFlags());
        if (info == null || info.applicationInfo == null) throw new IOException("Cannot verify the downloaded APK.");
        UpdatePolicy.archive(info.packageName, version(info), info.versionName, version(requireSupported()),
            release.getLong("code"), release.getString("version"), info.applicationInfo.minSdkVersion,
            Build.VERSION.SDK_INT, fingerprint(info));
    }

    @PluginMethod public void download(PluginCall call) {
        run(call, true, () -> {
            requireSupported();
            JSONObject release = pending();
            if (release == null) throw new IOException("Check for an update first.");
            File partial = new File(directory(), "update.part.apk");
            prefs().edit().remove("ready").apply(); apk().delete();
            long expected = release.getLong("size"); UpdatePolicy.validateSize(expected);
            if (directory().getUsableSpace() < expected * 2 + 10 * 1024 * 1024) throw new IOException("Not enough storage space for this update.");
            HttpURLConnection c = null;
            try {
                c = open(release.getString("url"), false);
                long advertised = c.getContentLength();
                if (advertised >= 0 && advertised != expected) throw new IOException("Update download size changed.");
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[65536]; long received = 0, lastEvent = 0, started = android.os.SystemClock.elapsedRealtime(); int n;
                    while ((n = in.read(buffer)) != -1) {
                        if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Download cancelled.");
                        if (android.os.SystemClock.elapsedRealtime() - started > 10 * 60 * 1000L) throw new IOException("Update download timed out. Try again.");
                        received += n;
                        if (received > expected) throw new IOException("Update is larger than expected.");
                        out.write(buffer, 0, n);
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - lastEvent > 250 || received == expected) {
                            JSObject progress = new JSObject(); progress.put("received", received); progress.put("total", expected);
                            notifyListeners("progress", progress); lastEvent = now;
                        }
                    }
                    out.getFD().sync();
                }
                if (cancelled) throw new IOException("Download cancelled.");
                verify(partial, release);
                if (cancelled) throw new IOException("Download cancelled.");
                if (!partial.renameTo(apk())) throw new IOException("Cannot save the verified update.");
                prefs().edit().putString("ready", release.toString()).commit();
                return resolveState(call);
            } finally {
                if (c != null) c.disconnect();
                connection = null;
                partial.delete();
            }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        if (downloading) {
            cancelled = true;
            HttpURLConnection c = connection;
            if (c != null) c.disconnect();
        }
        call.resolve();
    }

    @PluginMethod public void install(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("An update operation is already running."); return; }
        worker.execute(() -> {
            try {
                JSONObject release = pending();
                if (release == null || !prefs().getString("ready", "").equals(release.toString())) {
                    throw new IOException("Download the update first.");
                }
                try {
                    verify(apk(), release);
                } catch (Exception e) {
                    prefs().edit().remove("ready").apply();
                    apk().delete();
                    throw e;
                }
                getActivity().runOnUiThread(() -> launchInstaller(call, true));
            } catch (Exception e) {
                failInstall(call, message(e));
            }
        });
    }

    private void launchInstaller(PluginCall call, boolean canAskPermission) {
        try {
            if (getActivity().isFinishing() || getActivity().isDestroyed()) {
                failInstall(call, "Open Wyrdholt and try installing again.");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                if (!canAskPermission) {
                    failInstall(call, "Allow installs from Wyrdholt in Android settings, then try again.");
                    return;
                }
                Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + UpdatePolicy.PACKAGE));
                startActivityForResult(call, permission, "installPermissionResult");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), UpdatePolicy.PACKAGE + ".updates", apk());
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Wyrdholt update", uri));
            // Keep the system success screen, including its Open button.
            startActivityForResult(call, intent, "installerClosed");
        } catch (Exception e) {
            failInstall(call, "Could not open the Android installer. Try again from App updates.");
        }
    }

    private void failInstall(PluginCall call, String error) {
        busy.set(false);
        call.reject(error);
    }

    @ActivityCallback private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) busy.set(false);
        else launchInstaller(call, false);
    }

    @ActivityCallback private void installerClosed(PluginCall call, ActivityResult result) {
        // On a successful replacement Android can terminate this process. The
        // new process reads its installed version directly from PackageManager.
        busy.set(false);
        if (call != null) call.resolve();
    }

    @Override protected void handleOnDestroy() {
        cancelled = true;
        HttpURLConnection c = connection; if (c != null) c.disconnect();
        worker.shutdownNow();
    }
}
