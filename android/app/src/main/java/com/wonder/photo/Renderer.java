package com.wonder.photo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class Renderer {
    public static JSONObject defaults() throws Exception {
        return new JSONObject("{\"type\":\"frame\",\"theme\":\"white\",\"border\":5,\"panel\":18,\"font\":2.4,\"align\":\"left\",\"radius\":0,\"blur\":50,\"strength\":0.8,\"brightness\":0.7,\"saturation\":1.15,\"scale\":0.8,\"shadow\":true,\"signature\":\"\",\"fields\":[\"make\",\"camera\",\"lens\",\"focal\",\"aperture\",\"shutter\",\"iso\"]}");
    }
    public static JSONObject validate(JSONObject input) throws Exception {
        JSONObject result=defaults();
        if(!input.optString("type","frame").matches("frame|ambient"))throw new IOException("不支持的水印类型");
        if(!input.optString("theme","white").matches("white|black|auto"))throw new IOException("不支持的相框颜色");
        if(!input.optString("align","left").matches("left|center|right"))throw new IOException("不支持的文字对齐");
        for(String key:new String[]{"type","theme","align","signature"})if(input.has(key))result.put(key,input.getString(key));
        if(result.getString("signature").length()>120)throw new IOException("署名最多 120 字");
        String[] names={"border","panel","font","radius","blur","strength","brightness","saturation","scale"};
        double[] lower={0,10,1,0,0,0,.2,0,.6},upper={20,40,5,100,100,1,1.8,2,.9};
        for(int i=0;i<names.length;i++)if(input.has(names[i])){double value=input.getDouble(names[i]);if(!Double.isFinite(value)||value<lower[i]||value>upper[i])throw new IOException("参数范围无效："+names[i]);result.put(names[i],value);}
        if(input.has("shadow"))result.put("shadow",input.getBoolean("shadow"));
        if(input.has("fields")) {
            JSONArray fields=input.getJSONArray("fields"),clean=new JSONArray();
            for(int i=0;i<fields.length();i++){String key=fields.getString(i);if(!key.matches("make|camera|lens|focal|aperture|shutter|iso|date"))throw new IOException("无效 EXIF 字段");if(!clean.toString().contains("\""+key+"\""))clean.put(key);}
            result.put("fields",clean);
        }return result;
    }
    public static String number(double value){return value==Math.rint(value)?Long.toString(Math.round(value)):String.format(Locale.ROOT,"%.1f",value);}
    public static String shutter(double seconds){return seconds<1?"1/"+Math.round(1/seconds)+" s":number(seconds)+" s";}
    public static List<String> text(JSONObject exif,JSONObject settings) throws Exception {
        JSONArray fields=settings.getJSONArray("fields");List<String> headings=new ArrayList<>(),params=new ArrayList<>();
        for(int i=0;i<fields.length();i++){String key=fields.getString(i);if(!exif.has(key)||exif.optString(key).trim().isEmpty())continue;
            switch(key){case "focal"->params.add(number(exif.getDouble(key))+" mm");case "aperture"->params.add("f/"+number(exif.getDouble(key)));case "shutter"->params.add(shutter(exif.getDouble(key)));case "iso"->params.add("ISO "+number(exif.getDouble(key)));default->headings.add(exif.getString(key));}
        }
        if(!params.isEmpty())headings.add(String.join(" · ",params));
        if(!settings.optString("signature").trim().isEmpty())headings.add(settings.getString("signature"));
        return headings;
    }
    public static Bitmap render(Bitmap photo,JSONObject exif,JSONObject input) throws Exception {
        JSONObject settings=validate(input);boolean ambient=settings.getString("type").equals("ambient");
        int width=photo.getWidth(),height=photo.getHeight();
        float margin=ambient?width*(float)(1/settings.getDouble("scale")-1)/2:width*(float)settings.getDouble("border")/100;
        float font=width*(float)settings.getDouble("font")/100;
        List<String> lines=text(exif,settings);float panel=Math.max(width*(float)settings.getDouble("panel")/100,lines.size()*font*1.55f+font*2);
        int canvasWidth=Math.max(1,Math.round(width+2*margin)),canvasHeight=Math.max(1,Math.round(height+2*margin+panel));
        Bitmap output=Bitmap.createBitmap(canvasWidth,canvasHeight,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(output);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
        boolean dark=settings.getString("theme").equals("black");
        if(settings.getString("theme").equals("auto")){int color=photo.getPixel(width/2,height/2);dark=(Color.red(color)*.299+Color.green(color)*.587+Color.blue(color)*.114)<128;}
        if(ambient) {
            Bitmap background=Bitmap.createScaledBitmap(photo,80,Math.max(1,Math.min(512,80*height/width)),true);
            blur(background,(int)Math.round(settings.getDouble("blur")/6));
            ColorMatrix matrix=new ColorMatrix();matrix.setSaturation((float)settings.getDouble("saturation"));float brightness=(float)settings.getDouble("brightness");
            matrix.postConcat(new ColorMatrix(new float[]{brightness,0,0,0,0,0,brightness,0,0,0,0,0,brightness,0,0,0,0,0,1,0}));paint.setColorFilter(new ColorMatrixColorFilter(matrix));
            float ratio=Math.max((float)canvasWidth/background.getWidth(),(float)canvasHeight/background.getHeight());float bw=background.getWidth()*ratio,bh=background.getHeight()*ratio;
            canvas.drawBitmap(background,null,new RectF((canvasWidth-bw)/2,(canvasHeight-bh)/2,(canvasWidth+bw)/2,(canvasHeight+bh)/2),paint);background.recycle();paint.setColorFilter(null);
            canvas.drawColor(Color.argb((int)((1-settings.getDouble("strength"))*180),0,0,0));dark=true;
        } else canvas.drawColor(dark?0xff111315:Color.WHITE);
        RectF rect=new RectF(margin,margin,margin+width,margin+height);float radius=width*(float)settings.getDouble("radius")/1000;
        if(ambient&&settings.getBoolean("shadow")){paint.setColor(Color.BLACK);paint.setShadowLayer(width*.018f,0,width*.013f,0xaa000000);canvas.drawRoundRect(rect,radius,radius,paint);paint.clearShadowLayer();}
        canvas.save();Path clip=new Path();clip.addRoundRect(rect,radius,radius,Path.Direction.CW);canvas.clipPath(clip);canvas.drawBitmap(photo,null,rect,paint);canvas.restore();
        paint.setColor(dark?0xffeeeeee:0xff24262a);paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));paint.setTextSize(font);
        String align=settings.getString("align");paint.setTextAlign(align.equals("center")?Paint.Align.CENTER:align.equals("right")?Paint.Align.RIGHT:Paint.Align.LEFT);
        float x=align.equals("center")?canvasWidth/2f:align.equals("right")?canvasWidth-Math.max(margin,font):Math.max(margin,font);
        float y=margin+height+(panel-lines.size()*font*1.55f)/2+font;
        for(int i=0;i<lines.size();i++) {
            String line=lines.get(i);paint.setTypeface(Typeface.create("sans-serif",i==0?Typeface.BOLD:Typeface.NORMAL));paint.setTextSize(i==0?font*1.08f:font);
            while(paint.measureText(line)>canvasWidth-2*Math.max(margin,font)&&line.length()>1)line=line.substring(0,line.length()-1);
            canvas.drawText(line,x,y,paint);y+=font*1.55f;
        }return output;
    }
    // Three box passes approximate Gaussian blur on a tiny color background, independent of GPU/API.
    static void blur(Bitmap bitmap,int radius){if(radius==0)return;int w=bitmap.getWidth(),h=bitmap.getHeight();int[] src=new int[w*h],dst=new int[w*h];bitmap.getPixels(src,0,w,0,0,w,h);
        for(int pass=0;pass<3;pass++)for(int axis=0;axis<2;axis++){
            for(int y=0;y<h;y++)for(int x=0;x<w;x++){int r=0,g=0,b=0,n=0;for(int d=-radius;d<=radius;d++){int nx=axis==0?Math.max(0,Math.min(w-1,x+d)):x,ny=axis==1?Math.max(0,Math.min(h-1,y+d)):y;int c=src[ny*w+nx];r+=Color.red(c);g+=Color.green(c);b+=Color.blue(c);n++;}dst[y*w+x]=Color.rgb(r/n,g/n,b/n);}
            int[] swap=src;src=dst;dst=swap;
        }bitmap.setPixels(src,0,w,0,0,w,h);
    }
}
