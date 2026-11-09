package com.emberbound.spike;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // BridgeActivity switches from the launch theme to AppTheme.NoActionBar inside super.onCreate()
        // and then creates the window content. EdgeToEdge.enable() touches the window decor, so it must
        // run AFTER that switch. Calling it earlier builds the decor from the launch theme, which on
        // Android 12+ has a title bar and the splash drawable as background (device finding F1).
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(SaveBackupPlugin.class);
        super.onCreate(savedInstanceState);
        // Draw edge to edge; Capacitor SystemBars (insetsHandling "css") provides --safe-area-inset-* to the web layer.
        EdgeToEdge.enable(this);
    }
}
