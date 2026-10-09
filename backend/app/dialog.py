"""Native file picker; deliberately opens only following an explicit UI action."""
import json
import sys
import tkinter as tk
from tkinter import filedialog

def main() -> None:
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    if sys.argv[1] == 'directory':
        selected = filedialog.askdirectory(title='选择照片目录（原图保留在原位置）')
        result = [selected] if selected else []
    else:
        result = list(filedialog.askopenfilenames(title='选择原始照片', filetypes=[('照片', '*.jpg *.jpeg *.png *.tif *.tiff *.heic *.heif *.arw *.cr2 *.cr3 *.nef *.raf *.dng *.orf *.rw2 *.pef *.webp *.avif'), ('所有文件', '*.*')]))
    root.destroy()
    print(json.dumps(result))

if __name__ == '__main__':
    main()
