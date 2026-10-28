"""Windows copy-only shell transfers, restricted to registered library records."""
import importlib.util
import os
import sys
import threading
from pathlib import Path
from fastapi import HTTPException
from ..models import Photo, Session

_transfer_lock = threading.Lock()
_native_drag = None


def install_native_drag(handler):
    """Installed only by the desktop host after its native window is ready."""
    global _native_drag
    _native_drag = handler


def supported():
    # pythonnet replaces its bootstrap module with a CLR module whose __spec__
    # is None. find_spec would raise after the first successful transfer.
    return os.name == 'nt' and ('clr' in sys.modules or importlib.util.find_spec('clr') is not None)


def drag_supported():
    return supported() and _native_drag is not None


def registered_photo_paths(ids: list[str]) -> list[str]:
    # There is deliberately no public API accepting a filesystem path.
    with Session() as session:
        paths = []
        for id in ids:
            row = session.get(Photo, id)
            if row is None:
                raise HTTPException(404, '照片不存在')
            path = Path(row.file_path)
            if not path.is_file():
                raise HTTPException(404, '原图已移动或删除')
            resolved = path.resolve(strict=True)
            # Network files may not have been explicitly authorized on this machine.
            if str(resolved).startswith('\\\\'):
                raise HTTPException(422, '文件传递仅支持已登记的本机原片')
            paths.append(str(resolved))
        return list(dict.fromkeys(paths))


def transfer(paths: list[str], action: str):
    if action not in ('copy', 'drag'):
        raise HTTPException(422, '文件传递仅支持复制或拖出副本')
    if action == 'drag' and not drag_supported():
        raise HTTPException(501, '当前环境不支持系统文件传递，请下载或复制路径')
    if not supported():
        raise HTTPException(501, '当前环境不支持系统文件传递，请下载或复制路径')
    if not _transfer_lock.acquire(blocking=False):
        raise HTTPException(409, '另一个文件传递正在进行')
    if action == 'drag':
        try:
            handler = _native_drag
            if handler is None:
                raise HTTPException(503, '系统文件传递不可用，请下载或复制路径')
            return handler(paths)
        finally:
            _transfer_lock.release()
    finished = threading.Event()
    outcome = {}
    try:
        import clr
        clr.AddReference('System.Windows.Forms')
        from System.Threading import Thread, ThreadStart, ApartmentState

        def run():
            try:
                from System import Array, String, Byte
                from System.IO import MemoryStream
                from System.Windows.Forms import Application, Clipboard, DataObject, DataFormats
                Application.OleRequired()
                data = DataObject()
                data.SetData(DataFormats.FileDrop, True, Array[String](paths))
                # Copy is the only offered effect. Shift/target negotiation cannot move originals.
                data.SetData('Preferred DropEffect', MemoryStream(Array[Byte]([1, 0, 0, 0])))
                Clipboard.SetDataObject(data, True, 5, 100)
                outcome['status'] = 'copied'
            except Exception:
                outcome['error'] = True
            finally:
                _transfer_lock.release(); finished.set()

        worker = Thread(ThreadStart(run))
        worker.SetApartmentState(ApartmentState.STA)
        worker.IsBackground = True
        worker.Start()
    except Exception as error:
        _transfer_lock.release()
        raise HTTPException(503, '系统文件传递不可用，请下载或复制路径') from error
    if not finished.wait(60):
        raise HTTPException(408, '拖出尚未结束，请释放鼠标或按 Esc 取消')
    if outcome.get('error'):
        raise HTTPException(503, '系统文件传递失败，请下载或复制路径')
    return {'status': outcome['status'], 'count': len(paths), 'effect': 'copy'}
