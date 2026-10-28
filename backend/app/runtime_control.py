"""A managed launcher may restart itself; ordinary uvicorn processes cannot be killed here."""
from threading import RLock, Timer
from uuid import uuid4

session_id=str(uuid4())
library_id=None


def bind_library(identity):
    global library_id
    library_id=identity

_lock=RLock()
_restart=None
_switching=False
_mutations=0
_maintenance=False


def install(restart):
    global _restart
    with _lock:_restart=restart


def snapshot():
    with _lock:return {'managed_restart':_restart is not None,'switching':_switching}


def enter_mutation():
    global _mutations
    with _lock:
        if _switching:raise ValueError('正在切换图库，请等待重新打开')
        if _maintenance:raise ValueError('Library maintenance is active. Try again after it finishes.')
        _mutations+=1


def leave_mutation():
    global _mutations
    with _lock:_mutations-=1


def begin_switch():
    global _switching
    with _lock:
        if _restart is None:raise ValueError('当前服务需由原启动方式重新启动，已保存的图库选择会在下次启动生效')
        if _switching:raise ValueError('正在切换图库，请等待重新打开')
        if _mutations:raise ValueError('请等待正在保存的操作结束，再切换图库')
        if _maintenance:raise ValueError('Library maintenance is active. Try again after it finishes.')
        _switching=True


def release_switch():
    global _switching
    with _lock:_switching=False


def request_restart():
    with _lock:
        callback=_restart
        if not _switching or callback is None:raise ValueError('重启控制不可用')
    # Let the response finish before the managed window/server shuts down.
    timer=Timer(.4,callback);timer.daemon=True;timer.start()


from contextlib import contextmanager

@contextmanager
def maintenance():
    """The calling API request already owns one mutation admission."""
    global _maintenance
    with _lock:
        if _switching or _maintenance or _mutations>1:raise ValueError('Wait for other saves before recycling files.')
        _maintenance=True
    try:yield
    finally:
        with _lock:_maintenance=False
