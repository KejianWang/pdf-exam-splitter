package com.inscarstudy.pdfexamsplitter;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;

@CapacitorPlugin(name = "IncomingPdf")
public class IncomingPdfPlugin extends Plugin {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final long MAX_PDF_BYTES = 100L * 1024L * 1024L;
    private static Intent rememberedIntent;

    private Intent pendingIntent;

    public static synchronized void rememberIntent(Intent intent) {
        if (isSupportedIntent(intent)) {
            rememberedIntent = intent;
        }
    }

    private static synchronized Intent consumeRememberedIntent() {
        Intent intent = rememberedIntent;
        rememberedIntent = null;
        return intent;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (!isSupportedIntent(intent)) {
            return;
        }
        pendingIntent = intent;
        rememberIntent(intent);
        JSObject payload = new JSObject();
        payload.put("available", true);
        notifyListeners("incomingPdf", payload, true);
    }

    @PluginMethod
    public void getPendingFile(PluginCall call) {
        Intent intent = pendingIntent;
        pendingIntent = null;
        Intent remembered = consumeRememberedIntent();
        if (intent == null) {
            intent = remembered;
        }

        if (intent == null) {
            JSObject empty = new JSObject();
            empty.put("available", false);
            call.resolve(empty);
            return;
        }

        Uri uri = extractFirstUri(intent);
        if (uri == null) {
            JSObject empty = new JSObject();
            empty.put("available", false);
            call.resolve(empty);
            return;
        }

        getBridge().execute(() -> {
            try {
                JSObject file = readPdfUri(uri);
                call.resolve(file);
            } catch (Exception ex) {
                call.reject("无法读取传入的PDF，请先保存到手机后再从应用内选择。", ex);
            }
        });
    }

    @PluginMethod
    public void hasPendingFile(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", pendingIntent != null || rememberedIntent != null);
        call.resolve(result);
    }

    private static boolean isSupportedIntent(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action)
            && !Intent.ACTION_SEND.equals(action)
            && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return false;
        }

        // Some apps, including some WeChat/Honor builds, hand over a PDF content Uri without
        // a reliable MIME type or DISPLAY_NAME. If a supported action contains a Uri, accept it
        // and let the web layer validate that the bytes are really a PDF.
        return extractFirstUri(intent) != null;
    }

    @SuppressWarnings({"deprecation", "unchecked"})
    private static Uri extractFirstUri(Intent intent) {
        if (intent == null) return null;

        Uri data = intent.getData();
        if (data != null) return data;

        Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream != null) return stream;

        ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (uris != null && !uris.isEmpty()) return uris.get(0);

        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                Uri uri = clipData.getItemAt(i).getUri();
                if (uri != null) return uri;
            }
        }

        String dataString = intent.getDataString();
        if (dataString != null && !dataString.trim().isEmpty()) return Uri.parse(dataString);

        return null;
    }

    private JSObject readPdfUri(Uri uri) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        String mimeType = resolver.getType(uri);
        if (mimeType == null || mimeType.trim().isEmpty()) mimeType = "application/pdf";

        String name = getDisplayName(uri);
        if (name == null || name.trim().isEmpty()) name = getFallbackFileName(uri);
        if (name == null || name.trim().isEmpty()) name = "shared.pdf";
        if (!name.toLowerCase().endsWith(".pdf")) name = name + ".pdf";

        byte[] bytes = readAllBytesWithLimit(resolver, uri);
        String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

        JSObject payload = new JSObject();
        payload.put("available", true);
        payload.put("name", name);
        payload.put("mimeType", mimeType);
        payload.put("size", bytes.length);
        payload.put("data", base64);
        return payload;
    }

    private byte[] readAllBytesWithLimit(ContentResolver resolver, Uri uri) throws IOException {
        try (InputStream input = resolver.openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("Cannot open shared PDF stream.");
            byte[] buffer = new byte[BUFFER_SIZE];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PDF_BYTES) {
                    throw new IOException("PDF is larger than 100MB.");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private String getDisplayName(Uri uri) {
        if (uri == null) return null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) return cursor.getString(index);
                }
            } catch (Exception ignored) {
                // Some providers do not expose OpenableColumns; fall back to URI path below.
            }
        }
        return getFallbackFileName(uri);
    }

    private String getFallbackFileName(Uri uri) {
        String candidate = uri.getLastPathSegment();
        if (candidate == null || candidate.trim().isEmpty()) return "shared.pdf";
        int slash = Math.max(candidate.lastIndexOf('/'), candidate.lastIndexOf('\\'));
        if (slash >= 0 && slash + 1 < candidate.length()) candidate = candidate.substring(slash + 1);
        int colon = candidate.lastIndexOf(':');
        if (colon >= 0 && colon + 1 < candidate.length()) candidate = candidate.substring(colon + 1);
        return candidate;
    }
}
