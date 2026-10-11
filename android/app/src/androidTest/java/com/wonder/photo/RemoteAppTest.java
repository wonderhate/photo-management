package com.wonder.photo;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Run only on the dedicated emulator against backend.verify_remote_server's synthetic library. */
@RunWith(AndroidJUnit4.class)
public class RemoteAppTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrumentation.getTargetContext();
    private WebView web;
    private String evaluate(String script) throws Exception {
        AtomicReference<String> value=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        instrumentation.runOnMainSync(()->web.evaluateJavascript(script,v->{value.set(v);done.countDown();}));
        assertTrue(done.await(10,TimeUnit.SECONDS));return value.get();
    }
    private void await(String expression) throws Exception {
        for(int i=0;i<300;i++){if("true".equals(evaluate("Boolean("+expression+")")))return;Thread.sleep(100);}
        fail("Timed out: "+expression+"; body="+evaluate("document.body.innerText"));
    }
    private void screenshot(String name) throws Exception {
        File folder=new File(context.getExternalFilesDir(null),"verification");assertTrue(folder.isDirectory()||folder.mkdirs());
        Bitmap image=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(image);
        try(FileOutputStream out=new FileOutputStream(new File(folder,name+".png"))){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,out));}finally{image.recycle();}
    }
    @Test public void pairedDesktopEditorIndexOnlyAndExplicitPhoneExport() throws Exception {
        String[] permissions=context.getPackageManager().getPackageInfo(context.getPackageName(),android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions;
        assertTrue(Arrays.asList(permissions).contains("android.permission.INTERNET"));
        assertFalse(Arrays.asList(permissions).contains("android.permission.READ_MEDIA_IMAGES"));
        assertFalse(Arrays.asList(permissions).contains("android.permission.READ_EXTERNAL_STORAGE"));
        Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(intent);
        try {
            instrumentation.runOnMainSync(()->{ViewGroup root=activity.findViewById(android.R.id.content);web=(WebView)((ViewGroup)root.getChildAt(0)).getChildAt(0);});
            await("document.getElementById('pair')");screenshot("remote-connect");
            evaluate("document.getElementById('address').value='http://10.0.2.2:8012';document.getElementById('code').value='12345678';document.getElementById('pair').click()");
            await("document.querySelectorAll('.photo-card').length>0 && document.documentElement.dataset.remote==='true'");
            assertEquals("5",evaluate("document.querySelectorAll('.mobile-nav button').length"));
            assertEquals("true",evaluate("typeof Connect==='undefined'"));
            screenshot("remote-gallery");
            evaluate("document.querySelector('.photo-image').click()");await("document.querySelector('.photo-detail')");
            boolean favorite="true".equals(evaluate("[...document.querySelectorAll('.photo-detail button')].some(b=>b.innerText==='已收藏')"));
            evaluate("[...document.querySelectorAll('.photo-detail button')].find(b=>b.innerText==='收藏'||b.innerText==='已收藏').click()");
            await("[...document.querySelectorAll('.photo-detail button')].some(b=>b.innerText==='"+(favorite?"收藏":"已收藏")+"')");
            evaluate("[...document.querySelectorAll('.photo-detail button')].find(b=>b.innerText==='制作水印').click()");
            await("document.querySelector('.render-stage img') && !document.querySelector('.render-status').innerText.includes('正在')");
            evaluate("document.querySelector('[aria-label=\"水印作品名称\"]').value='Remote emulator draft';document.querySelector('[aria-label=\"水印作品名称\"]').dispatchEvent(new Event('input',{bubbles:true}))");
            evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='保存到水印图库').click()");
            await("location.search.includes('draft=')");screenshot("remote-editor");
            assertEquals("true",evaluate("Object.keys(localStorage).some(k=>k.startsWith('remote-index:'))"));
            assertEquals("false",evaluate("Object.keys(localStorage).some(k=>/data:image|blob:/.test(localStorage.getItem(k)))"));
            long started=System.currentTimeMillis()/1000;
            evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='导出当前照片').click()");
            boolean saved=false;
            for(int i=0;i<200&&!saved;i++){
                try(Cursor cursor=context.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},"relative_path=? AND date_added>=?",new String[]{"Pictures/PhotoCollection/",Long.toString(started)},null)){saved=cursor!=null&&cursor.moveToFirst();}
                if(!saved)Thread.sleep(100);
            }
            assertTrue("Explicit export did not create a phone image",saved);
            evaluate("[...document.querySelectorAll('.mobile-nav button')].find(b=>b.innerText==='我的').click()");await("document.querySelector('.remote-computer')");screenshot("remote-my");
            instrumentation.runOnMainSync(()->assertEquals(android.webkit.WebSettings.LOAD_NO_CACHE,web.getSettings().getCacheMode()));
            assertNotNull(CookieManager.getInstance().getCookie("http://10.0.2.2:8012"));
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
