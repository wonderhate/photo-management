from types import SimpleNamespace
import sys
from desktop.launcher import follow_browser_fullscreen

def test_browser_fullscreen_enters_and_restores_the_native_window(monkeypatch):
    monkeypatch.setitem(sys.modules,'System',SimpleNamespace(Action=lambda callback:callback))
    class Event:
        def __init__(self):self.handlers=[]
        def __iadd__(self,handler):self.handlers.append(handler);return self
        def fire(self):
            for handler in self.handlers:handler(None,None)
    core=SimpleNamespace(ContainsFullScreenElement=False,ContainsFullScreenElementChanged=Event())
    native=SimpleNamespace(webview=SimpleNamespace(CoreWebView2=core),is_fullscreen=False,Invoke=lambda callback:callback())
    transitions=[]
    def toggle():
        native.is_fullscreen=not native.is_fullscreen;transitions.append(native.is_fullscreen)
    native.toggle_fullscreen=toggle
    window=SimpleNamespace(native=native)
    follow_browser_fullscreen(window);follow_browser_fullscreen(window)
    assert len(core.ContainsFullScreenElementChanged.handlers)==1
    core.ContainsFullScreenElement=True;core.ContainsFullScreenElementChanged.fire();core.ContainsFullScreenElementChanged.fire()
    assert native.is_fullscreen and transitions==[True]
    core.ContainsFullScreenElement=False;core.ContainsFullScreenElementChanged.fire()
    assert not native.is_fullscreen and transitions==[True,False]
