"""收藏大光圈照片（默认 f/2.0 及以下）—— 示例插件"""

def run(ctx, aperture=2.0):
    count = 0
    for photo in ctx.photos(limit=2000):
        if photo['f_number'] and photo['f_number'] <= aperture and not photo['favorite']:
            ctx.update(photo['id'], favorite=True)
            count += 1
    ctx.message(f'共收藏 {count} 张大光圈照片')
    return count
