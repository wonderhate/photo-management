package com.wonder.photo;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Locale;
import java.util.Map;

/** Bundled ML Kit visual labels, not filename searching or desktop CLIP embeddings. */
public final class SmartLabels {
    private static final Map<String,String[]> WORDS=new java.util.HashMap<>();
    static {
        WORDS.put("日落",new String[]{"Sunset"});
        WORDS.put("晚霞",new String[]{"Sunset"});
        WORDS.put("海边",new String[]{"Beach","Sea","Ocean","Coast"});
        WORDS.put("海",new String[]{"Sea","Ocean"});
        WORDS.put("沙滩",new String[]{"Beach"});
        WORDS.put("猫",new String[]{"Cat"});
        WORDS.put("狗",new String[]{"Dog"});
        WORDS.put("花",new String[]{"Flower","Petal"});
        WORDS.put("森林",new String[]{"Forest","Tree","Jungle"});
        WORDS.put("建筑",new String[]{"Building","Architecture","Skyscraper"});
        WORDS.put("城市",new String[]{"City","Skyline","Skyscraper"});
        WORDS.put("夜景",new String[]{"Night","Skyline"});
        WORDS.put("人像",new String[]{"Person","Face","Selfie","Portrait"});
        WORDS.put("山",new String[]{"Mountain","Hill"});
        WORDS.put("雪",new String[]{"Snow"});
        WORDS.put("雨",new String[]{"Rain"});
        WORDS.put("咖啡",new String[]{"Coffee","Cafe"});
        WORDS.put("食物",new String[]{"Food","Cuisine","Dish"});
        WORDS.put("天空",new String[]{"Sky","Cloud"});
        WORDS.put("街头",new String[]{"Street","Road","City"});
        WORDS.put("汽车",new String[]{"Car","Vehicle"});
        WORDS.put("鸟",new String[]{"Bird"});
        WORDS.put("水",new String[]{"Water","Lake","River"});
        WORDS.put("绿",new String[]{"Plant","Vegetation","Grass"});
        WORDS.put("蓝调时刻",new String[]{"Sky","Night"});
    }
    public static double score(JSONArray labels,String[] words,boolean and) throws Exception {
        double result=and?1:0;boolean any=false;
        for(String word:words){word=word.trim();if(word.isEmpty())continue;any=true;String[] names=WORDS.getOrDefault(word,new String[]{word});double best=0;
            for(int i=0;i<labels.length();i++){JSONObject label=labels.getJSONObject(i);String text=label.getString("text").toLowerCase(Locale.ROOT);
                for(String name:names)if(text.equals(name.toLowerCase(Locale.ROOT)))best=Math.max(best,label.getDouble("score"));
            }
            result=and?Math.min(result,best):Math.max(result,best);
        }return any?result:0;
    }
}
