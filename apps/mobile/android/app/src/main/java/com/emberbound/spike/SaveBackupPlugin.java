package com.emberbound.spike;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "SaveBackup")
public class SaveBackupPlugin extends Plugin {
    private static final String MIME_TYPE = "application/json";

    @PluginMethod public void exportFile(PluginCall call) {
        String filename = call.getString("filename", "");
        String text = call.getString("text", "");
        if (text.isEmpty() || !filename.matches("Wyrdholt-Backup-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.json")) {
            call.reject("The backup could not be prepared.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToDownloads(call, filename, text);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(MIME_TYPE);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(call, intent, "documentSelected"); }
        catch (ActivityNotFoundException e) { call.reject("Android could not open a folder picker."); }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private void saveToDownloads(PluginCall call, String filename, String text) {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues entry = new ContentValues();
        entry.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        entry.put(MediaStore.MediaColumns.MIME_TYPE, MIME_TYPE);
        entry.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Wyrdholt");
        entry.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri destination = null;
        try {
            destination = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), entry);
            if (destination == null) throw new IOException("No backup destination.");
            writeBackup(resolver, destination, text);
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(destination, ready, null, null) != 1) throw new IOException("Backup could not be published.");
        } catch (IOException | RuntimeException error) {
            if (destination != null) {
                try { resolver.delete(destination, null, null); }
                catch (RuntimeException ignored) { /* The failed entry is still pending. */ }
            }
            call.reject("The backup could not be written to Downloads.");
            return;
        }
        call.resolve(new JSObject().put("saved", true).put("downloads", true));
    }

    private static void writeBackup(ContentResolver resolver, Uri destination, String text) throws IOException {
        try (OutputStream output = resolver.openOutputStream(destination, "w")) {
            if (output == null) throw new IOException("No backup output stream.");
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    @ActivityCallback private void documentSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null || !"content".equals(destination.getScheme())) {
            call.reject("Android did not provide a backup location.");
            return;
        }
        getBridge().execute(() -> {
            try {
                writeBackup(getContext().getContentResolver(), destination, call.getString("text", ""));
            } catch (IOException | SecurityException error) {
                call.reject("The backup could not be written to that location.");
                return;
            }
            call.resolve(new JSObject().put("saved", true));
        });
    }
}
