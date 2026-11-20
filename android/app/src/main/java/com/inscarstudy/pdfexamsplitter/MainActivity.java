package com.inscarstudy.pdfexamsplitter;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        IncomingPdfPlugin.rememberIntent(getIntent());
        registerPlugin(IncomingPdfPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        IncomingPdfPlugin.rememberIntent(intent);
        super.onNewIntent(intent);
    }
}
