"""Read-only directory metadata for the paired phone's computer file picker."""
import os
from pathlib import Path
from fastapi import HTTPException
from .config import EXTENSIONS

PAGE_SIZE = 200


def browse(path: str = '', directories_only: bool = False, page: int = 1) -> dict:
    if page < 1 or len(path) > 4096 or '\0' in path:
        raise HTTPException(400, '电脑路径或分页参数无效')
    if not path:
        roots = [Path.home()]
        if os.name == 'nt':
            import ctypes
            drives = ctypes.windll.kernel32.GetLogicalDrives()
            roots += [Path(f'{chr(65 + i)}:/') for i in range(26) if drives & (1 << i)]
        else:
            roots.append(Path('/'))
        return {'path': '', 'parent': None, 'entries': [
            {'name': '用户文件夹' if i == 0 else str(root), 'path': str(root), 'directory': True}
            for i, root in enumerate(roots)], 'page': 1, 'pages': 1, 'total': len(roots)}
    candidate = Path(path)
    if not candidate.is_absolute() or path.startswith(('\\\\', '//')):
        raise HTTPException(400, '请输入电脑上的本地绝对路径')
    try:
        folder = candidate.resolve(strict=True)
        if str(folder).startswith('\\\\'):
            raise HTTPException(400, '请输入电脑上的本地绝对路径')
        if not folder.is_dir():
            raise HTTPException(400, '请选择电脑上的文件夹')
        entries = []
        with os.scandir(folder) as children:
            for child in children:
                try:
                    directory = child.is_dir()
                    if directory or (not directories_only and Path(child.name).suffix.lower() in EXTENSIONS and child.is_file()):
                        entries.append({'name': child.name, 'path': child.path, 'directory': directory})
                except OSError:
                    continue  # A single inaccessible/disappearing entry does not hide the directory.
        # ponytail: sort one directory in memory; use an indexed listing if million-entry folders become common.
        entries.sort(key=lambda entry: (not entry['directory'], entry['name'].casefold()))
        pages = max(1, (len(entries) + PAGE_SIZE - 1) // PAGE_SIZE)
        page = min(page, pages)
        return {'path': str(folder), 'parent': str(folder.parent) if folder.parent != folder else '',
                'entries': entries[(page - 1) * PAGE_SIZE:page * PAGE_SIZE],
                'page': page, 'pages': pages, 'total': len(entries)}
    except FileNotFoundError:
        raise HTTPException(404, '电脑上的文件夹不存在') from None
    except PermissionError:
        raise HTTPException(400, '电脑上的文件夹无法访问') from None
    except (OSError, RuntimeError):
        raise HTTPException(400, '无法读取电脑上的文件夹') from None
