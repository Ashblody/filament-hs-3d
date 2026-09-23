package com.ashblody.filamenths3d;

import android.app.Activity;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NfcV;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * Read-only OpenPrintTag (ISO 15693 / NFC-V, ICODE SLIX2) bridge.
 * Prefer Android Ndef tech; fall back to raw NfcV block reads + Type-5 NDEF TLV parse.
 * Write intentionally omitted — Prusa factory tags may be write-protected / passworded.
 */
@CapacitorPlugin(name = "OpenPrintTagNfc")
public class OpenPrintTagNfcPlugin extends Plugin {
    private static final String TAG = "OpenPrintTagNfc";
    private static final String OPT_MIME = "application/vnd.openprinttag";
    private static final String OPT_MIME_LEGACY = "application/vnd.prusa3d.nfc";

    private PluginCall pendingCall;
    private Handler timeoutHandler;
    private Runnable timeoutRunnable;
    private boolean readerEnabled = false;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Activity activity = getActivity();
        NfcAdapter adapter = activity != null ? NfcAdapter.getDefaultAdapter(activity) : null;
        JSObject ret = new JSObject();
        ret.put("available", adapter != null);
        ret.put("nfcEnabled", adapter != null && adapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        stopReader();
        if (pendingCall != null) {
            pendingCall.reject("Prekinjeno");
            pendingCall = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void scan(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Ni aktivnosti");
            return;
        }
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(activity);
        if (adapter == null) {
            call.reject("Ta naprava nima NFC.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("NFC je izklopljen. Vklopi NFC v nastavitvah.");
            return;
        }

        // Replace previous pending scan
        if (pendingCall != null) {
            pendingCall.reject("Novi scan");
            pendingCall = null;
        }
        pendingCall = call;
        call.setKeepAlive(true);

        int timeoutMs = call.getInt("timeoutMs", 30000);
        if (timeoutMs < 5000) timeoutMs = 5000;
        if (timeoutMs > 120000) timeoutMs = 120000;

        stopReader();
        readerEnabled = true;
        adapter.enableReaderMode(
            activity,
            this::onTagDiscovered,
            NfcAdapter.FLAG_READER_NFC_V
                | NfcAdapter.FLAG_READER_NFC_A
                | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
            null
        );

        timeoutHandler = new Handler(Looper.getMainLooper());
        final PluginCall callRef = call;
        timeoutRunnable = () -> {
            if (pendingCall == callRef) {
                stopReader();
                pendingCall = null;
                callRef.reject("Ni oznake v času. Približaj Prusament / OpenPrintTag (SLIX2) in poskusi znova.");
            }
        };
        timeoutHandler.postDelayed(timeoutRunnable, timeoutMs);
    }

    private void onTagDiscovered(Tag tag) {
        if (pendingCall == null) return;
        PluginCall call = pendingCall;
        try {
            OptPayload payload = extractOpenPrintTag(tag);
            if (payload == null) {
                // Keep scanning — wrong tag type / empty
                Log.w(TAG, "Tag found but no OpenPrintTag payload");
                return;
            }
            stopReader();
            pendingCall = null;

            JSObject ret = new JSObject();
            ret.put("uidHex", bytesToHex(tag.getId()));
            ret.put("payloadBase64", Base64.encodeToString(payload.bytes, Base64.NO_WRAP));
            ret.put("mimeType", payload.mimeType);
            ret.put("tech", payload.tech);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "scan failed", e);
            stopReader();
            pendingCall = null;
            call.reject("Napaka branja: " + e.getMessage());
        }
    }

    private void stopReader() {
        if (timeoutHandler != null && timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }
        timeoutRunnable = null;
        Activity activity = getActivity();
        if (readerEnabled && activity != null) {
            NfcAdapter adapter = NfcAdapter.getDefaultAdapter(activity);
            if (adapter != null) {
                try {
                    adapter.disableReaderMode(activity);
                } catch (Exception ignored) {}
            }
        }
        readerEnabled = false;
    }

    @Override
    protected void handleOnDestroy() {
        stopReader();
        super.handleOnDestroy();
    }

    private static class OptPayload {
        final byte[] bytes;
        final String mimeType;
        final String tech;
        OptPayload(byte[] bytes, String mimeType, String tech) {
            this.bytes = bytes;
            this.mimeType = mimeType;
            this.tech = tech;
        }
    }

    private OptPayload extractOpenPrintTag(Tag tag) throws IOException {
        // 1) Prefer NDEF tech (works when Type-5 is NDEF-formatted and Android exposes it)
        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            try {
                ndef.connect();
                NdefMessage msg = ndef.getNdefMessage();
                if (msg == null) msg = ndef.getCachedNdefMessage();
                OptPayload fromNdef = fromNdefMessage(msg, "Ndef");
                if (fromNdef != null) return fromNdef;
            } catch (Exception e) {
                Log.w(TAG, "Ndef path failed: " + e.getMessage());
            } finally {
                try { ndef.close(); } catch (Exception ignored) {}
            }
        }

        // 2) Raw NFC-V block dump + Type 5 TLV / NDEF parse
        NfcV nfcV = NfcV.get(tag);
        if (nfcV == null) {
            return null;
        }
        try {
            nfcV.connect();
            byte[] memory = readAllBlocks(nfcV, tag.getId());
            OptPayload fromRaw = parseType5Memory(memory);
            if (fromRaw != null) return fromRaw;
            // Last resort: scan whole memory for MIME ASCII and NDEF-ish structure
            return findOptPayloadInBytes(memory, "NfcV-scan");
        } finally {
            try { nfcV.close(); } catch (Exception ignored) {}
        }
    }

    private OptPayload fromNdefMessage(NdefMessage msg, String tech) {
        if (msg == null) return null;
        for (NdefRecord rec : msg.getRecords()) {
            String type = new String(rec.getType(), StandardCharsets.UTF_8).toLowerCase(Locale.US);
            if (OPT_MIME.equals(type) || OPT_MIME_LEGACY.equals(type)
                    || (rec.getTnf() == NdefRecord.TNF_MIME_MEDIA
                        && (type.contains("openprinttag") || type.contains("prusa3d.nfc")))) {
                byte[] payload = rec.getPayload();
                if (payload != null && payload.length > 0) {
                    return new OptPayload(payload, type, tech);
                }
            }
        }
        return null;
    }

    /** Read SLIX2 / ISO15693 user memory (up to ~80 blocks × 4 B). */
    private byte[] readAllBlocks(NfcV nfcV, byte[] uid) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int maxBlocks = 80;
        // Try Read Multiple Blocks first (cmd 0x23)
        try {
            byte[] multi = tryReadMultiple(nfcV, uid, 0, maxBlocks);
            if (multi != null && multi.length >= 16) return multi;
        } catch (Exception e) {
            Log.d(TAG, "Read Multiple failed, falling back to single: " + e.getMessage());
        }

        for (int block = 0; block < maxBlocks; block++) {
            byte[] data = readSingleBlock(nfcV, uid, block);
            if (data == null) break;
            out.write(data);
            // Stop early if we already saw terminator after some NDEF and have enough
            if (block > 8 && out.size() > 64) {
                byte[] soFar = out.toByteArray();
                if (containsTerminatorAfterNdef(soFar)) {
                    // still continue a bit for safety — aux may be later
                }
            }
        }
        return out.toByteArray();
    }

    private boolean containsTerminatorAfterNdef(byte[] mem) {
        for (byte b : mem) {
            if (b == (byte) 0xFE) return true;
        }
        return false;
    }

    private byte[] tryReadMultiple(NfcV nfcV, byte[] uid, int start, int count) throws IOException {
        // ISO 15693 Read Multiple Blocks: flags, 0x23, UID(8), first block, number of blocks-1
        byte[] cmd = new byte[2 + uid.length + 2];
        cmd[0] = 0x20; // addressed
        cmd[1] = 0x23;
        System.arraycopy(uid, 0, cmd, 2, uid.length);
        cmd[2 + uid.length] = (byte) start;
        cmd[3 + uid.length] = (byte) (count - 1);
        byte[] resp = nfcV.transceive(cmd);
        if (resp == null || resp.length < 2) return null;
        if ((resp[0] & 0x01) != 0) return null; // error flag
        return Arrays.copyOfRange(resp, 1, resp.length);
    }

    private byte[] readSingleBlock(NfcV nfcV, byte[] uid, int block) throws IOException {
        // flags 0x20 addressed, cmd 0x20 Read Single Block
        byte[] cmd = new byte[2 + uid.length + 1];
        cmd[0] = 0x20;
        cmd[1] = 0x20;
        System.arraycopy(uid, 0, cmd, 2, uid.length);
        cmd[2 + uid.length] = (byte) block;
        byte[] resp;
        try {
            resp = nfcV.transceive(cmd);
        } catch (IOException e) {
            // Retry with high data rate flag
            cmd[0] = 0x22;
            try {
                resp = nfcV.transceive(cmd);
            } catch (IOException e2) {
                return null;
            }
        }
        if (resp == null || resp.length < 2) return null;
        if ((resp[0] & 0x01) != 0) return null;
        // Response: flags + 4 data bytes (block size may vary; take rest)
        return Arrays.copyOfRange(resp, 1, resp.length);
    }

    /**
     * Parse NFC Forum Type 5 Tag memory: CC + TLVs → NDEF → OPT MIME payload.
     */
    private OptPayload parseType5Memory(byte[] memory) {
        if (memory == null || memory.length < 8) return null;

        int offset = 0;
        // Capability Container
        if ((memory[0] & 0xFF) == 0xE1) {
            // Standard 4-byte CC
            offset = 4;
            // Extended CC? If version indicates — keep simple: always 4 for SLIX2
        } else {
            // Some dumps start with TLV without exposing CC in first byte of our read —
            // try from 0
            offset = 0;
        }

        while (offset < memory.length) {
            int tlvType = memory[offset] & 0xFF;
            if (tlvType == 0x00) { // NULL
                offset++;
                continue;
            }
            if (tlvType == 0xFE) { // Terminator
                break;
            }
            offset++;
            if (offset >= memory.length) break;

            int lenByte = memory[offset] & 0xFF;
            offset++;
            int length;
            if (lenByte == 0xFF) {
                if (offset + 1 >= memory.length) break;
                length = ((memory[offset] & 0xFF) << 8) | (memory[offset + 1] & 0xFF);
                offset += 2;
            } else {
                length = lenByte;
            }
            if (offset + length > memory.length) {
                length = memory.length - offset;
            }

            if (tlvType == 0x03) { // NDEF Message
                byte[] ndefBytes = Arrays.copyOfRange(memory, offset, offset + length);
                OptPayload p = parseNdefBytes(ndefBytes, "NfcV-TLV");
                if (p != null) return p;
            }
            offset += length;
        }
        return null;
    }

    private OptPayload parseNdefBytes(byte[] data, String tech) {
        int offset = 0;
        while (offset < data.length) {
            if (offset + 2 > data.length) break;
            int flags = data[offset] & 0xFF;
            int tnf = flags & 0x07;
            boolean sr = (flags & 0x10) != 0;
            boolean il = (flags & 0x08) != 0;
            offset++;

            int typeLen = data[offset++] & 0xFF;
            int payloadLen;
            if (sr) {
                if (offset >= data.length) break;
                payloadLen = data[offset++] & 0xFF;
            } else {
                if (offset + 4 > data.length) break;
                payloadLen = ((data[offset] & 0xFF) << 24)
                        | ((data[offset + 1] & 0xFF) << 16)
                        | ((data[offset + 2] & 0xFF) << 8)
                        | (data[offset + 3] & 0xFF);
                offset += 4;
            }
            int idLen = 0;
            if (il) {
                if (offset >= data.length) break;
                idLen = data[offset++] & 0xFF;
            }
            if (offset + typeLen + idLen + payloadLen > data.length) break;

            String type = new String(data, offset, typeLen, StandardCharsets.UTF_8);
            offset += typeLen;
            offset += idLen;

            byte[] payload = Arrays.copyOfRange(data, offset, offset + payloadLen);
            offset += payloadLen;

            String typeLower = type.toLowerCase(Locale.US);
            if (tnf == NdefRecord.TNF_MIME_MEDIA
                    && (OPT_MIME.equals(typeLower)
                        || OPT_MIME_LEGACY.equals(typeLower)
                        || typeLower.contains("openprinttag")
                        || typeLower.contains("prusa3d.nfc"))) {
                return new OptPayload(payload, typeLower, tech);
            }

            // Message End
            if ((flags & 0x40) != 0) break;
        }
        return null;
    }

    private OptPayload findOptPayloadInBytes(byte[] memory, String tech) {
        byte[] needle = OPT_MIME.getBytes(StandardCharsets.US_ASCII);
        int idx = indexOf(memory, needle);
        if (idx < 0) {
            needle = OPT_MIME_LEGACY.getBytes(StandardCharsets.US_ASCII);
            idx = indexOf(memory, needle);
        }
        if (idx < 0) return null;
        // Heuristic: MIME type sits in NDEF type field; payload follows type (+ optional id)
        int payloadStart = idx + needle.length;
        if (payloadStart >= memory.length) return null;
        // Take remaining until we hit lots of zeros or end — CBOR maps are self-delimiting;
        // JS decoder only needs from meta start. Give it everything after MIME.
        byte[] payload = Arrays.copyOfRange(memory, payloadStart, memory.length);
        // Trim trailing zeros
        int end = payload.length;
        while (end > 0 && payload[end - 1] == 0) end--;
        if (end < 8) return null;
        return new OptPayload(Arrays.copyOf(payload, end), OPT_MIME, tech);
    }

    private static int indexOf(byte[] data, byte[] pattern) {
        outer:
        for (int i = 0; i <= data.length - pattern.length; i++) {
            for (int j = 0; j < pattern.length; j++) {
                if (data[i + j] != pattern[j]) continue outer;
            }
            return i;
        }
        return -1;
    }

    private static String bytesToHex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02X", b));
        }
        return sb.toString();
    }
}
