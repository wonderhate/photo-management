package com.wonder.photo;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import androidx.test.core.app.ApplicationProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import java.io.File;
import java.nio.file.Files;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=29) @GraphicsMode(GraphicsMode.Mode.NATIVE)
public class LibraryTest {
    @Test public void persistedDraftVariantsCacheAndSafeRemoval() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();context.deleteDatabase("library.db");Library library=new Library(context);
        File original=new File(context.getFilesDir(),"original.jpg");Files.write(original.toPath(),new byte[]{1,2,3,4});
        ContentValues photo=new ContentValues();photo.put("uri","content://photos/1");photo.put("hash","testhash");photo.put("name","IMG.jpg");photo.put("date","2026-09-29 18:24:00");photo.put("exif","{\"lens\":\"85mm\",\"focal\":85,\"iso\":100}");photo.put("lens","85mm");photo.put("focal",85);photo.put("iso",100);
        long id=library.getWritableDatabase().insertOrThrow("photos",null,photo);
        JSONObject settings=Renderer.defaults();settings.put("signature","独立手机");
        JSONObject draft=library.call("saveDraft",new JSONObject().put("photo_id",id).put("name","相框一").put("settings",settings));
        long draftId=draft.getLong("id");library.close();library=new Library(context);
        assertEquals("独立手机",library.getDraft(draftId).getJSONObject("settings").getString("signature"));
        JSONObject copy=library.call("duplicate",new JSONObject().put("id",draftId));
        settings.put("type","ambient");library.call("saveDraft",new JSONObject().put("id",copy.getLong("id")).put("settings",settings));
        assertEquals("frame",library.getDraft(draftId).getJSONObject("settings").getString("type"));
        ContentValues exported=new ContentValues();exported.put("exported",System.currentTimeMillis());exported.put("status","exported");library.getWritableDatabase().update("drafts",exported,"id=?",new String[]{Long.toString(draftId)});
        settings.put("signature","修改后");JSONObject changed=library.call("saveDraft",new JSONObject().put("id",draftId).put("settings",settings));
        assertEquals("ready",changed.getString("status"));assertTrue(changed.getLong("updated")>changed.getLong("exported"));
        assertEquals(1,library.call("photos",new JSONObject().put("metric","focal").put("value",85)).getLong("total"));
        assertEquals(0,library.call("photos",new JSONObject().put("metric","focal").put("value",50)).getLong("total"));
        assertEquals(1,library.call("stats",new JSONObject().put("period","2026-09")).getInt("total"));
        File cache=new File(context.getCacheDir(),"p1.webp");Files.write(cache.toPath(),new byte[]{9});
        library.call("clearCache",new JSONObject());assertFalse(cache.exists());assertTrue(original.exists());
        library.call("removeDraft",new JSONObject().put("id",draftId));library.call("removePhoto",new JSONObject().put("id",id));
        assertArrayEquals(new byte[]{1,2,3,4},Files.readAllBytes(original.toPath()));assertNotNull(library.getDraft(copy.getLong("id")));library.close();
    }
    @Test public void actualRenderExifHidingAndPhotoBasedAmbientColors() throws Exception {
        JSONObject settings=Renderer.defaults(),exif=new JSONObject("{\"camera\":\"SONY\",\"lens\":\"85mm GM\",\"focal\":85,\"aperture\":1.4,\"shutter\":0.002,\"iso\":100}");
        assertTrue(Renderer.text(exif,settings).toString().contains("ISO 100"));
        settings.put("fields",new JSONArray("[\"camera\",\"focal\",\"aperture\",\"shutter\"]"));assertFalse(Renderer.text(exif,settings).toString().contains("ISO"));
        assertTrue(Renderer.text(new JSONObject(),settings).isEmpty());assertEquals("1/500 s",Renderer.shutter(.002));
        Bitmap warm=Bitmap.createBitmap(200,150,Bitmap.Config.ARGB_8888);warm.eraseColor(Color.rgb(230,100,20));
        Bitmap framed=Renderer.render(warm,exif,settings);assertTrue(framed.getHeight()>warm.getHeight());assertEquals(Color.WHITE,framed.getPixel(0,0));framed.recycle();
        settings.put("type","ambient");Bitmap ambient=Renderer.render(warm,exif,settings);int color=ambient.getPixel(0,0);assertTrue(Color.red(color)>Color.blue(color));ambient.recycle();
        warm.eraseColor(Color.rgb(15,80,230));ambient=Renderer.render(warm,exif,settings);color=ambient.getPixel(0,0);assertTrue(Color.blue(color)>Color.red(color));ambient.recycle();warm.recycle();
    }
    @Test public void visualLabelsAndOrAndValidation() throws Exception {
        JSONArray labels=new JSONArray("[{\"text\":\"Sunset\",\"score\":0.92},{\"text\":\"Beach\",\"score\":0.81}]");
        assertEquals(.81,SmartLabels.score(labels,new String[]{"海边","日落"},true),.001);
        assertEquals(.92,SmartLabels.score(labels,new String[]{"猫","日落"},false),.001);
        assertEquals(0,SmartLabels.score(labels,new String[]{"猫","日落"},true),.001);
        assertThrows(Exception.class,()->Renderer.validate(new JSONObject().put("scale",20)));
    }
}
