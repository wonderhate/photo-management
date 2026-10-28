"""Copy-only OLE drag on the existing WebView2 window's STA UI thread.

The caller supplies paths resolved from registered photo IDs, never page paths.
An independent STA worker did not reliably participate in the window's drag
gesture. All COM data and the drag loop therefore live on the owner form.
"""
import ctypes
import threading
import time

from fastapi import HTTPException


class NativeFileDrag:
    def __init__(self, control, timeout=60):
        self.control = control
        self.timeout = timeout
        self._active = threading.Lock()

    def __call__(self, paths):
        from System import Action, Array, Byte, String
        from System.IO import MemoryStream
        from System.Windows.Forms import Application, DataObject, DataFormats, DragAction, DragDropEffects, Timer
        if not self._active.acquire(blocking=False):
            raise HTTPException(409, '另一个文件传递正在进行')

        finished = threading.Event()
        cancelled = threading.Event()
        deadline = time.monotonic() + self.timeout
        outcome = {'status': 'cancelled', 'count': len(paths), 'effect': 'copy'}

        def perform():
            timer = None
            bound = False

            def continue_drag(sender, event):
                if cancelled.is_set() or time.monotonic() >= deadline:
                    event.Action = DragAction.Cancel

            def expire(sender, event):
                timer.Stop()
                cancelled.set()
                # Wake OLE's input loop with a cancellation message addressed
                # only to this UI thread. Releasing capture alone does not wake
                # its QueryContinueDrag callback when the mouse is stationary.
                # This is not global keyboard injection (no SendInput).
                ctypes.windll.user32.PostThreadMessageW(
                    ctypes.windll.kernel32.GetCurrentThreadId(), 0x0100, 0x1B, 0)

            try:
                foreground = ctypes.windll.user32.GetForegroundWindow
                foreground.restype = ctypes.c_void_p
                if (cancelled.is_set() or time.monotonic() >= deadline
                        or self.control.IsDisposed
                        or foreground() != self.control.Handle.ToInt64()
                        or not ctypes.windll.user32.GetAsyncKeyState(1) & 0x8000):
                    return
                Application.OleRequired()
                data = DataObject()
                data.SetData(DataFormats.FileDrop, True, Array[String](paths))
                data.SetData('Preferred DropEffect', MemoryStream(Array[Byte]([1, 0, 0, 0])))
                self.control.QueryContinueDrag += continue_drag
                bound = True
                timer = Timer()
                timer.Interval = max(1, int((deadline - time.monotonic()) * 1000))
                timer.Tick += expire
                timer.Start()
                result = self.control.DoDragDrop(data, DragDropEffects.Copy)
                if result == DragDropEffects.Copy:
                    outcome['status'] = 'copied'
            except Exception:
                outcome['error'] = True
            finally:
                try:
                    if timer is not None:
                        timer.Stop()
                        timer.Dispose()
                    if bound:
                        self.control.QueryContinueDrag -= continue_drag
                finally:
                    self._active.release()
                    finished.set()

        try:
            if self.control.IsDisposed or not self.control.IsHandleCreated:
                raise RuntimeError('Desktop window is unavailable')
            # Retain the delegate in this request until completion. BeginInvoke
            # leaves the HTTP worker free of the window message pump.
            callback = Action(perform)
            self.control.BeginInvoke(callback)
        except Exception as error:
            self._active.release()
            raise HTTPException(503, '系统文件传递不可用，请下载或复制路径') from error
        if not finished.wait(self.timeout + 2):
            cancelled.set()
            # If the window is busy, its queued callback must observe cancelled
            # and finish before a later request can start another drag.
            raise HTTPException(408, '拖出尚未结束，请释放鼠标或按 Esc 取消')
        if outcome.pop('error', False):
            raise HTTPException(503, '系统文件传递失败，请下载或复制路径')
        return outcome
