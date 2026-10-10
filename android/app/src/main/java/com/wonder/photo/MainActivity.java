package com.wonder.photo;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.view.ViewGroup;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView web;
    private Library library;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String pendingPicker;
    private String pendingPermission;
    private static final String HOME = "file:///android_asset/index.html";

    // JavaScript is restricted to bundled assets: CSP, no network permission, no external navigation.
    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        library = new Library(getApplicationContext());
        web = new WebView(this);
        web.setBackgroundColor(0xff13171c);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !HOME.equals(request.getUrl().toString()); }
        });
        web.addJavascriptInterface(new Bridge(), "Native");
        FrameLayout frame=new FrameLayout(this);
        frame.setBackgroundColor(0xff13171c);
        frame.addView(web,new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            // Target 35 is edge-to-edge; keep controls clear of system bars and keyboard.
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(frame);
        web.loadUrl(HOME);
        if (state != null) {
            pendingPicker = state.getString("picker");
            pendingPermission = state.getString("permission");
        }
    }

    private void reply(String id, Object value, String error) {
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            web.evaluateJavascript("window.receive(" + JSONObject.quote(id) + "," +
                    (value == null ? "null" : value.toString()) + "," +
                    (error == null ? "null" : JSONObject.quote(error)) + ")", null);
        });
    }
    private void execute(String id, String action, JSONObject args) {
        worker.execute(() -> {
            try { reply(id, library.call(action, args), null); }
            catch (Exception error) { reply(id, null, error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()); }
        });
    }
    private final class Bridge {
        @JavascriptInterface public void request(String id, String action, String text) {
            if (!id.matches("[0-9]{1,12}") || text.length() > 65536) return;
            try {
                JSONObject args = new JSONObject(text);
                if (action.equals("pick")) {
                    runOnUiThread(() -> {
                        if (pendingPicker != null) { reply(id,null,"相册选择正在进行"); return; }
                        pendingPicker = id;
                        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*")
                                .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                        try { startActivityForResult(intent,1); }
                        catch (Exception error) { pendingPicker=null; reply(id,null,"此设备没有可用的相册选择器"); }
                    });
                } else if (action.equals("scan")) {
                    runOnUiThread(() -> {
                        if (pendingPermission != null) { reply(id,null,"相册授权正在进行"); return; }
                        String permission=Build.VERSION.SDK_INT>=33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE;
                        String[] requested=Build.VERSION.SDK_INT>=34 ? new String[]{permission,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED} : new String[]{permission};
                        boolean selected=requested.length==2 && checkSelfPermission(requested[1])==PackageManager.PERMISSION_GRANTED;
                        if (checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED || selected) execute(id,"scan",args);
                        else {
                            pendingPermission=id;
                            requestPermissions(requested,2);
                        }
                    });
                } else execute(id,action,args);
            } catch (Exception error) { reply(id,null,"请求参数无效"); }
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (request!=1) return;
        String id=pendingPicker; pendingPicker=null;
        if (id==null) return;
        if (result!=RESULT_OK || data==null) { reply(id,new JSONObject(),null); return; }
        ArrayList<Uri> uris=new ArrayList<>();
        if (data.getClipData()!=null) for(int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null) uris.add(data.getData());
        worker.execute(() -> {
            try {
                for(Uri uri:uris) {
                    try { getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                    catch(SecurityException ignored) { /* MediaStore grants can also come from a global photo permission. */ }
                }
                reply(id,library.importPhotos(uris),null);
            } catch(Exception error) { reply(id,null,error.getMessage()); }
        });
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==2 && pendingPermission!=null) {
            String id=pendingPermission; pendingPermission=null;
            boolean granted=false; for(int result:results) granted |= result==PackageManager.PERMISSION_GRANTED;
            if(granted) execute(id,"scan",new JSONObject()); else reply(id,null,"未授予相册访问权限；仍可使用“选择照片”");
        }
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putString("picker",pendingPicker);out.putString("permission",pendingPermission); }
    @Override protected void onPause() {
        if(web!=null) web.evaluateJavascript("window.persistDraft && window.persistDraft()",null);
        super.onPause();
    }
    @Override public void onBackPressed() { web.evaluateJavascript("window.appBack()",result->{if("true".equals(result))finish();}); }
    @Override protected void onDestroy() {
        worker.shutdown(); // Finish any draft commit/export already in progress.
        if(web!=null) { web.removeJavascriptInterface("Native"); web.destroy(); }
        super.onDestroy();
    }
}
