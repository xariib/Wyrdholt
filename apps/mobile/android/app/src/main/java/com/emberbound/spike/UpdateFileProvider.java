package com.emberbound.spike;

import androidx.core.content.FileProvider;

/** Only the updater's cache directory is exposed to Android's installer. */
public class UpdateFileProvider extends FileProvider {}
