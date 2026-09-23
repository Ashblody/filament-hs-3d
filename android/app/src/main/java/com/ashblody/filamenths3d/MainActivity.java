package com.ashblody.filamenths3d;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenPrintTagNfcPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
