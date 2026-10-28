"""Person alias traversal, also usable by offline SQLite maintenance tools."""

def root(person_id,links):
    seen=set()
    while person_id in links:
        if person_id in seen:raise ValueError('人物合并关系损坏')
        seen.add(person_id);person_id=links[person_id]
    return person_id

def descendants(ids,links):
    return sorted(set(ids)|{key for key in links if root(key,links) in ids})
