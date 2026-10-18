"""Native file picker; deliberately opens only following an explicit UI action."""
import json
import sys

FILTER = ('照片', '*.jpg *.jpeg *.png *.tif *.tiff *.heic *.heif *.arw *.cr2 *.cr3 *.nef *.raf *.dng *.orf *.rw2 *.pef *.webp *.avif')


def select_paths(kind: str) -> list[str]:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return _qt_paths(kind)
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    if kind == 'directory':
        selected = filedialog.askdirectory(title='选择照片目录（原图保留在原位置）')
        result = [selected] if selected else []
    else:
        result = list(filedialog.askopenfilenames(title='选择原始照片', filetypes=[FILTER, ('所有文件', '*.*')]))
    root.destroy()
    return result


def _qt_paths(kind: str) -> list[str]:
    """Frozen Linux builds have no tkinter; PyQt6 already ships with the window backend."""
    from PyQt6.QtWidgets import QApplication, QFileDialog
    app = QApplication.instance() or QApplication([])
    dialog = QFileDialog()
    dialog.setWindowTitle('选择照片目录（原图保留在原位置）' if kind == 'directory' else '选择原始照片')
    if kind == 'directory':
        dialog.setFileMode(QFileDialog.FileMode.Directory)
    else:
        dialog.setFileMode(QFileDialog.FileMode.ExistingFiles)
        dialog.setNameFilters([' '.join(FILTER), '所有文件 (*)'])
    selected = dialog.selectedFiles() if dialog.exec() else []
    del app
    return selected


def main() -> None:
    print(json.dumps(select_paths(sys.argv[1])))

if __name__ == '__main__':
    main()
