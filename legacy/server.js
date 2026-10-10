const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const exifr = require('exifr');
const sharp = require('sharp');

const app = express();
const PORT = 5500;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const THUMBS_DIR = path.join(__dirname, 'thumbnails');
const SIGNATURES_DIR = path.join(__dirname, 'signatures');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
const PHOTOS_FILE = path.join(DATA_DIR, 'photos.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const SIGNATURES_FILE = path.join(DATA_DIR, 'signatures.json');

[DATA_DIR, UPLOADS_DIR, THUMBS_DIR, SIGNATURES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readCollections() {
  return readJSON(COLLECTIONS_FILE, { collections: [] });
}

function writeCollections(data) {
  writeJSON(COLLECTIONS_FILE, data);
}

function readPhotos() {
  return readJSON(PHOTOS_FILE, { photos: [] });
}

function writePhotos(data) {
  writeJSON(PHOTOS_FILE, data);
}

function readSignatures() {
  return readJSON(SIGNATURES_FILE, { signatures: [] });
}

function writeSignatures(data) {
  writeJSON(SIGNATURES_FILE, data);
}

if (readCollections().collections.length === 0) {
  writeCollections({
    collections: [
      { id: 'all', name: '全部照片', type: 'system', criterion: null, value: null },
    ],
  });
}
if (!fs.existsSync(PHOTOS_FILE)) writePhotos({ photos: [] });
if (!fs.existsSync(RULES_FILE)) writeJSON(RULES_FILE, { criteria: [] });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpe?g|png|webp|tiff?|heic|heif|avif)$/i.test(file.originalname);
    cb(ok ? null : new Error('仅支持照片格式'), ok);
  },
  limits: { fileSize: 200 * 1024 * 1024, files: 50 },
});

const signatureStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SIGNATURES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const signatureUpload = multer({
  storage: signatureStorage,
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpe?g|png|webp|avif)$/i.test(file.originalname);
    cb(ok ? null : new Error('仅支持图片签名格式'), ok);
  },
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

function formatExposureTime(seconds) {
  if (!seconds || typeof seconds !== 'number') return null;
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  const denominator = Math.round(1 / seconds);
  return `1/${denominator}`;
}

function toDate(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function extractExif(raw) {
  if (!raw) return {};
  return {
    camera: raw.Make && raw.Model ? `${raw.Make} ${raw.Model}` : raw.Model || raw.Make || null,
    lens: raw.LensModel || null,
    shutter: formatExposureTime(raw.ExposureTime),
    aperture: raw.FNumber ? `f/${raw.FNumber}` : null,
    iso: raw.ISO || raw.ISOSpeedRatings || null,
    focalLength: raw.FocalLength ? `${Math.round(raw.FocalLength)}mm` : null,
    shootTime: toDate(raw.DateTimeOriginal || raw.CreateDate || raw.ModifyDate),
    orientation: raw.orientation ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
  };
}

function focalBucket(value) {
  if (!value) return null;
  const num = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num)) return null;
  if (num < 35) return '广角';
  if (num < 70) return '标准';
  if (num < 135) return '中长焦';
  return '长焦';
}

function subjectMatches(photo, keywords) {
  if (!keywords || !keywords.length) return [];
  const haystack = [photo.originalName, ...(photo.tags || [])].join(' ').toLowerCase();
  return keywords.filter((keyword) => keyword && haystack.includes(keyword.toLowerCase()));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/thumbnails', express.static(THUMBS_DIR));
app.use('/signatures', express.static(SIGNATURES_DIR));

app.get('/api/photos', (req, res) => {
  const data = readPhotos();
  const collectionId = req.query.collectionId;
  let photos = data.photos;
  if (collectionId && collectionId !== 'all') {
    photos = photos.filter((photo) => (photo.collectionIds || []).includes(collectionId));
  }
  res.json({ photos });
});

app.get('/api/photos/:id', (req, res) => {
  const photo = readPhotos().photos.find((item) => item.id === req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在' });
  res.json(photo);
});

app.get('/api/signatures', (req, res) => {
  res.json(readSignatures());
});

app.post('/api/signatures/text', (req, res) => {
  const { value } = req.body || {};
  if (!value || !String(value).trim()) return res.status(400).json({ error: '签名内容不能为空' });
  const data = readSignatures();
  const signature = {
    id: crypto.randomUUID(),
    name: String(value).trim(),
    type: 'text',
    value: String(value).trim(),
    createdAt: new Date().toISOString(),
  };
  data.signatures.push(signature);
  writeSignatures(data);
  res.json({ signature });
});

app.post('/api/signatures/image', signatureUpload.single('image'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: '缺少签名图片' });
  const data = readSignatures();
  const signature = {
    id: crypto.randomUUID(),
    name: path.parse(file.originalname).name || '图片签名',
    type: 'image',
    filename: file.filename,
    createdAt: new Date().toISOString(),
  };
  data.signatures.push(signature);
  writeSignatures(data);
  res.json({ signature });
});

app.delete('/api/signatures/:id', (req, res) => {
  const data = readSignatures();
  const signature = data.signatures.find((item) => item.id === req.params.id);
  if (!signature) return res.status(404).json({ error: '签名不存在' });
  if (signature.type === 'image' && signature.filename) {
    try {
      fs.unlinkSync(path.join(SIGNATURES_DIR, signature.filename));
    } catch {}
  }
  data.signatures = data.signatures.filter((item) => item.id !== req.params.id);
  writeSignatures(data);
  res.json({ ok: true });
});

app.post('/api/photos/watermark/apply', (req, res) => {
  const { scope, sourcePhotoId, settings } = req.body || {};
  if (!['all', 'collection', 'album'].includes(scope)) return res.status(400).json({ error: '无效的应用范围' });
  if (!settings) return res.status(400).json({ error: '缺少水印设置' });

  const photosData = readPhotos();
  const collections = readCollections().collections;
  const sourcePhoto = photosData.photos.find((item) => item.id === sourcePhotoId);
  if (!sourcePhoto) return res.status(404).json({ error: '照片不存在' });

  let targets = photosData.photos;
  if (scope === 'collection') {
    const collectionIds = (sourcePhoto.collectionIds || []).filter((id) => id !== 'all');
    if (!collectionIds.length) return res.status(400).json({ error: '当前照片没有对应收藏夹' });
    const targetId = collectionIds[0];
    targets = photosData.photos.filter((photo) => (photo.collectionIds || []).includes(targetId));
  } else if (scope === 'album') {
    const sourceCollectionIds = sourcePhoto.collectionIds || [];
    const sourceAlbums = collections
      .filter((collection) => sourceCollectionIds.includes(collection.id))
      .map((collection) => collection.album || (collection.type === 'auto' ? '影集' : null))
      .filter(Boolean);
    if (!sourceAlbums.length) return res.status(400).json({ error: '当前照片没有对应影集' });
    const albumCollectionIds = collections
      .filter((collection) => sourceAlbums.includes(collection.album || (collection.type === 'auto' ? '影集' : null)))
      .map((collection) => collection.id);
    targets = photosData.photos.filter((photo) => (photo.collectionIds || []).some((id) => albumCollectionIds.includes(id)));
  }

  targets.forEach((photo) => {
    photo.watermarkSettings = settings;
  });
  writePhotos(photosData);
  res.json({ ok: true, updated: targets.length });
});

app.patch('/api/photos/:id/watermark', (req, res) => {
  const data = readPhotos();
  const photo = data.photos.find((item) => item.id === req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在' });
  if (!req.body) return res.status(400).json({ error: '缺少水印设置' });
  photo.watermarkSettings = req.body;
  writePhotos(data);
  res.json({ ok: true, watermarkSettings: photo.watermarkSettings });
});

app.post('/api/photos', upload.array('photos'), async (req, res) => {
  const files = req.files || [];
  const photos = readPhotos();
  const saved = [];

  for (const file of files) {
    try {
      const metadata = await sharp(file.path).metadata();
      const thumbName = `${path.basename(file.filename, path.extname(file.filename))}.jpg`;
      const thumbPath = path.join(THUMBS_DIR, thumbName);
      await sharp(file.path)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(thumbPath);

      let rawExif = null;
      try {
        rawExif = await exifr.parse(file.path, {
          tiff: true,
          exif: true,
          gps: true,
          ifd0: true,
          ifd1: true,
          xmp: true,
          translateValues: true,
        });
      } catch {
        rawExif = null;
      }

      const record = {
        id: crypto.randomUUID(),
        originalName: file.originalname,
        filename: file.filename,
        thumbnail: thumbName,
        mimeType: file.mimetype,
        size: file.size,
        width: metadata.width || null,
        height: metadata.height || null,
        exif: extractExif(rawExif),
        collectionIds: ['all'],
        tags: [],
        uploadedAt: new Date().toISOString(),
      };
      photos.photos.push(record);
      saved.push(record);
    } catch (error) {
      console.error('照片处理失败:', error);
    }
  }

  writePhotos(photos);
  res.json({ saved: saved.length, photos: saved });
});

app.delete('/api/photos/:id', (req, res) => {
  const data = readPhotos();
  const photo = data.photos.find((item) => item.id === req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在' });
  // Removing a library record must never remove the original file.
  data.photos = data.photos.filter((item) => item.id !== req.params.id);
  writePhotos(data);
  res.json({ ok: true });
});

app.post('/api/photos/bulk-delete', (req, res) => {
  const { ids = [] } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '缺少要删除的照片' });
  const data = readPhotos();
  const targetIds = new Set(ids);
  const targets = data.photos.filter((photo) => targetIds.has(photo.id));
  data.photos = data.photos.filter((photo) => !targetIds.has(photo.id));
  data.photos.forEach((photo) => {
    if (photo.collectionIds) {
      photo.collectionIds = photo.collectionIds.filter((id) => !targetIds.has(id));
    }
  });
  writePhotos(data);
  res.json({ ok: true, deleted: targets.length });
});

app.post('/api/photos/:id/collections', (req, res) => {
  const { add = [], remove = [] } = req.body || {};
  const data = readPhotos();
  const photo = data.photos.find((item) => item.id === req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在' });
  photo.collectionIds = photo.collectionIds || [];
  add.forEach((id) => {
    if (!photo.collectionIds.includes(id)) photo.collectionIds.push(id);
  });
  photo.collectionIds = photo.collectionIds.filter((id) => !remove.includes(id));
  writePhotos(data);
  res.json({ ok: true, collectionIds: photo.collectionIds });
});

app.get('/api/collections', (req, res) => {
  const collections = readCollections();
  const photos = readPhotos().photos;
  const result = collections.collections.map((collection) => ({
    ...collection,
    count: collection.id === 'all' ? photos.length : photos.filter((photo) => (photo.collectionIds || []).includes(collection.id)).length,
  }));
  res.json({ collections: result });
});

app.post('/api/collections', (req, res) => {
  const { name, type = 'custom', criterion = null, value = null } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称不能为空' });
  const data = readCollections();
  const id = crypto.randomUUID();
  data.collections.push({ id, name: String(name).trim(), type, criterion, value });
  writeCollections(data);
  res.json({ id });
});

app.delete('/api/collections/:id', (req, res) => {
  const data = readCollections();
  const target = data.collections.find((item) => item.id === req.params.id);
  if (!target) return res.status(404).json({ error: '收藏夹不存在' });
  if (target.type === 'system') return res.status(400).json({ error: '系统收藏夹不能删除' });
  data.collections = data.collections.filter((item) => item.id !== req.params.id);
  const photos = readPhotos();
  photos.photos.forEach((photo) => {
    if (photo.collectionIds) photo.collectionIds = photo.collectionIds.filter((id) => id !== req.params.id);
  });
  writePhotos(photos);
  writeCollections(data);
  res.json({ ok: true });
});

app.post('/api/classify', (req, res) => {
  const { criteria = [] } = req.body || {};
  if (!criteria.length) return res.status(400).json({ error: '至少选择一个分类标准' });

  const collectionsData = readCollections();
  const photosData = readPhotos();
  const photos = photosData.photos;
  const autoCollections = [];

  const period = criteria.find((item) => item.type === 'time');
  if (period) {
    const granularity = period.granularity || 'month';
    const groups = new Map();
    const names = new Map();
    photos.forEach((photo) => {
      const shootTime = photo.exif?.shootTime;
      if (!shootTime) {
        if (!groups.has('unknown')) groups.set('unknown', []);
        groups.get('unknown').push(photo.id);
        return;
      }
      const date = new Date(shootTime);
      let key = String(date.getFullYear());
      let name = key;
      if (granularity === 'month') {
        key += `-${String(date.getMonth() + 1).padStart(2, '0')}`;
        name = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
      } else if (granularity === 'day') {
        key += `-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        name = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
      }
      if (!groups.has(key)) groups.set(key, []);
      if (!names.has(key)) names.set(key, key === 'unknown' ? '拍摄时间未知' : name);
      groups.get(key).push(photo.id);
    });
    groups.forEach((photoIds, key) => {
      autoCollections.push({
        id: crypto.randomUUID(),
        name: names.get(key) || '拍摄时间未知',
        type: 'auto',
        album: '影集',
        criterion: 'time',
        value: key,
        photoIds,
      });
    });
  }

  const camera = criteria.find((item) => item.type === 'camera');
  if (camera) {
    const groups = new Map();
    photos.forEach((photo) => {
      const key = photo.exif?.camera || '相机未知';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(photo.id);
    });
    groups.forEach((photoIds, key) => {
      autoCollections.push({
        id: crypto.randomUUID(),
        name: key,
        type: 'auto',
        album: '影集',
        criterion: 'camera',
        value: key,
        photoIds,
      });
    });
  }

  const focal = criteria.find((item) => item.type === 'focalLength');
  if (focal) {
    const groups = new Map();
    photos.forEach((photo) => {
      const key = focalBucket(photo.exif?.focalLength) || '焦段未知';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(photo.id);
    });
    groups.forEach((photoIds, key) => {
      autoCollections.push({
        id: crypto.randomUUID(),
        name: key,
        type: 'auto',
        album: '影集',
        criterion: 'focalLength',
        value: key,
        photoIds,
      });
    });
  }

  const subject = criteria.find((item) => item.type === 'subject');
  if (subject) {
    const keywords = subject.keywords || [];
    keywords.forEach((keyword) => {
      const photoIds = photos.filter((photo) => subjectMatches(photo, [keyword]).length > 0).map((photo) => photo.id);
      if (!photoIds.length) return;
      autoCollections.push({
        id: crypto.randomUUID(),
        name: keyword,
        type: 'auto',
        album: '影集',
        criterion: 'subject',
        value: keyword,
        photoIds,
      });
    });
  }

  collectionsData.collections = collectionsData.collections.filter((item) => item.type !== 'auto');
  const retainedIds = new Set(collectionsData.collections.map((item) => item.id));
  photos.forEach((photo) => {
    if (photo.collectionIds) photo.collectionIds = photo.collectionIds.filter((id) => retainedIds.has(id));
  });
  autoCollections.forEach((collection) => {
    collectionsData.collections.push(collection);
    collection.photoIds.forEach((photoId) => {
      const photo = photos.find((item) => item.id === photoId);
      if (!photo) return;
      photo.collectionIds = photo.collectionIds || [];
        if (!photo.collectionIds.includes(collection.id)) photo.collectionIds.push(collection.id);
    });
    delete collection.photoIds;
  });

  writeCollections(collectionsData);
  writePhotos(photosData);
  writeJSON(RULES_FILE, { criteria, generatedAt: new Date().toISOString() });
  res.json({ ok: true, generated: autoCollections.length });
});

app.get('/api/rules', (req, res) => {
  res.json(readJSON(RULES_FILE, { criteria: [] }));
});

app.get('/icons/:name', (req, res) => {
  const name = String(req.params.name || '').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) return res.status(400).json({ error: '无效图标' });
  const iconPath = path.join(__dirname, 'node_modules', 'lucide-static', 'icons', `${name}.svg`);
  if (!fs.existsSync(iconPath)) return res.status(404).json({ error: '图标不存在' });
  res.sendFile(iconPath);
});

app.listen(PORT, () => {
  console.log(`Photo collection server running at http://localhost:${PORT}`);
});
