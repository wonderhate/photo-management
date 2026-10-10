import importlib.util
import ast
from pathlib import Path
from sqlalchemy import select
from ..models import Session, Photo, Tag, PhotoTag, now

PLUGINS = Path(__file__).resolve().parents[3] / 'plugins'

class PluginContext:
    def __init__(self, params: dict) -> None:
        self.params = params
        self.log: list[str] = []
        self.session = Session()

    def message(self, text) -> None:
        self.log.append(str(text))

    def photos(self, limit: int = 500, offset: int = 0, **filters) -> list[dict]:
        from . import library_service
        q = library_service.query_photos({k: v for k, v in filters.items() if v not in (None, '')}, 'capture')
        with Session() as session:
            photos = session.scalars(q.order_by(Photo.id).offset(max(0,int(offset))).limit(max(1, min(int(limit), 2000)))).all()
            return [dict(id=p.id, file_name=p.file_name, file_path=p.file_path, camera_model=p.camera_model,
                         lens_model=p.lens_model, focal_length=p.focal_length, f_number=p.f_number, iso=p.iso,
                         date_taken=p.date_taken, favorite=p.favorite, rating=p.rating, color_label=p.color_label,
                         is_raw=p.is_raw) for p in photos]

    def update(self, photo_id: str, favorite=None, rating=None, color_label=None, add_tags=None) -> None:
        from ..schemas import PhotoUpdate
        from .library_service import set_tags
        validated=PhotoUpdate(favorite=favorite,rating=rating,color_label=color_label,tags=add_tags)
        session=self.session
        with session.begin_nested():
            photo = session.get(Photo, photo_id)
            if not photo:
                raise ValueError(f'照片不存在：{photo_id}')
            if favorite is not None:
                photo.favorite = bool(favorite)
            if rating is not None:
                photo.rating = validated.rating
            if color_label is not None:
                photo.color_label = None if validated.color_label=='none' else validated.color_label
            if add_tags:
                existing=session.scalars(select(Tag.name).join(PhotoTag).where(PhotoTag.photo_id==photo.id)).all()
                set_tags(session,photo,existing+validated.tags)
            photo.updated_at = now()
            session.flush()

def _load(path: Path):
    spec = importlib.util.spec_from_file_location('photo_plugin_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def discover() -> list[dict]:
    PLUGINS.mkdir(exist_ok=True)
    result = []
    for path in sorted(PLUGINS.glob('*.py')):
        if path.name.startswith('_'):
            continue
        try:
            module = ast.parse(path.read_text('utf-8-sig'))
        except Exception as error:
            result.append(dict(name=path.stem, description=f'加载失败：{error}', error=True))
            continue
        if not any(isinstance(node,ast.FunctionDef) and node.name=='run' for node in module.body):
            continue
        doc = (ast.get_docstring(module) or '').strip().splitlines()
        result.append(dict(name=path.stem, description=doc[0] if doc else path.stem))
    return result

def run(name: str, params: dict) -> dict:
    if name not in {p['name'] for p in discover()}:
        raise ValueError('插件不存在')
    module = _load(PLUGINS / f'{name}.py')
    context = PluginContext(params or {})
    try:
        # Begin the outer transaction before any SAVEPOINT used by ctx.update.
        context.session.connection().exec_driver_sql('BEGIN')
        result = module.run(context, **(params or {}))
        context.session.commit()
    except Exception:
        context.session.rollback()
        raise
    finally:
        context.session.close()
    return {'ok': True, 'result': '' if result is None else str(result), 'log': context.log}
