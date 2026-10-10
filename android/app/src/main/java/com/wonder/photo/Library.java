package com.wonder.photo;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.StatFs;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.exifinterface.media.ExifInterface;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.label.ImageLabeler;
import com.google.mlkit.vision.label.ImageLabeling;
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions;
import com.google.mlkit.vision.label.ImageLabel;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;

/** All originals are opened with read streams. Only new MediaStore rows are writable. */
public class Library extends SQLiteOpenHelper {
    private final Context context;
    private static final long MB=1024*1024;
    public Library(Context context) { super(context,"library.db",null,1); this.context=context; }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE photos(id INTEGER PRIMARY KEY, uri TEXT UNIQUE NOT NULL, hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL, exif TEXT NOT NULL, labels TEXT NOT NULL DEFAULT '[]', indexed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '',lens TEXT,focal REAL,aperture REAL,iso REAL,shutter REAL)");
        db.execSQL("CREATE INDEX photo_date ON photos(date)");
        db.execSQL("CREATE INDEX photo_lens ON photos(lens)");
        db.execSQL("CREATE TABLE drafts(id INTEGER PRIMARY KEY, photo_id INTEGER, uri TEXT NOT NULL, name TEXT NOT NULL, exif TEXT NOT NULL, settings TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', updated INTEGER NOT NULL, created INTEGER NOT NULL, exported INTEGER NOT NULL DEFAULT 0, export_uri TEXT)");
        db.execSQL("CREATE INDEX draft_updated ON drafts(updated)");
        db.execSQL("CREATE TABLE albums(id INTEGER PRIMARY KEY,name TEXT NOT NULL,keywords TEXT NOT NULL,mode TEXT NOT NULL,threshold REAL NOT NULL,created INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE album_photos(album_id INTEGER NOT NULL,photo_id INTEGER NOT NULL,PRIMARY KEY(album_id,photo_id))");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int from,int to) { throw new IllegalStateException("不支持的数据库升级，请先备份"); }

    private JSONObject photo(Cursor cursor) throws Exception {
        JSONObject result=new JSONObject();
        for(String key: new String[]{"id","uri","name","date","favorite","tags","indexed"}) result.put(key,cursor.getString(cursor.getColumnIndexOrThrow(key)));
        result.put("exif",new JSONObject(cursor.getString(cursor.getColumnIndexOrThrow("exif"))));
        result.put("labels",new JSONArray(cursor.getString(cursor.getColumnIndexOrThrow("labels"))));
        return result;
    }
    JSONObject getPhoto(long id) throws Exception {
        try(Cursor c=getReadableDatabase().rawQuery("SELECT * FROM photos WHERE id=?",new String[]{Long.toString(id)})) {
            if(!c.moveToFirst()) throw new IOException("照片记录不存在"); return photo(c);
        }
    }
    JSONObject getDraft(long id) throws Exception {
        try(Cursor c=getReadableDatabase().rawQuery("SELECT * FROM drafts WHERE id=?",new String[]{Long.toString(id)})) {
            if(!c.moveToFirst()) throw new IOException("水印作品不存在");
            JSONObject out=new JSONObject();
            for(String key:new String[]{"id","photo_id","uri","name","status","updated","created","exported","export_uri"}) out.put(key,c.getString(c.getColumnIndexOrThrow(key)));
            out.put("exif",new JSONObject(c.getString(c.getColumnIndexOrThrow("exif"))));
            out.put("settings",new JSONObject(c.getString(c.getColumnIndexOrThrow("settings"))));
            return out;
        }
    }
    public JSONObject call(String action,JSONObject args) throws Exception {
        long id=args.optLong("id");
        switch(action) {
            case "photos": return listPhotos(args);
            case "photo": return getPhoto(id);
            case "image": {
                Bitmap bitmap=decode(Uri.parse(getPhoto(id).getString("uri")),1200);
                try{return new JSONObject().put("image",dataUrl(bitmap));}finally{bitmap.recycle();}
            }
            case "scan": {
                List<Uri> uris=new ArrayList<>();
                try(Cursor c=context.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},null,null,"date_added DESC")) {
                    if(c!=null) while(c.moveToNext()) uris.add(Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,c.getString(0)));
                }
                return importPhotos(uris);
            }
            case "favorite": {
                ContentValues value=new ContentValues(); value.put("favorite",args.optBoolean("value")?1:0);getWritableDatabase().update("photos",value,"id=?",new String[]{Long.toString(id)});return new JSONObject();
            }
            case "tags": {
                ContentValues value=new ContentValues(); value.put("tags",bounded(args.optString("value"),500));getWritableDatabase().update("photos",value,"id=?",new String[]{Long.toString(id)});return new JSONObject();
            }
            case "removePhoto": {
                // Keep draft source snapshots. Never delete a MediaStore source row.
                getWritableDatabase().delete("album_photos","photo_id=?",new String[]{Long.toString(id)});
                getWritableDatabase().delete("photos","id=?",new String[]{Long.toString(id)});
                return new JSONObject().put("originals_untouched",true);
            }
            case "preview": {
                JSONObject source=args.optLong("draft")>0?getDraft(args.getLong("draft")):getPhoto(id);
                JSONObject settings=args.has("settings")?Renderer.validate(args.getJSONObject("settings")):Renderer.defaults();
                Bitmap original=decode(Uri.parse(source.getString("uri")),1200);
                Bitmap rendered=Renderer.render(original,source.getJSONObject("exif"),settings);
                String data=dataUrl(rendered); rendered.recycle();original.recycle();return new JSONObject().put("image",data);
            }
            case "saveDraft": return saveDraft(args);
            case "draft": return getDraft(id);
            case "drafts": return listDrafts(args);
            case "draftStatus": {
                String status=args.getString("status");if(!status.equals("ready") && !status.equals("draft")) throw new IOException("无效状态");
                ContentValues value=new ContentValues();value.put("status",status);getWritableDatabase().update("drafts",value,"id=?",new String[]{Long.toString(id)});return getDraft(id);
            }
            case "duplicate": {
                JSONObject draft=getDraft(id);draft.remove("id");draft.put("name",bounded(draft.getString("name")+" 副本",180));return saveDraft(draft);
            }
            case "removeDraft": {
                getWritableDatabase().delete("drafts","id=?",new String[]{Long.toString(id)});
                File preview=new File(context.getCacheDir(),"d"+id+".webp");if(preview.exists()&&!preview.delete()) throw new IOException("预览清理失败");
                return new JSONObject().put("originals_untouched",true);
            }
            case "export": return exportDraft(getDraft(id),args);
            case "batchExport": {
                JSONArray ids=args.getJSONArray("ids"),results=new JSONArray();if(ids.length()>200)throw new IOException("一次最多导出 200 个作品");
                for(int i=0;i<ids.length();i++) {
                    try { results.put(exportDraft(getDraft(ids.getLong(i)),args)); }
                    catch(Exception error) {results.put(new JSONObject().put("id",ids.getLong(i)).put("error",error.getMessage()));}
                }
                return new JSONObject().put("results",results);
            }
            case "storage": return storage();
            case "cacheLimit": {
                int limit=args.getInt("mb");if(limit<16||limit>2048) throw new IOException("缓存上限须为 16–2048 MB");
                context.getSharedPreferences("settings",0).edit().putInt("cache_mb",limit).apply();trimCache();return storage();
            }
            case "clearCache": {
                File[] files=context.getCacheDir().listFiles();if(files!=null) for(File f:files) if(isDerived(f)&&!f.delete()) throw new IOException("缓存清理失败");return storage();
            }
            case "stats": return stats(args);
            case "index": return index();
            case "smart": return smart(args);
            case "saveAlbum": {
                JSONArray ids=args.getJSONArray("ids");if(ids.length()==0||ids.length()>5000) throw new IOException("影集须包含 1–5000 张照片");
                SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();long album;
                try {
                    ContentValues values=new ContentValues();values.put("name",bounded(args.getString("name"),180));values.put("keywords",bounded(args.optString("keywords"),500));values.put("mode",args.optString("mode","OR"));values.put("threshold",args.optDouble("threshold",.5));values.put("created",System.currentTimeMillis());album=db.insertOrThrow("albums",null,values);
                    for(int i=0;i<ids.length();i++){getPhoto(ids.getLong(i));db.execSQL("INSERT OR IGNORE INTO album_photos VALUES(?,?)",new Object[]{album,ids.getLong(i)});}
                    db.setTransactionSuccessful();
                } finally {db.endTransaction();}
                return new JSONObject().put("id",album);
            }
            case "albums": {
                JSONArray rows=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT a.*,COUNT(ap.photo_id) AS total FROM albums a LEFT JOIN album_photos ap ON a.id=ap.album_id GROUP BY a.id ORDER BY created DESC",null)){
                    while(c.moveToNext())rows.put(new JSONObject().put("id",c.getLong(0)).put("name",c.getString(1)).put("keywords",c.getString(2)).put("total",c.getLong(c.getColumnIndexOrThrow("total"))));
                }return new JSONObject().put("albums",rows);
            }
            default: throw new IOException("不支持的操作");
        }
    }
    private static String bounded(String value,int max) throws IOException {if(value.length()>max)throw new IOException("文字过长");return value.trim();}

    public JSONObject importPhotos(List<Uri> uris) throws Exception {
        int success=0,skipped=0,failed=0;JSONArray errors=new JSONArray();
        for(Uri uri:uris) {
            try {
                if(!"content".equals(uri.getScheme())) throw new IOException("仅支持系统相册/文件选择器内容引用");
                try(Cursor c=getReadableDatabase().rawQuery("SELECT id FROM photos WHERE uri=?",new String[]{uri.toString()})) {if(c.moveToFirst()){skipped++;continue;}}
                MessageDigest digest=MessageDigest.getInstance("SHA-256");
                try(InputStream in=context.getContentResolver().openInputStream(uri)){
                    if(in==null)throw new IOException("原始照片不可用，请重新授权");byte[] buffer=new byte[65536];int size;while((size=in.read(buffer))!=-1)digest.update(buffer,0,size);
                }
                StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b));
                try(Cursor c=getReadableDatabase().rawQuery("SELECT id FROM photos WHERE hash=?",new String[]{hash.toString()})) {if(c.moveToFirst()){skipped++;continue;}}
                String name="照片";try(Cursor c=context.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}
                JSONObject exif=readExif(uri);
                String date=exif.optString("date");
                if(date.isEmpty()){
                    try(Cursor c=context.getContentResolver().query(uri,new String[]{MediaStore.Images.Media.DATE_TAKEN},null,null,null)) {
                        if(c!=null&&c.moveToFirst()&&c.getLong(0)>0)date=new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss",Locale.ROOT).format(new java.util.Date(c.getLong(0)));
                    } catch(Exception ignored){/* Some document providers do not expose a capture date. */}
                }
                ContentValues v=new ContentValues();v.put("uri",uri.toString());v.put("name",name);v.put("hash",hash.toString());v.put("exif",exif.toString());v.put("date",date);
                if(exif.has("lens"))v.put("lens",exif.getString("lens"));
                for(String field:new String[]{"focal","aperture","iso","shutter"})if(exif.has(field))v.put(field,exif.getDouble(field));
                long photoId=getWritableDatabase().insertOrThrow("photos",null,v);
                try { Bitmap image=decode(uri,400);cacheBitmap("p"+photoId+".webp",image);image.recycle(); }
                catch(IOException ignored){/* Keep EXIF and source reference when this phone cannot decode a RAW. */}
                success++;
            } catch(Exception error){failed++;if(errors.length()<10)errors.put(error.getMessage());}
        }
        trimCache();return new JSONObject().put("success",success).put("skipped",skipped).put("failed",failed).put("errors",errors);
    }
    JSONObject readExif(Uri uri) {
        JSONObject data=new JSONObject();
        try(InputStream input=context.getContentResolver().openInputStream(uri)) {
            if(input==null)return data;ExifInterface exif=new ExifInterface(input);
            for(String[] pair:new String[][]{{"make",ExifInterface.TAG_MAKE},{"camera",ExifInterface.TAG_MODEL},{"lens",ExifInterface.TAG_LENS_MODEL},{"date",ExifInterface.TAG_DATETIME_ORIGINAL}}) {
                String value=exif.getAttribute(pair[1]);if(value!=null)data.put(pair[0],pair[0].equals("date")&&value.length()>=10?value.substring(0,10).replace(':','-')+value.substring(10):value);
            }
            for(String[] pair:new String[][]{{"aperture",ExifInterface.TAG_F_NUMBER},{"shutter",ExifInterface.TAG_EXPOSURE_TIME},{"iso",ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY},{"focal",ExifInterface.TAG_FOCAL_LENGTH},{"width",ExifInterface.TAG_IMAGE_WIDTH},{"height",ExifInterface.TAG_IMAGE_LENGTH}}) {
                double value=exif.getAttributeDouble(pair[1],0);if(value>0&&Double.isFinite(value))data.put(pair[0],value);
            }
        } catch(Exception ignored){/* Partial or absent EXIF must never prevent import. */}
        return data;
    }
    Bitmap decode(Uri uri,int edge) throws IOException {
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        try(InputStream input=context.getContentResolver().openInputStream(uri)){if(input==null)throw new IOException("原始照片不可用");BitmapFactory.decodeStream(input,null,options);}
        if(options.outWidth<=0||options.outHeight<=0)throw new IOException("此手机无法解码该照片/RAW");
        int sample=1;while(Math.max(options.outWidth,options.outHeight)/sample>edge*1.4)sample*=2;
        options.inJustDecodeBounds=false;options.inSampleSize=sample;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        Bitmap bitmap;
        try(InputStream input=context.getContentResolver().openInputStream(uri)){bitmap=BitmapFactory.decodeStream(input,null,options);}
        if(bitmap==null)throw new IOException("照片解码失败");
        try(InputStream input=context.getContentResolver().openInputStream(uri)) {
            ExifInterface exif=new ExifInterface(input);Matrix matrix=new Matrix();
            if(exif.isFlipped())matrix.postScale(-1,1);matrix.postRotate(exif.getRotationDegrees());
            if(!matrix.isIdentity()) {Bitmap rotated=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),matrix,true);if(rotated!=bitmap)bitmap.recycle();bitmap=rotated;}
        } catch(IOException ignored){/* PNG without EXIF. */}
        int longest=Math.max(bitmap.getWidth(),bitmap.getHeight());
        if(longest>edge){Bitmap resized=Bitmap.createScaledBitmap(bitmap,Math.max(1,bitmap.getWidth()*edge/longest),Math.max(1,bitmap.getHeight()*edge/longest),true);if(resized!=bitmap)bitmap.recycle();bitmap=resized;}
        return bitmap;
    }
    private String dataUrl(Bitmap bitmap) throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();if(!bitmap.compress(Bitmap.CompressFormat.WEBP,82,out))throw new IOException("预览生成失败");return "data:image/webp;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);}
    private void cacheBitmap(String name,Bitmap bitmap) throws IOException {
        if(cacheBudget()==0)return;
        File target=new File(context.getCacheDir(),name),temp=new File(context.getCacheDir(),name+".tmp");
        try(FileOutputStream out=new FileOutputStream(temp)){if(!bitmap.compress(Bitmap.CompressFormat.WEBP,82,out))throw new IOException("缩略图保存失败");}
        if(!temp.renameTo(target)){temp.delete();throw new IOException("缩略图保存失败");}trimCache();
    }
    private String thumbnail(JSONObject source,boolean draft) throws Exception {
        String name=(draft?"d":"p")+source.getLong("id")+".webp";File file=new File(context.getCacheDir(),name);
        if(file.exists()) {file.setLastModified(System.currentTimeMillis());return "data:image/webp;base64,"+Base64.encodeToString(java.nio.file.Files.readAllBytes(file.toPath()),Base64.NO_WRAP);}
        Bitmap original=decode(Uri.parse(source.getString("uri")),draft?800:400);
        Bitmap image=draft?Renderer.render(original,source.getJSONObject("exif"),source.getJSONObject("settings")):original;
        String result=dataUrl(image);cacheBitmap(name,image);if(image!=original)image.recycle();original.recycle();return result;
    }
    private void addThumbnail(JSONObject item,boolean draft) throws Exception {
        try{
            try(android.content.res.AssetFileDescriptor file=context.getContentResolver().openAssetFileDescriptor(Uri.parse(item.getString("uri")),"r")){if(file==null)throw new IOException("原始照片不可用");}
        }catch(Exception error){item.put("missing",true);item.put("error",error.getMessage());return;}
        item.put("missing",false);
        try{item.put("thumbnail",thumbnail(item,draft));}catch(Exception error){item.put("error",error.getMessage());}
    }
    private JSONObject listPhotos(JSONObject args) throws Exception {
        int page=Math.max(1,args.optInt("page",1)),size=40;
        List<String> values=new ArrayList<>();String where="1=1";
        if(args.optBoolean("favorite"))where+=" AND favorite=1";
        if(args.optLong("album")>0){where+=" AND id IN (SELECT photo_id FROM album_photos WHERE album_id=?)";values.add(args.getString("album"));}
        if(!args.optString("search").trim().isEmpty()){where+=" AND (instr(name,?)>0 OR instr(tags,?)>0 OR instr(exif,?)>0)";for(int i=0;i<3;i++)values.add(args.getString("search"));}
        if(!args.optString("period").trim().isEmpty()){where+=" AND substr(date,1,?)=?";values.add(Integer.toString(args.getString("period").length()));values.add(args.getString("period"));}
        if(!args.optString("lens").trim().isEmpty()){where+=" AND lens=?";values.add(args.getString("lens"));}
        String metric=args.optString("metric");
        if(!metric.isEmpty()){
            if(!metric.matches("focal|aperture|iso|shutter"))throw new IOException("筛选字段无效");
            double value=args.getDouble("value");if(!Double.isFinite(value)||value<=0)throw new IOException("筛选数值无效");
            where+=" AND "+metric+"=?";values.add(Double.toString(value));
        }
        long total;try(Cursor c=getReadableDatabase().rawQuery("SELECT COUNT(*) FROM photos WHERE "+where,values.toArray(new String[0]))){c.moveToFirst();total=c.getLong(0);}
        JSONArray rows=new JSONArray();String sort=switch(args.optString("sort")){case "name"->"name COLLATE NOCASE";case "import"->"id DESC";default->"date DESC,id DESC";};
        try(Cursor c=getReadableDatabase().rawQuery("SELECT * FROM photos WHERE "+where+" ORDER BY "+sort+" LIMIT 40 OFFSET "+((long)(page-1)*size),values.toArray(new String[0]))){while(c.moveToNext()){JSONObject item=photo(c);addThumbnail(item,false);rows.put(item);}}
        return new JSONObject().put("photos",rows).put("total",total);
    }
    JSONObject saveDraft(JSONObject args) throws Exception {
        long id=args.optLong("id");JSONObject source=id>0?getDraft(id):(args.has("uri")?args:getPhoto(args.getLong("photo_id")));
        JSONObject settings=Renderer.validate(args.getJSONObject("settings"));
        boolean changed=id==0||!settings.toString().equals(source.getJSONObject("settings").toString());
        ContentValues value=new ContentValues();value.put("name",bounded(args.optString("name",source.getString("name")),180));value.put("settings",settings.toString());
        long now=System.currentTimeMillis();
        if(id==0){value.put("photo_id",source.optLong("photo_id",source.optLong("id")));value.put("uri",source.getString("uri"));value.put("exif",source.getJSONObject("exif").toString());value.put("created",now);value.put("updated",now);id=getWritableDatabase().insertOrThrow("drafts",null,value);}
        else {if(changed){value.put("updated",Math.max(now,source.getLong("updated")+1));if(source.getString("status").equals("exported"))value.put("status","ready");}getWritableDatabase().update("drafts",value,"id=?",new String[]{Long.toString(id)});}
        if(changed){File preview=new File(context.getCacheDir(),"d"+id+".webp");if(preview.exists())preview.delete();}
        JSONObject draft=getDraft(id);addThumbnail(draft,true);return draft;
    }
    private JSONObject listDrafts(JSONObject args) throws Exception {
        JSONArray rows=new JSONArray();int page=Math.max(1,args.optInt("page",1));List<String> values=new ArrayList<>();String where="1=1";
        if(!args.optString("status").trim().isEmpty()){where+=" AND status=?";values.add(args.getString("status"));}
        if(!args.optString("search").trim().isEmpty()){where+=" AND (instr(name,?)>0 OR instr(settings,?)>0 OR instr(exif,?)>0)";for(int i=0;i<3;i++)values.add(args.getString("search"));}
        if(!args.optString("type").trim().isEmpty()){where+=" AND instr(settings,?)>0";values.add("\"type\":"+JSONObject.quote(args.getString("type")));}
        long total;try(Cursor c=getReadableDatabase().rawQuery("SELECT COUNT(*) FROM drafts WHERE "+where,values.toArray(new String[0]))){c.moveToFirst();total=c.getLong(0);}
        String sort=switch(args.optString("sort")){case "old"->"updated ASC";case "name"->"name COLLATE NOCASE";case "created"->"created DESC";default->"updated DESC";};
        try(Cursor c=getReadableDatabase().rawQuery("SELECT id FROM drafts WHERE "+where+" ORDER BY "+sort+" LIMIT 40 OFFSET "+((long)(page-1)*40),values.toArray(new String[0]))){while(c.moveToNext()){JSONObject item=getDraft(c.getLong(0));addThumbnail(item,true);rows.put(item);}}
        JSONObject counts=new JSONObject().put("all",0).put("draft",0).put("ready",0).put("exported",0);
        try(Cursor c=getReadableDatabase().rawQuery("SELECT status,COUNT(*) FROM drafts GROUP BY status",null)){long all=0;while(c.moveToNext()){counts.put(c.getString(0),c.getLong(1));all+=c.getLong(1);}counts.put("all",all);}
        return new JSONObject().put("drafts",rows).put("counts",counts).put("total",total);
    }
    private JSONObject exportDraft(JSONObject draft,JSONObject args) throws Exception {
        int edge=args.optInt("edge",2560),quality=args.optInt("quality",95);String format=args.optString("format","jpg");
        if(edge<256||edge>4096||quality<1||quality>100||(!format.equals("jpg")&&!format.equals("png")))throw new IOException("导出尺寸须为 256–4096px，质量 1–100，格式 JPG/PNG");
        if(new StatFs(context.getFilesDir().getPath()).getAvailableBytes()<100*MB)throw new IOException("可用空间不足 100 MB，请先释放空间");
        Runtime runtime=Runtime.getRuntime();
        long available=runtime.maxMemory()-(runtime.totalMemory()-runtime.freeMemory())-32*MB;
        int memoryEdge=(int)Math.sqrt(Math.max(0,available)/20.0);
        if(memoryEdge<256)throw new IOException("可用内存不足，请关闭其他照片编辑后重试");
        int requestedEdge=edge;edge=Math.min(edge,memoryEdge);
        Bitmap original=decode(Uri.parse(draft.getString("uri")),edge);
        Bitmap rendered=Renderer.render(original,draft.getJSONObject("exif"),draft.getJSONObject("settings"));original.recycle();
        int longest=Math.max(rendered.getWidth(),rendered.getHeight());
        if(longest>edge){Bitmap resized=Bitmap.createScaledBitmap(rendered,rendered.getWidth()*edge/longest,rendered.getHeight()*edge/longest,true);rendered.recycle();rendered=resized;}
        String name=draft.getString("name").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_")+"_watermark_"+System.currentTimeMillis()+"."+format;
        ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,name);values.put(MediaStore.Images.Media.MIME_TYPE,format.equals("png")?"image/png":"image/jpeg");values.put(MediaStore.Images.Media.RELATIVE_PATH,"Pictures/PhotoCollection");values.put(MediaStore.Images.Media.IS_PENDING,1);
        Uri output=context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
        if(output==null){rendered.recycle();throw new IOException("无法创建导出文件");}
        try {
            try(OutputStream stream=context.getContentResolver().openOutputStream(output,"w")){if(stream==null||!rendered.compress(format.equals("png")?Bitmap.CompressFormat.PNG:Bitmap.CompressFormat.JPEG,quality,stream))throw new IOException("导出写入失败");}
            ContentValues published=new ContentValues();published.put(MediaStore.Images.Media.IS_PENDING,0);context.getContentResolver().update(output,published,null,null);
        } catch(Exception error){context.getContentResolver().delete(output,null,null);throw error;}
        finally {rendered.recycle();}
        ContentValues saved=new ContentValues();saved.put("status","exported");saved.put("exported",Math.max(System.currentTimeMillis(),draft.getLong("updated")));saved.put("export_uri",output.toString());getWritableDatabase().update("drafts",saved,"id=?",new String[]{draft.getString("id")});
        return new JSONObject().put("id",draft.getLong("id")).put("uri",output.toString()).put("name",name).put("requested_edge",requestedEdge).put("memory_edge",edge);
    }
    private boolean isDerived(File file){return file.isFile()&&file.getName().matches("[pd][0-9]+\\.webp(\\.tmp)?");}
    long cacheBudget(){long requested=context.getSharedPreferences("settings",0).getInt("cache_mb",128)*MB;long free=new StatFs(context.getCacheDir().getPath()).getAvailableBytes();return Math.max(0,Math.min(requested,(free-100*MB)/4));}
    void trimCache(){File[] files=context.getCacheDir().listFiles();if(files==null)return;Arrays.sort(files,Comparator.comparingLong(File::lastModified));long bytes=0;for(File f:files)if(isDerived(f))bytes+=f.length();long budget=cacheBudget();for(File f:files)if(bytes>budget&&isDerived(f)){long size=f.length();if(f.delete())bytes-=size;}}
    JSONObject storage() throws Exception {long bytes=0;File[] files=context.getCacheDir().listFiles();if(files!=null)for(File f:files)if(isDerived(f))bytes+=f.length();return new JSONObject().put("free",new StatFs(context.getFilesDir().getPath()).getAvailableBytes()).put("cache",bytes).put("budget",cacheBudget()).put("limit",context.getSharedPreferences("settings",0).getInt("cache_mb",128)).put("database",context.getDatabasePath("library.db").length());}

    private JSONObject stats(JSONObject args) throws Exception {
        String period=args.optString("period");if(!period.isEmpty()&&!period.matches("[0-9]{4}(-[0-9]{2})?"))throw new IOException("请选择年份或月份");
        TreeMap<String,Integer> lenses=new TreeMap<>(),focals=new TreeMap<>(),apertures=new TreeMap<>(),isos=new TreeMap<>(),shutters=new TreeMap<>(),months=new TreeMap<>(),cameras=new TreeMap<>();
        java.util.HashSet<String> days=new java.util.HashSet<>();int total=0;
        try(Cursor c=getReadableDatabase().rawQuery("SELECT date,exif FROM photos WHERE substr(date,1,?)=?",new String[]{Integer.toString(period.length()),period})) {
            while(c.moveToNext()){total++;String date=c.getString(0);JSONObject exif=new JSONObject(c.getString(1));if(date.length()>=10)days.add(date.substring(0,10));if(date.length()>=7)count(months,date.substring(0,7));count(lenses,exif.optString("lens"));count(cameras,exif.optString("camera"));if(exif.has("focal"))count(focals,Renderer.number(exif.getDouble("focal"))+"mm");if(exif.has("aperture"))count(apertures,"f/"+Renderer.number(exif.getDouble("aperture")));if(exif.has("iso"))count(isos,"ISO "+Renderer.number(exif.getDouble("iso")));if(exif.has("shutter"))count(shutters,Renderer.shutter(exif.getDouble("shutter")));}
        }
        return new JSONObject().put("total",total).put("days",days.size()).put("cameras",cameras.size()).put("lenses",new JSONObject(lenses)).put("focals",new JSONObject(focals)).put("apertures",new JSONObject(apertures)).put("isos",new JSONObject(isos)).put("shutters",new JSONObject(shutters)).put("months",new JSONObject(months));
    }
    private static void count(TreeMap<String,Integer> map,String value){if(!value.trim().isEmpty())map.merge(value,1,Integer::sum);}
    private JSONObject index() throws Exception {
        int success=0,failed=0;ImageLabeler labeler=ImageLabeling.getClient(new ImageLabelerOptions.Builder().setConfidenceThreshold(.25f).build());
        try(Cursor c=getReadableDatabase().rawQuery("SELECT id,uri FROM photos WHERE indexed=0",null)) {
            while(c.moveToNext()){
                Bitmap image=null;
                try{
                    image=decode(Uri.parse(c.getString(1)),640);List<ImageLabel> labels=Tasks.await(labeler.process(InputImage.fromBitmap(image,0)),60,TimeUnit.SECONDS);JSONArray values=new JSONArray();
                    for(ImageLabel label:labels)values.put(new JSONObject().put("text",label.getText()).put("score",label.getConfidence()));
                    ContentValues v=new ContentValues();v.put("labels",values.toString());v.put("indexed",1);getWritableDatabase().update("photos",v,"id=?",new String[]{c.getString(0)});success++;
                }catch(Exception ignored){failed++;}finally{if(image!=null)image.recycle();}
            }
        }finally{labeler.close();}
        return new JSONObject().put("success",success).put("failed",failed);
    }
    private JSONObject smart(JSONObject args) throws Exception {
        String query=bounded(args.getString("keywords"),500);String[] words=query.split("(?i)\\s+(?:AND|OR)\\s+|[,，;；]");boolean and=args.optString("mode","OR").equals("AND");double threshold=args.optDouble("threshold",.5);if(!Double.isFinite(threshold)||threshold<.25||threshold>1)throw new IOException("阈值须为 0.25–1");
        List<JSONObject> matches=new ArrayList<>();int indexed=0;
        try(Cursor c=getReadableDatabase().rawQuery("SELECT * FROM photos WHERE indexed=1",null)){
            while(c.moveToNext()){
                indexed++;JSONObject item=photo(c);double score=SmartLabels.score(item.getJSONArray("labels"),words,and);
                if(score>=threshold){item.put("score",score);matches.add(item);}
            }
        }
        matches.sort((a,b)->Double.compare(b.optDouble("score"),a.optDouble("score")));JSONArray rows=new JSONArray();
        for(int i=0;i<Math.min(200,matches.size());i++){JSONObject item=matches.get(i);addThumbnail(item,false);rows.put(item);}
        return new JSONObject().put("photos",rows).put("total",matches.size()).put("indexed",indexed);
    }
}
