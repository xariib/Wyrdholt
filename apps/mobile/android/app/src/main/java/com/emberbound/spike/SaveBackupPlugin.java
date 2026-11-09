package com.emberbound.spike;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
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
    @PluginMethod public void exportFile(PluginCall call) {
        String filename = call.getString("filename", "");
        String text = call.getString("text", "");
        if (text.isEmpty() || !filename.matches("Wyrdholt-Backup-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.json")) {
            call.reject("The backup could not be prepared.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(call, intent, "documentSelected"); }
        catch (ActivityNotFoundException e) { call.reject("Android could not open a folder picker."); }
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
            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("No backup output stream.");
                output.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            } catch (IOException | SecurityException error) {
                call.reject("The backup could not be written to that location.");
                return;
            }
            call.resolve(new JSObject().put("saved", true));
        });
    }
}
