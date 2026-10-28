"""Windows change notifications are hints; periodic enumeration remains authoritative."""
import os
from pathlib import Path


class DirectoryHints:
    def __init__(self):
        self.handles = {}
        self.kernel = None
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            self.kernel.FindFirstChangeNotificationW.argtypes = [wintypes.LPCWSTR,wintypes.BOOL,wintypes.DWORD]
            self.kernel.FindFirstChangeNotificationW.restype = wintypes.HANDLE
            self.kernel.FindNextChangeNotification.argtypes = [wintypes.HANDLE]
            self.kernel.FindNextChangeNotification.restype = wintypes.BOOL
            self.kernel.FindCloseChangeNotification.argtypes = [wintypes.HANDLE]
            self.kernel.FindCloseChangeNotification.restype = wintypes.BOOL
            self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE,wintypes.DWORD]
            self.kernel.WaitForSingleObject.restype = wintypes.DWORD
            self.invalid = ctypes.c_void_p(-1).value

    def poll(self, paths):
        if self.kernel is None:return False
        changed = False
        for path, handle in list(self.handles.items()):
            if path not in paths:
                self.kernel.FindCloseChangeNotification(handle);del self.handles[path]
        for path in paths:
            if path not in self.handles:
                if not Path(path).is_dir():continue
                handle = self.kernel.FindFirstChangeNotificationW(path,True,0x01|0x02|0x08|0x10)
                if handle and handle != self.invalid:self.handles[path]=handle
                continue
            handle=self.handles[path]
            result=self.kernel.WaitForSingleObject(handle,0)
            if result==0:
                changed=True
                if self.kernel.FindNextChangeNotification(handle):continue
            elif result==258:continue
            self.kernel.FindCloseChangeNotification(handle);del self.handles[path]
        return changed

    def close(self):
        if self.kernel:
            for handle in self.handles.values():self.kernel.FindCloseChangeNotification(handle)
        self.handles.clear()
