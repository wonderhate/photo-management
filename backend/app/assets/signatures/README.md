# Signature assets

`natural.png` is the user's original transparent lowercase `wonder` artwork, copied without modification from the supplied reference. The original local source is retained outside version control. Reference: https://chatgpt.com/s/cx_6acc354321088191938e025c84b9e91a .

Seven unmodified fonts are bundled from Google Fonts, each with its SIL Open Font License 1.1 and original copyright notice:

- Fine handwriting: Sacramento, https://github.com/google/fonts/tree/main/ofl/sacramento
- Brush script: Kaushan Script, https://github.com/google/fonts/tree/main/ofl/kaushanscript
- Classic calligraphy: Alex Brush, https://github.com/google/fonts/tree/main/ofl/alexbrush
- Chinese brush: Ma Shan Zheng, https://github.com/google/fonts/tree/main/ofl/mashanzheng
- Chinese running script: Zhi Mang Xing, https://github.com/google/fonts/tree/main/ofl/zhimangxing
- Chinese cursive: Liu Jian Mao Cao, https://github.com/google/fonts/tree/main/ofl/liujianmaocao
- Chinese handwriting: Long Cang, https://github.com/google/fonts/tree/main/ofl/longcang

Runtime rendering uses these local assets. No font installation or external connection is required. The original artwork remains a fixed `wonder` signature. Chinese styles support editable common Chinese and Latin text; individual uncovered characters use the existing system typeface while the remaining text retains the selected calligraphy. Latin styles keep their previous fallback for other scripts.

The supplied calligraphy research informed the style direction. Commercial candidates are not bundled: the official [Ye Gen You license notice](https://www.yegenyou.com/font-detail-10-1-.htm) restricts third-party redistribution, and [FounderType](https://www.foundertype.com/index.php/FontInfo/index/id/270) requires a software embedding license. The OFL families above are independently named alternatives, not those commercial fonts.
