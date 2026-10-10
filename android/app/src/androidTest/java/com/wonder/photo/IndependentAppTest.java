package com.wonder.photo;
import android.app.Instrumentation;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import androidx.exifinterface.media.ExifInterface;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Runs only against a disposable emulator, creates its own source image, never resets a library. */
@RunWith(AndroidJUnit4.class)
public class IndependentAppTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrumentation.getTargetContext();
    private WebView web;
    private MainActivity activity;
    private String evaluate(String script) throws Exception {
        AtomicReference<String> value=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        instrumentation.runOnMainSync(()->web.evaluateJavascript(script,v->{value.set(v);done.countDown();}));
        assertTrue(done.await(10,TimeUnit.SECONDS));return value.get();
    }
    private void await(String expression) throws Exception {
        for(int i=0;i<300;i++){if("true".equals(evaluate("Boolean("+expression+")")))return;Thread.sleep(100);}
        fail("Timed out: "+expression+"; body="+evaluate("document.body.innerText"));
    }
    private void launch() throws Exception {
        Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=(MainActivity)instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(()->{ViewGroup root=activity.findViewById(android.R.id.content);web=(WebView)((ViewGroup)root.getChildAt(0)).getChildAt(0);});
        await("document.getElementById('pick')");
    }
    private byte[] hash(Uri uri) throws Exception {MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=context.getContentResolver().openInputStream(uri)){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))>0)digest.update(buffer,0,n);}return digest.digest();}
    private void screenshot(String name) throws Exception {
        Thread.sleep(300);
        File folder=new File(context.getExternalFilesDir(null),"verification");assertTrue(folder.isDirectory()||folder.mkdirs());
        Bitmap image=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(image);
        try(FileOutputStream out=new FileOutputStream(new File(folder,name+".png"))){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,out));}finally{image.recycle();}
    }
    @Test public void offlineModelAndRealEditorSaveRestartAndExport() throws Exception {
        String[] permissions=context.getPackageManager().getPackageInfo(context.getPackageName(),android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions;
        assertFalse(Arrays.asList(permissions).contains("android.permission.INTERNET"));
        assertFalse(Arrays.asList(permissions).contains("android.permission.WRITE_EXTERNAL_STORAGE"));
        ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,"PhotoCollection-test-"+System.nanoTime()+".jpg");values.put(MediaStore.Images.Media.MIME_TYPE,"image/jpeg");values.put(MediaStore.Images.Media.RELATIVE_PATH,"Pictures/PhotoCollectionTest");
        Uri original=context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(original);
        Bitmap image=Bitmap.createBitmap(600,400,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(image);canvas.drawColor(Color.rgb(250,151,65));Paint paint=new Paint();paint.setColor(Color.rgb(255,222,121));canvas.drawCircle(320,190,50,paint);paint.setColor(Color.rgb(31,93,129));canvas.drawRect(0,240,600,400,paint);
        try(OutputStream out=context.getContentResolver().openOutputStream(original)){assertTrue(image.compress(Bitmap.CompressFormat.JPEG,95,out));}image.recycle();
        // Set metadata only on the freshly generated fixture, before treating it as a read-only original.
        try(ParcelFileDescriptor descriptor=context.getContentResolver().openFileDescriptor(original,"rw")) {
            ExifInterface exif=new ExifInterface(descriptor.getFileDescriptor());
            exif.setAttribute(ExifInterface.TAG_MODEL,"SONY Test Phone");exif.setAttribute(ExifInterface.TAG_LENS_MODEL,"85mm Test Lens");exif.setAttribute(ExifInterface.TAG_FOCAL_LENGTH,"85/1");exif.setAttribute(ExifInterface.TAG_F_NUMBER,"14/10");exif.setAttribute(ExifInterface.TAG_EXPOSURE_TIME,"1/500");exif.setAttribute(ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,"100");exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL,"2026:09:29 18:24:00");exif.saveAttributes();
        }
        byte[] before=hash(original);
        Library library=new Library(context);long photoId=0,draftId=0;Uri exported=null;
        try {
            assertEquals(1,library.importPhotos(List.of(original)).getInt("success"));
            try(android.database.Cursor cursor=library.getReadableDatabase().rawQuery("SELECT id FROM photos WHERE uri=?",new String[]{original.toString()})){assertTrue(cursor.moveToFirst());photoId=cursor.getLong(0);}
            JSONObject parsed=library.getPhoto(photoId).getJSONObject("exif");assertEquals(85,parsed.getDouble("focal"),.001);assertEquals(1.4,parsed.getDouble("aperture"),.001);assertEquals(.002,parsed.getDouble("shutter"),.00001);assertEquals(100,parsed.getDouble("iso"),.001);
            JSONObject analysis=library.call("index",new JSONObject());assertTrue(analysis.toString(),analysis.getInt("success")>=1);assertEquals("1",library.getPhoto(photoId).getString("indexed"));
            launch();screenshot("photos");evaluate("detail("+photoId+")");await("document.getElementById('watermark')");evaluate("document.getElementById('watermark').click()");await("document.getElementById('signature') && document.getElementById('livePreview').src.startsWith('data:')");
            evaluate("document.getElementById('signature').value='独立手机验收';document.getElementById('signature').dispatchEvent(new Event('input'));document.getElementById('save').click()");await("editor && editor.id>0 && !editor.dirty");draftId=Long.parseLong(evaluate("editor.id"));assertEquals("独立手机验收",library.getDraft(draftId).getJSONObject("settings").getString("signature"));
            evaluate("window.previewDone=false;previewEditor().then(()=>window.previewDone=true)");await("window.previewDone");screenshot("frame-editor");
            instrumentation.runOnMainSync(()->activity.finish());launch();evaluate("openDraft("+draftId+")");await("document.getElementById('signature') && document.getElementById('signature').value==='独立手机验收'");
            evaluate("document.getElementById('template').value='ambient';document.getElementById('template').dispatchEvent(new Event('change'))");await("editor.settings.type==='ambient' && !editor.dirty");
            screenshot("ambient-editor");
            evaluate("document.getElementById('editorExport').click()");await("document.getElementById('exportDialog').open");evaluate("document.getElementById('exportGo').click()");await("!busy && document.getElementById('notice').innerText.includes('导出 1')");
            JSONObject draft=library.getDraft(draftId);assertEquals("exported",draft.getString("status"));exported=Uri.parse(draft.getString("export_uri"));assertNotEquals(original,exported);assertArrayEquals(before,hash(original));
            library.call("removeDraft",new JSONObject().put("id",draftId));draftId=0;library.call("removePhoto",new JSONObject().put("id",photoId));photoId=0;assertArrayEquals(before,hash(original));
        } finally {
            if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());
            if(draftId>0)library.call("removeDraft",new JSONObject().put("id",draftId));if(photoId>0)library.call("removePhoto",new JSONObject().put("id",photoId));library.close();
            // Only rows created in this test are removed; these are synthetic, never user originals.
            context.getContentResolver().delete(original,null,null);if(exported!=null)context.getContentResolver().delete(exported,null,null);
        }
    }
}
