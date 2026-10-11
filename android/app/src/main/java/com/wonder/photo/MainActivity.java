package com.wonder.photo;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.view.ViewGroup;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Remote UI only. Photo bytes are written only by an explicit watermark export. */
public class MainActivity extends Activity {
    private static final String HOME = "file:///android_asset/index.html";
    private WebView web;
    private String server = "";
    private boolean pairing;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xfff7f7f9);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // JSON index and UI preferences only.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PhotoCollectionRemote/2");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.clearCache(true);
        // Remove only the previous app's generated previews, never photos or its database.
        File[] old = getCacheDir().listFiles();
        if (old != null) for (File file : old) if (file.getName().matches("[pd][0-9]+\\.webp(?:\\.tmp)?") && !file.delete()) toast("旧预览清理失败，请在系统设置清除应用缓存");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String target = request.getUrl().toString();
                if (target.equals("photocollection://disconnect")) { showConnection(); return true; }
                return !HOME.equals(target) && !RemoteConnection.sameServer(server, target);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (HOME.equals(url)) {
                    String address = getSharedPreferences("remote", MODE_PRIVATE).getString("server", "");
                    web.evaluateJavascript("document.getElementById('address').value=" + JSONObject.quote(address), null);
                    web.clearHistory();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !HOME.equals(request.getUrl().toString())) { showConnection(); toast("无法连接电脑，请确认电脑已启动且网络可达"); }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && (response.getStatusCode() == 401 || response.getStatusCode() == 403)) { showConnection(); toast("电脑已关闭访问或配对已失效，请重新配对"); }
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (!RemoteConnection.exportUrl(server, url) || !("image/jpeg".equals(mime) || "image/png".equals(mime))) {
                toast("手机只保存正式导出的 JPG / PNG 水印作品"); return;
            }
            String filename = URLUtil.guessFileName(url, disposition, mime);
            String cookie = CookieManager.getInstance().getCookie(url);
            worker.execute(() -> saveExport(url, cookie, filename, mime));
        });
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xfff7f7f9);
        frame.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(frame);
        showConnection();
    }

    private void showConnection() {
        web.stopLoading();
        web.clearCache(true);
        web.addJavascriptInterface(new Connect(), "Connect");
        web.loadUrl(HOME);
    }

    private void toast(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }
    private void connectionError(String text) {
        runOnUiThread(() -> { pairing = false; if (!isDestroyed()) web.evaluateJavascript("window.connectionDone(" + JSONObject.quote(text) + ")", null); });
    }

    private final class Connect {
        @JavascriptInterface public void connect(String address, String code) {
            if (address.length() > 2048 || code.length() > 8) { connectionError("电脑地址或配对码无效"); return; }
            runOnUiThread(() -> {
                if (pairing || !HOME.equals(web.getUrl())) return;
                pairing = true;
                worker.execute(() -> {
                    HttpURLConnection connection = null;
                    try {
                        String target = RemoteConnection.normalize(address);
                        connection = RemoteConnection.open(target + "/api/remote/connect", null);
                        connection.setRequestMethod("POST");
                        connection.setDoOutput(true);
                        connection.setRequestProperty("Content-Type", "application/json");
                        try (OutputStream out = connection.getOutputStream()) { out.write(new JSONObject().put("code", code).toString().getBytes(StandardCharsets.UTF_8)); }
                        if (connection.getResponseCode() != 200) throw new IOException(connection.getResponseCode() == 429 ? "配对尝试过多，请一分钟后再试" : "配对失败，请检查电脑设置中的八位配对码");
                        String cookie = connection.getHeaderField("Set-Cookie");
                        if (cookie == null || !cookie.startsWith("photo_remote=")) throw new IOException("电脑版本不支持手机配对，请更新电脑端");
                        String pairedCookie = cookie;
                        runOnUiThread(() -> {
                            if (isDestroyed()) return;
                            server = target;
                            getSharedPreferences("remote", MODE_PRIVATE).edit().putString("server", server).apply();
                            CookieManager.getInstance().setCookie(server, pairedCookie, ok -> {
                                pairing = false;
                                if (!ok) { connectionError("无法保存配对，请重试"); return; }
                                CookieManager.getInstance().flush();
                                web.removeJavascriptInterface("Connect"); // No bridge on network pages.
                                web.loadUrl(server + "/?page=photos");
                            });
                        });
                    } catch (Exception error) { connectionError(error.getMessage() == null ? "无法连接电脑" : error.getMessage()); }
                    finally { if (connection != null) connection.disconnect(); }
                });
            });
        }
        @JavascriptInterface public void resume(String address) {
            runOnUiThread(() -> {
                if (!HOME.equals(web.getUrl())) return;
                try {
                    server = RemoteConnection.normalize(address);
                    if (CookieManager.getInstance().getCookie(server) == null) { connectionError("请先输入配对码连接电脑"); return; }
                    web.removeJavascriptInterface("Connect");
                    web.loadUrl(server + "/?page=photos");
                } catch (Exception error) { connectionError("电脑地址无效"); }
            });
        }
    }

    private void saveExport(String url, String cookie, String filename, String mime) {
        Uri created = null;
        HttpURLConnection connection = null;
        try {
            connection = RemoteConnection.open(url, cookie);
            if (connection.getResponseCode() != 200) throw new IOException("导出下载失败，请重新连接电脑后重试");
            String type = connection.getContentType();
            if (type == null || !type.split(";")[0].equals(mime)) throw new IOException("电脑返回的内容不是水印图片");
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, new File(filename).getName());
            values.put(MediaStore.Images.Media.MIME_TYPE, mime);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/PhotoCollection");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            created = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (created == null) throw new IOException("手机无法创建导出文件");
            long received = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = getContentResolver().openOutputStream(created)) {
                if (out == null) throw new IOException("手机存储不可写");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) { out.write(buffer, 0, count); received += count; }
            }
            long expected = connection.getContentLengthLong();
            if (received == 0 || (expected >= 0 && received != expected)) throw new IOException("网络中断，导出未保存完整，请重试");
            ContentValues done = new ContentValues(); done.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContentResolver().update(created, done, null, null);
            toast("已保存至手机相册 · PhotoCollection");
        } catch (Exception error) {
            if (created != null) getContentResolver().delete(created, null, null); // Only our newly created row.
            toast(error.getMessage() == null ? "水印保存失败，请检查手机剩余空间" : error.getMessage());
        } finally { if (connection != null) connection.disconnect(); }
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else if (!HOME.equals(web.getUrl())) showConnection(); else super.onBackPressed(); }
    @Override protected void onDestroy() {
        worker.shutdown();
        if (web != null) { web.removeJavascriptInterface("Connect"); web.clearCache(true); web.destroy(); }
        super.onDestroy();
    }
}
