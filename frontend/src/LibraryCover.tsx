import {useCallback, useEffect, useRef, useState} from 'react';
import {Aperture, ArrowDown, ArrowUpRight, Pause, Play, Shuffle} from 'lucide-react';
import {api, message} from './api';
import {bt} from './browser/text';
import {coverSequence} from './core/cover-sequence';
import MediaImage from './media/MediaImage';
import type {Photo} from './types';
import './library-cover.css';

const INTERVAL = 6500;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
type CoverFrame = {photo: Photo; key: number};

export default function LibraryCover({revision = 0, onOpen, onExplore, notify}: {
  revision?: number; onOpen: (photo: Photo) => void; onExplore: () => void; notify: (text: string) => void;
}) {
  const [photo, setPhoto] = useState<CoverFrame | null>(null);
  const [previous, setPrevious] = useState<CoverFrame | null>(null);
  const [pending, setPending] = useState<CoverFrame | null>(null);
  const [count, setCount] = useState(0), [busy, setBusy] = useState(false);
  const [reduced, setReduced] = useState(reducedMotion), [playing, setPlaying] = useState(() => !reducedMotion());
  const [visible, setVisible] = useState(true), [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const images = useRef<HTMLDivElement>(null), current = useRef<CoverFrame | null>(null), candidate = useRef<CoverFrame | null>(null);
  const frameKey = useRef(0);
  const ids = useRef<string[]>([]), failed = useRef(new Set<string>());
  const draw = useRef(coverSequence([])), controller = useRef<AbortController | null>(null), inFlight = useRef(false);
  const notifyRef = useRef(notify); notifyRef.current = notify;

  const next = useCallback(async () => {
    const own = controller.current;
    if (!own || own.signal.aborted || inFlight.current) return;
    const id = draw.current(failed.current, current.current?.photo.id);
    if (!id || (id === current.current?.photo.id && ids.current.filter(id => !failed.current.has(id)).length < 2)) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await api<{photos: Photo[]}>('/photos/by-ids', 'POST', {ids: [id]}, own.signal);
      if (own !== controller.current || own.signal.aborted) return;
      const value = result.photos.find(p => p.id === id);
      if (!value || !(value.preview_url || value.thumbnail_url)) {
        failed.current.add(id); setCount(ids.current.length - failed.current.size);
        inFlight.current = false; setBusy(false); void next(); return;
      }
      const frame = {photo: value, key: ++frameKey.current};
      candidate.current = frame; setPending(frame);
    } catch (error) {
      if (own !== controller.current || own.signal.aborted) return;
      inFlight.current = false; setBusy(false); setPlaying(false); notifyRef.current(message(error));
    }
  }, []);

  useEffect(() => {
    const own = new AbortController(); controller.current = own;
    inFlight.current = true; setBusy(true); candidate.current = null; setPending(null);
    void api<{ids: string[]}>('/photos/ids?count_mode=file', 'GET', undefined, own.signal).then(result => {
      if (own.signal.aborted) return;
      ids.current = [...new Set(result.ids)]; failed.current.clear();
      draw.current = coverSequence(ids.current, current.current?.photo.id);
      setCount(ids.current.length); inFlight.current = false; setBusy(false);
      if (!current.current || !ids.current.includes(current.current.photo.id)) {
        current.current = null; setPhoto(null); setPrevious(null); void next();
      }
    }).catch(error => {
      if (!own.signal.aborted) { inFlight.current = false; setBusy(false); setPlaying(false); notifyRef.current(message(error)); }
    });
    return () => own.abort();
  }, [revision, next]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => { setReduced(media.matches); if (media.matches) setPlaying(false); };
    const visibility = () => setHidden(document.hidden);
    const section = images.current?.closest('section');
    const focusIn = () => setFocused(true);
    const focusOut = (event: FocusEvent) => setFocused(!!event.relatedTarget && section?.contains(event.relatedTarget as Node) === true);
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), {threshold: .05});
    if (section) { observer.observe(section); section.addEventListener('focusin', focusIn); section.addEventListener('focusout', focusOut); }
    media.addEventListener('change', motion); document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); section?.removeEventListener('focusin', focusIn); section?.removeEventListener('focusout', focusOut); };
  }, []);
  useEffect(() => {
    if (!playing || reduced || hidden || !visible || focused || busy || count < 2 || !photo) return;
    const timer = setTimeout(() => void next(), INTERVAL);
    return () => clearTimeout(timer);
  }, [playing, reduced, hidden, visible, focused, busy, count, photo, next]);
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), reduced ? 0 : 1100);
    return () => clearTimeout(timer);
  }, [previous, reduced]);

  const unavailable = useCallback((frame: CoverFrame) => {
    if (candidate.current?.key !== frame.key || controller.current?.signal.aborted) return;
    failed.current.add(frame.photo.id); setCount(ids.current.length - failed.current.size);
    candidate.current = null; setPending(null); inFlight.current = false; setBusy(false); void next();
  }, [next]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => unavailable(pending), 15000);
    return () => clearTimeout(timer);
  }, [pending, unavailable]);
  function ready(value: CoverFrame) {
    if (candidate.current?.key !== value.key || controller.current?.signal.aborted) return;
    setPrevious(reduced ? null : current.current); current.current = value; setPhoto(value);
    candidate.current = null; setPending(null); inFlight.current = false; setBusy(false);
  }

  return <>
    <div className="library-cover-images" ref={images} aria-hidden="true">
      {[previous, photo, pending].filter((p): p is CoverFrame => !!p).map(value => <MediaImage
        key={value.key} className={value.key === photo?.key ? 'active' : ''}
        src={value.photo.preview_url || value.photo.thumbnail_url} alt="" fetchPriority="high"
        onLoad={() => ready(value)} onError={() => unavailable(value)}/>) }
      {!photo && <div className="library-cover-empty"><Aperture size={200} strokeWidth={.4}/></div>}
    </div>
    <div className="library-cover-bottom" data-glass-exclude>
      <button className="cover-explore" onClick={onExplore}>{bt('探索影集', 'Explore collections')}<ArrowDown size={16}/></button>
      {photo && <button className="library-cover-credit" onClick={() => onOpen(photo.photo)}><span>{photo.photo.file_name}</span><ArrowUpRight size={15}/></button>}
      {count > 1 && <div className="library-cover-controls">
        <button aria-disabled={busy} onClick={() => {if (!busy) void next();}} aria-label={bt('随机切换封面', 'Show another cover')} title={bt('随机切换封面', 'Show another cover')}><Shuffle size={17}/></button>
        {!reduced && <button onClick={() => setPlaying(value => !value)} aria-label={bt(playing ? '暂停封面轮播' : '播放封面轮播', playing ? 'Pause cover slideshow' : 'Play cover slideshow')} title={bt(playing ? '暂停封面轮播' : '播放封面轮播', playing ? 'Pause cover slideshow' : 'Play cover slideshow')}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button>}
      </div>}
    </div>
  </>;
}
