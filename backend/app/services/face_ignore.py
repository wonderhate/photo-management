"""Source- and model-bound negative observations, without application imports."""
import hashlib
import json
import math

def valid_box(bounds):
    if not isinstance(bounds,dict):return False
    values=[bounds.get(key) for key in ('left','top','right','bottom')]
    if not all(type(v) in (int,float) and math.isfinite(v) and 0<=v<=1 for v in values):return False
    return values[0]<values[2] and values[1]<values[3]

def observation_key(source_hash,space,encoding,location):
    return hashlib.sha256(json.dumps([1,source_hash,space,encoding.hex(),location],ensure_ascii=True,
        sort_keys=True,separators=(',',':')).encode()).hexdigest()

def member(person_id,source_hash,space,encoding,location,confirmed,created_at):
    return dict(person_id=person_id,source_hash=source_hash,model_space=space,
        observation_key=observation_key(source_hash,space,encoding,location),encoding=encoding,
        location=location,confirmed=confirmed,created_at=created_at)

def matches(saved,face,dimensions):
    # The caller first restricts records to the exact photo content and model space.
    a,b=saved.location,face['location']
    if not valid_box(a) or not valid_box(b):return False
    intersection=max(0,min(a['right'],b['right'])-max(a['left'],b['left']))*max(0,min(a['bottom'],b['bottom'])-max(a['top'],b['top']))
    union=(a['right']-a['left'])*(a['bottom']-a['top'])+(b['right']-b['left'])*(b['bottom']-b['top'])-intersection
    if union<=0 or intersection/union<.9:return False
    from .face_space import vector
    import numpy as np
    try:return float(np.dot(vector(saved.encoding,dimensions),vector(face['encoding'],dimensions)))>=.995
    except ValueError:return False
