const state = {
  photos: [],
  collections: [],
  signatures: [],
  activeCollection: 'all',
  timeGranularity: 'month',
  currentPhoto: null,
  selection: new Set(),
  selectionMode: false,
};

const DEFAULT_WATERMARK = {
  template: 'classic',
  fields: { model: true, focalLength: true, aperture: true, shutter: true, iso: true, shootTime: false, signature: false },
  size: 100,
  color: '#54b7f5',
  signatureId: '',
  effect: 'standard',
};

const iconCache = new Map();

async function renderIcons(root = document) {
  const icons = [...root.querySelectorAll('[data-icon]')];
  await Promise.all(icons.map(async (node) => {
    const name = node.dataset.icon;
    if (!iconCache.has(name)) {
      const response = await fetch(`/icons/${name}`);
      iconCache.set(name, response.ok ? await response.text() : '');
    }
    node.innerHTML = iconCache.get(name) || '';
  }));
}

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function formatDate(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '未知';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadPhotos() {
  const query = state.activeCollection === 'all' ? '' : `?collectionId=${encodeURIComponent(state.activeCollection)}`;
  const data = await fetchJSON(`/api/photos${query}`);
  state.photos = data.photos || [];
  renderGallery();
}

function selectedPhotos() {
  return state.photos.filter((photo) => state.selection.has(photo.id));
}

function clearSelection() {
  state.selection.clear();
  updateSelectionUI();
}

function updateSelectionUI() {
  const bulkBar = document.getElementById('bulkBar');
  const selectedCount = document.getElementById('selectedCount');
  const multiSelectButton = document.getElementById('multiSelectButton');
  const count = selectedPhotos().length;
  bulkBar.classList.toggle('hidden', !state.selectionMode);
  selectedCount.textContent = count;
  multiSelectButton.classList.toggle('active', state.selectionMode);
  document.querySelectorAll('.photo-tile').forEach((tile) => {
    const selected = state.selection.has(tile.dataset.id);
    tile.classList.toggle('selected', selected);
    const checkbox = tile.querySelector('.tile-checkbox');
    if (checkbox) checkbox.innerHTML = selected ? '<i data-icon="check"></i>' : '';
  });
  renderIcons(document.getElementById('gallery'));
}

function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  clearSelection();
  renderGallery();
}

async function loadCollections() {
  const data = await fetchJSON('/api/collections');
  state.collections = data.collections || [];
  renderCollections();
}

async function loadSignatures() {
  const data = await fetchJSON('/api/signatures');
  state.signatures = data.signatures || [];
  renderSignatureList();
  renderSignatureOptions();
}

function collectionName(id) {
  return state.collections.find((item) => item.id === id)?.name || '未知收藏夹';
}

function signatureById(id) {
  return state.signatures.find((item) => item.id === id) || null;
}

function getSignatureForPhoto(photo) {
  const settings = getWatermarkSettings(photo);
  if (!settings.fields.signature) return null;
  return signatureById(settings.signatureId) || state.signatures[0] || null;
}

function signatureSrc(signature) {
  return signature?.type === 'image' ? `/signatures/${signature.filename}` : '';
}

function renderSignatureList() {
  const list = document.getElementById('signatureList');
  list.innerHTML = '';
  if (!state.signatures.length) {
    list.innerHTML = '<p class="empty-note">还没有签名，可以输入文字或上传图片。</p>';
    return;
  }
  state.signatures.forEach((signature) => {
    const row = document.createElement('div');
    row.className = 'signature-row';
    row.innerHTML = `
      <div class="signature-preview">
        ${signature.type === 'image' ? `<img src="/signatures/${signature.filename}" alt="${signature.name}">` : `<span>${signature.value}</span>`}
      </div>
      <div class="signature-name">${signature.name}</div>
      <button type="button" class="signature-delete" title="删除签名" aria-label="删除签名"><i data-icon="trash-2"></i></button>
    `;
    row.querySelector('.signature-delete').addEventListener('click', () => deleteSignature(signature.id));
    list.appendChild(row);
  });
  renderIcons(list);
}

function renderSignatureOptions() {
  const select = document.getElementById('signatureSelect');
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.signatures.length ? '选择签名' : '先在左侧添加签名';
  select.appendChild(placeholder);
  state.signatures.forEach((signature) => {
    const option = document.createElement('option');
    option.value = signature.id;
    option.textContent = signature.name;
    select.appendChild(option);
  });
}

function renderCollectionRows(container, collections) {
  collections.forEach((collection) => {
    const row = document.createElement('div');
    row.className = 'collection-row';
    row.innerHTML = `
      <button type="button" class="collection-main${collection.id === state.activeCollection ? ' active' : ''}">
        <span>${collection.name}</span>
        <span class="collection-count">${collection.count ?? 0}</span>
        ${collection.type !== 'system' ? '<span class="collection-type">自动</span>' : ''}
      </button>
      ${collection.type !== 'system' ? '<button type="button" class="collection-delete" title="删除收藏夹" aria-label="删除收藏夹"><i data-icon="trash-2"></i></button>' : ''}
    `;
    row.querySelector('.collection-main').addEventListener('click', () => {
      state.activeCollection = collection.id;
      const title = collection.id === 'all' ? '全部照片' : collection.name;
      document.getElementById('collectionTitle').textContent = title;
      clearSelection();
      loadPhotos().then(renderCollections);
    });
    const deleteButton = row.querySelector('.collection-delete');
    if (deleteButton) deleteButton.addEventListener('click', () => deleteCollection(collection.id));
    container.appendChild(row);
  });
}

function renderCollections() {
  const list = document.getElementById('collectionList');
  list.innerHTML = '';

  const systemCollections = state.collections.filter((item) => item.type === 'system');
  const customCollections = state.collections.filter((item) => item.type === 'custom');
  const autoCollections = state.collections.filter((item) => item.type === 'auto');

  renderCollectionRows(list, systemCollections);
  renderCollectionRows(list, customCollections);

  if (autoCollections.length) {
    const albumGroup = document.createElement('div');
    albumGroup.className = 'album-group';
    albumGroup.innerHTML = `
      <div class="album-label"><i data-icon="folder"></i>影集</div>
      <div class="album-items"></div>
    `;
    renderCollectionRows(albumGroup.querySelector('.album-items'), autoCollections);
    list.appendChild(albumGroup);
  }

  renderIcons(list);
}

function renderGallery() {
  const gallery = document.getElementById('gallery');
  const emptyState = document.getElementById('emptyState');
  gallery.innerHTML = '';
  document.getElementById('collectionMeta').textContent = `${state.photos.length} 张照片`;
  emptyState.classList.toggle('hidden', state.photos.length > 0);

  state.photos.forEach((photo) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'photo-tile';
    tile.dataset.id = photo.id;
    tile.setAttribute('aria-label', photo.originalName);
    tile.innerHTML = `
      <img src="/thumbnails/${photo.thumbnail}" alt="${photo.originalName}" loading="lazy">
      <div class="tile-checkbox"><i data-icon="check"></i></div>
      <div class="tile-meta">
        <span class="tile-name">${photo.originalName}</span>
        <span class="tile-exif">${[photo.exif?.shutter, photo.exif?.aperture, photo.exif?.iso ? `ISO ${photo.exif.iso}` : ''].filter(Boolean).join(' / ') || '无参数'}</span>
      </div>
    `;
    tile.addEventListener('click', () => {
      if (state.selectionMode) {
        if (state.selection.has(photo.id)) state.selection.delete(photo.id);
        else state.selection.add(photo.id);
        updateSelectionUI();
      } else {
        openPhotoModal(photo);
      }
    });
    gallery.appendChild(tile);
  });
  updateSelectionUI();
}

function renderParameters(photo) {
  const panel = document.getElementById('parametersPanel');
  const rows = [
    ['相机', photo.exif?.camera || '未知'],
    ['镜头', photo.exif?.lens || '未知'],
    ['快门', photo.exif?.shutter || '未知'],
    ['光圈', photo.exif?.aperture || '未知'],
    ['ISO', photo.exif?.iso || '未知'],
    ['焦段', photo.exif?.focalLength || '未知'],
    ['拍摄时间', formatDate(photo.exif?.shootTime)],
    ['分辨率', photo.width && photo.height ? `${photo.width} × ${photo.height}` : '未知'],
    ['文件大小', formatSize(photo.size)],
    ['所属收藏夹', photo.collectionIds?.map(collectionName).join(' / ') || '未分类'],
  ];
  panel.innerHTML = `
    <h3>拍摄参数</h3>
    <div class="parameter-grid">
      ${rows.map(([label, value]) => `
        <div class="parameter">
          <div class="parameter-label">${label}</div>
          <div class="parameter-value">${value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function watermarkValues(photo) {
  const exif = photo.exif || {};
  const settings = getWatermarkSettings(photo);
  const fields = settings.fields;
  return {
    model: fields.model && exif.camera ? exif.camera : '',
    focalLength: fields.focalLength && exif.focalLength ? exif.focalLength : '',
    aperture: fields.aperture && exif.aperture ? exif.aperture : '',
    shutter: fields.shutter && exif.shutter ? exif.shutter : '',
    iso: fields.iso && exif.iso ? `ISO ${exif.iso}` : '',
    shootTime: fields.shootTime && exif.shootTime ? formatDate(exif.shootTime) : '',
  };
}

function getWatermarkSettings(photo) {
  return normalizeWatermarkSettings(photo?.watermarkSettings);
}

function normalizeWatermarkSettings(settings) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_WATERMARK));
  if (settings?.template) merged.template = settings.template;
  if (settings?.fields) Object.keys(merged.fields).forEach((key) => {
    if (typeof settings.fields[key] === 'boolean') merged.fields[key] = settings.fields[key];
  });
  if (Number.isFinite(settings?.size)) merged.size = settings.size;
  if (typeof settings?.color === 'string') merged.color = settings.color;
  if (typeof settings?.signatureId === 'string') merged.signatureId = settings.signatureId;
  if (['standard', 'script', 'shadow', 'outline'].includes(settings?.effect)) merged.effect = settings.effect;
  return merged;
}

function syncWatermarkControls(settings) {
  document.querySelectorAll('.template-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.template === settings.template);
  });
  document.querySelectorAll('.effect-option').forEach((button) => {
    button.addEventListener('click', () => {
      updateCurrentWatermark((settings) => {
        settings.effect = button.dataset.effect;
      });
    });
  });

  document.querySelectorAll('#watermarkPanel input[data-field]').forEach((input) => {
    input.checked = Boolean(settings.fields[input.dataset.field]);
  });
  document.getElementById('watermarkSize').value = settings.size;
  document.getElementById('watermarkColor').value = settings.color;
  document.querySelectorAll('.color-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.color === settings.color);
  });
  document.querySelectorAll('.effect-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.effect === settings.effect);
  });
  const signatureSelect = document.getElementById('signatureSelect');
  signatureSelect.value = settings.signatureId || '';
}

function effectClassName(effect) {
  return { standard: '', script: 'effect-script', shadow: 'effect-shadow', outline: 'effect-outline' }[effect] || '';
}

function isLightColor(color) {
  const value = color.trim().toLowerCase();
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!match) return false;
  const hex = match[1];
  const full = hex.length === 3 ? hex.split('').map((item) => item + item).join('') : hex;
  const red = parseInt(full.slice(0, 2), 16);
  const green = parseInt(full.slice(2, 4), 16);
  const blue = parseInt(full.slice(4, 6), 16);
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > .82;
}

function watermarkTextColor(settings) {
  return settings.template === 'classic' && isLightColor(settings.color) ? '#111416' : settings.color;
}

function signatureHTML(signature, template) {
  if (!signature) return '';
  if (signature.type === 'text') {
    return `<div class="${template}-signature">${signature.value}</div>`;
  }
  return `<img class="${template}-signature-image" src="${signatureSrc(signature)}" alt="${signature.name}">`;
}

function renderWatermarkPreview(photo) {
  const layer = document.getElementById('watermarkLayer');
  const stage = document.getElementById('imageStage');
  const values = watermarkValues(photo);
  const settings = getWatermarkSettings(photo);
  const signature = getSignatureForPhoto(photo);
  const params = [values.focalLength, values.aperture, values.shutter, values.iso].filter(Boolean).join('  ');
  const displayColor = watermarkTextColor(settings);
  stage.className = `image-stage watermark-${settings.template}${signature ? ' has-signature' : ''}`;
  const effectClass = effectClassName(settings.effect);

  if (settings.template === 'classic') {
    layer.innerHTML = `
      <div class="classic-watermark ${effectClass}" style="color:${displayColor}">
        ${values.model ? `<div class="classic-model">${values.model}</div>` : ''}
        ${params ? `<div class="classic-params">${params}</div>` : ''}
        ${values.shootTime ? `<div class="classic-time">${values.shootTime}</div>` : ''}
      </div>
      ${signatureHTML(signature, 'classic')}
    `;
  } else {
    layer.innerHTML = `
      <div class="glass-watermark ${effectClass}" style="color:${settings.color}">
        <div class="glass-main">
          ${values.model ? `<div class="glass-model">${values.model}</div>` : ''}
          ${values.shootTime ? `<div class="glass-time">${values.shootTime}</div>` : ''}
          ${signatureHTML(signature, 'glass')}
        </div>
        ${params ? `<div class="glass-divider"></div><div class="glass-params">${params}</div>` : ''}
      </div>
    `;
  }
  layer.style.fontSize = `${settings.size}%`;
}

function openPhotoModal(photo) {
  state.currentPhoto = photo;
  const modal = document.getElementById('photoModal');
  const previewImage = document.getElementById('previewImage');
  const parametersPanel = document.getElementById('parametersPanel');
  const watermarkPanel = document.getElementById('watermarkPanel');
  document.getElementById('photoBadge').textContent = photo.originalName;
  previewImage.src = `/thumbnails/${photo.thumbnail}`;
  previewImage.alt = photo.originalName;
  parametersPanel.classList.add('hidden');
  watermarkPanel.classList.add('hidden');
  renderParameters(photo);
  syncWatermarkControls(getWatermarkSettings(photo));
  renderWatermarkPreview(photo);
  renderIcons(parametersPanel);
  renderIcons(watermarkPanel);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

let watermarkSaveTimer = null;

function saveWatermarkSettings(photo) {
  clearTimeout(watermarkSaveTimer);
  watermarkSaveTimer = setTimeout(() => {
    fetchJSON(`/api/photos/${photo.id}/watermark`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getWatermarkSettings(photo)),
    }).catch(() => {});
  }, 200);
}

function updateCurrentWatermark(mutator) {
  if (!state.currentPhoto) return;
  const settings = getWatermarkSettings(state.currentPhoto);
  mutator(settings);
  state.currentPhoto.watermarkSettings = settings;
  renderWatermarkPreview(state.currentPhoto);
  saveWatermarkSettings(state.currentPhoto);
}

async function applyWatermarkToScope(scope) {
  if (!state.currentPhoto) return;
  const settings = getWatermarkSettings(state.currentPhoto);
  try {
    const result = await fetchJSON('/api/photos/watermark/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, sourcePhotoId: state.currentPhoto.id, settings }),
    });
    await loadPhotos();
    state.currentPhoto = state.photos.find((item) => item.id === state.currentPhoto.id) || state.currentPhoto;
    renderWatermarkPreview(state.currentPhoto);
    alert(`已应用到 ${result.updated} 张照片`);
  } catch (error) {
    alert(error.message || '应用失败');
  }
}

function moveCurrentPhoto(step) {
  if (!state.currentPhoto || state.photos.length < 2) return;
  const index = state.photos.findIndex((item) => item.id === state.currentPhoto.id);
  if (index < 0) return;
  const nextIndex = (index + step + state.photos.length) % state.photos.length;
  openPhotoModal(state.photos[nextIndex]);
}

function updateFullscreenNavVisibility() {
  const modalMedia = document.querySelector('.modal-media');
  const buttons = [...document.querySelectorAll('.fullscreen-nav')];
  const show = Boolean(document.fullscreenElement) && state.photos.length > 1;
  buttons.forEach((button) => button.classList.toggle('hidden', !show));
  if (!show) buttons.forEach((button) => button.classList.remove('visible'));
}

function handleFullscreenMouseMove(event) {
  if (!document.fullscreenElement) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const prevButton = document.getElementById('prevPhotoButton');
  const nextButton = document.getElementById('nextPhotoButton');
  const nearLeft = event.clientX < bounds.left + 180;
  const nearRight = event.clientX > bounds.right - 180;
  prevButton.classList.toggle('visible', nearLeft);
  nextButton.classList.toggle('visible', nearRight);
}

function closePhotoModal() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.getElementById('photoModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.currentPhoto = null;
}

async function deleteCollection(id) {
  if (!confirm('确定要删除这个收藏夹吗？')) return;
  try {
    await fetchJSON(`/api/collections/${id}`, { method: 'DELETE' });
    if (state.activeCollection === id) {
      state.activeCollection = 'all';
      document.getElementById('collectionTitle').textContent = '全部照片';
    }
    await Promise.all([loadCollections(), loadPhotos()]);
  } catch (error) {
    alert(error.message || '删除失败');
  }
}

async function uploadFiles(files) {
  if (!files?.length) return;
  const formData = new FormData();
  [...files].forEach((file) => formData.append('photos', file));
  const dropzone = document.getElementById('dropzone');
  dropzone.querySelector('span').textContent = '正在上传...';
  try {
    await fetchJSON('/api/photos', { method: 'POST', body: formData });
    await Promise.all([loadCollections(), loadPhotos()]);
    dropzone.querySelector('span').textContent = '上传完成';
  } catch (error) {
    dropzone.querySelector('span').textContent = error.message || '上传失败';
  } finally {
    setTimeout(() => {
      dropzone.querySelector('span').textContent = '拖入照片，或点击上传';
    }, 1800);
  }
}

async function generateCollections(event) {
  event.preventDefault();
  const criteria = [];
  const form = document.getElementById('rulesForm');
  const checked = [...form.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.name);

  if (checked.includes('time')) {
    criteria.push({ type: 'time', granularity: state.timeGranularity });
  }
  if (checked.includes('camera')) criteria.push({ type: 'camera' });
  if (checked.includes('focalLength')) criteria.push({ type: 'focalLength' });
  if (checked.includes('subject')) {
    const keywords = document.getElementById('subjectInput').value
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    criteria.push({ type: 'subject', keywords });
  }

  if (!criteria.length) {
    alert('至少选择一个分类标准');
    return;
  }

  try {
    const result = await fetchJSON('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ criteria }),
    });
    state.activeCollection = 'all';
    document.getElementById('collectionTitle').textContent = '全部照片';
    clearSelection();
    await Promise.all([loadCollections(), loadPhotos()]);
    alert(`已生成 ${result.generated} 个收藏夹`);
  } catch (error) {
    alert(error.message || '生成失败');
  }
}

async function createCollection() {
  const name = prompt('输入收藏夹名称');
  if (!name) return;
  try {
    await fetchJSON('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'custom' }),
    });
    await loadCollections();
  } catch (error) {
    alert(error.message || '创建失败');
  }
}

async function addTextSignature() {
  const input = document.getElementById('signatureInput');
  const value = input.value.trim();
  if (!value) {
    alert('请输入签名内容');
    return;
  }
  try {
    await fetchJSON('/api/signatures/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    input.value = '';
    await loadSignatures();
  } catch (error) {
    alert(error.message || '添加失败');
  }
}

async function addImageSignature(files) {
  if (!files?.length) return;
  const formData = new FormData();
  formData.append('image', files[0]);
  try {
    await fetchJSON('/api/signatures/image', { method: 'POST', body: formData });
    await loadSignatures();
  } catch (error) {
    alert(error.message || '添加失败');
  }
}

async function deleteSignature(id) {
  if (!confirm('确定要删除这个签名吗？')) return;
  try {
    await fetchJSON(`/api/signatures/${id}`, { method: 'DELETE' });
    await loadSignatures();
  } catch (error) {
    alert(error.message || '删除失败');
  }
}

async function deletePhoto() {
  if (!state.currentPhoto) return;
  if (!confirm('确定要删除这张照片吗？')) return;
  try {
    await fetchJSON(`/api/photos/${state.currentPhoto.id}`, { method: 'DELETE' });
    closePhotoModal();
    await Promise.all([loadCollections(), loadPhotos()]);
  } catch (error) {
    alert(error.message || '删除失败');
  }
}

async function bulkDeleteSelected() {
  const photos = selectedPhotos();
  if (!photos.length) {
    alert('请先选择要删除的照片');
    return;
  }
  if (!confirm(`确定要删除选中的 ${photos.length} 张照片吗？`)) return;
  try {
    await fetchJSON('/api/photos/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: photos.map((photo) => photo.id) }),
    });
    clearSelection();
    await Promise.all([loadCollections(), loadPhotos()]);
  } catch (error) {
    alert(error.message || '删除失败');
  }
}

function openExportModal() {
  const photos = selectedPhotos();
  if (!photos.length) {
    alert('请先选择要导出的照片');
    return;
  }
  const unwatermarked = photos.filter((photo) => !photo.watermarkSettings).length;
  document.getElementById('exportHint').textContent = unwatermarked
    ? `已选 ${photos.length} 张，其中 ${unwatermarked} 张未添加水印。导出前会提醒确认。`
    : `已选 ${photos.length} 张。选择导出方式。`;
  document.getElementById('exportModal').classList.remove('hidden');
}

function closeExportModal() {
  document.getElementById('exportModal').classList.add('hidden');
}

function confirmUnwatermarkedExport() {
  const photos = selectedPhotos();
  const unwatermarked = photos.filter((photo) => !photo.watermarkSettings).length;
  if (unwatermarked) {
    return confirm(`选中的照片中有 ${unwatermarked} 张未添加水印，是否继续导出？`);
  }
  return true;
}

async function exportPhotoData(photo) {
  if (!photo.watermarkSettings) {
    const response = await fetch(`/uploads/${photo.filename}`);
    const data = new Uint8Array(await response.arrayBuffer());
    return { data, name: photo.originalName };
  }
  const canvas = await watermarkedCanvas(photo);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const data = new Uint8Array(await blob.arrayBuffer());
  const name = `${photo.originalName.replace(/\.[^.]+$/, '')}-watermarked.png`;
  return { data, name };
}

async function downloadPhotoFile(photo) {
  const { data, name } = await exportPhotoData(photo);
  const blob = new Blob([data], { type: photo.watermarkSettings ? 'image/png' : photo.mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function exportSelectedPhotos() {
  if (!confirmUnwatermarkedExport()) return;
  const photos = selectedPhotos();
  for (const photo of photos) {
    await downloadPhotoFile(photo);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  closeExportModal();
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time: time & 0xffff, day: day & 0xffff };
}

async function exportSelectedZip() {
  if (!confirmUnwatermarkedExport()) return;
  const photos = selectedPhotos();
  const chunks = [];
  const central = [];
  let offset = 0;
  const encoder = new TextEncoder();

  const usedNames = new Map();
  for (const photo of photos) {
    const { data, name: originalExportName } = await exportPhotoData(photo);
    let name = originalExportName;
    const duplicateCount = usedNames.get(name) || 0;
    usedNames.set(name, duplicateCount + 1);
    if (duplicateCount) {
      name = name.replace(/(\.[^.]+)$/, `-${duplicateCount + 1}$1`);
    }

    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const now = dosDateTime(new Date());
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, now.time, true);
    view.setUint16(12, now.day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += localHeader.length + data.length;
  }

  const centralChunks = [];
  let centralOffset = 0;
  for (const entry of central) {
    const record = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    const now = dosDateTime(new Date());
    view.setUint16(12, now.time, true);
    view.setUint16(14, now.day, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint32(42, entry.offset, true);
    record.set(entry.nameBytes, 46);
    centralChunks.push(record);
    centralOffset += record.length;
  }

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralOffset, true);
  endView.setUint32(16, offset, true);

  const zip = new Blob([...chunks, ...centralChunks, endRecord], { type: 'application/zip' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(zip);
  link.download = `photos-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  closeExportModal();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function fontString(effect, weight, size) {
  const fonts = effect === 'script'
    ? '"Segoe Script", "Brush Script MT", "KaiTi", cursive'
    : '"Segoe UI", "Microsoft YaHei", sans-serif';
  return `${weight} ${Math.round(size)}px ${fonts}`;
}

async function watermarkedCanvas(photo) {
  const settings = getWatermarkSettings(photo);
  const image = await loadImage(`/uploads/${photo.filename}`);
  const signature = getSignatureForPhoto(photo);
  const signatureImage = signature?.type === 'image' ? await loadImage(signatureSrc(signature)) : null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const base = Math.min(width, height);
  const fontSize = Math.max(16, base * 0.024 * (settings.size / 100));
  const color = watermarkTextColor(settings);
  const values = watermarkValues(photo);
  const params = [values.focalLength, values.aperture, values.shutter, values.iso].filter(Boolean).join('  ');
  const drawWatermarkText = (text, x, y, weight, size, align = 'left', baseline = 'alphabetic', maxWidth = null, alpha = 1) => {
    context.save();
    context.textAlign = align;
    context.textBaseline = baseline;
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.font = fontString(settings.effect, weight, size);
    if (settings.effect === 'shadow') {
      context.shadowColor = 'rgba(0,0,0,.55)';
      context.shadowBlur = size * .25;
      context.shadowOffsetY = size * .08;
    }
    if (settings.effect === 'outline') {
      context.lineWidth = Math.max(1, size * .08);
      context.strokeStyle = 'rgba(0,0,0,.65)';
      context.strokeText(text, x, y, maxWidth);
    }
    context.fillText(text, x, y, maxWidth);
    context.restore();
  };
  const drawSignature = (x, y, align = 'left') => {
    if (!signature) return;
    context.textAlign = align;
    if (signatureImage) {
      const signatureHeight = base * 0.036;
      const signatureWidth = signatureHeight * (signatureImage.naturalWidth / signatureImage.naturalHeight);
      const drawX = align === 'right' ? x - signatureWidth : align === 'center' ? x - signatureWidth / 2 : x;
      context.drawImage(signatureImage, drawX, y - signatureHeight, signatureWidth, signatureHeight);
    } else {
      drawWatermarkText(signature.value, x, y, 600, fontSize * .92, align, 'alphabetic');
    }
  };

  if (settings.template === 'classic') {
    const border = Math.round(base * 0.06);
    const bottom = Math.round(border * (signature ? 3.2 : 2.4));
    canvas.width = width + border * 2;
    canvas.height = height + border + bottom;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, border, border, width, height);

    const right = border * 0.72;
    const textRight = canvas.width - right;
    let textBottom = canvas.height - bottom * .32;
    context.textAlign = 'right';
    context.textBaseline = 'alphabetic';
    if (values.shootTime) {
      drawWatermarkText(values.shootTime, textRight, textBottom, 400, fontSize * .78, 'right');
      textBottom -= fontSize * 1.25;
    }
    if (params) {
      drawWatermarkText(params, textRight, textBottom, 400, fontSize, 'right');
      textBottom -= fontSize * 1.35;
    }
    if (values.model) {
      drawWatermarkText(values.model, textRight, textBottom, 600, fontSize * 1.05, 'right');
      textBottom -= fontSize * 1.5;
    }
    if (signature) drawSignature(right, canvas.height - right, 'left');
  } else {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const margin = Math.round(base * 0.045);
    const baseCapsuleHeight = Math.round(base * 0.115);
    const capsuleHeight = signature ? Math.round(baseCapsuleHeight * 1.35) : baseCapsuleHeight;
    const capsuleY = height - capsuleHeight - margin;
    const capsuleWidth = width - margin * 2;
    context.fillStyle = 'rgba(18, 20, 22, .62)';
    drawRoundedRect(context, margin, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2);
    context.fill();

    const padding = Math.round(capsuleHeight * 0.32);
    const dividerX = capsuleWidth * 0.62;
    context.strokeStyle = color;
    context.globalAlpha = .5;
    context.lineWidth = Math.max(1, base * 0.0012);
    context.beginPath();
    context.moveTo(margin + dividerX, capsuleY + padding * .7);
    context.lineTo(margin + dividerX, capsuleY + capsuleHeight - padding * .7);
    context.stroke();
    context.globalAlpha = 1;

    const centerX = margin + dividerX / 2;
    const paramsX = margin + dividerX + (capsuleWidth - dividerX) / 2;
    const middleY = capsuleY + capsuleHeight / 2;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    let top = middleY;
    if (values.shootTime) top -= fontSize * .8;
    if (values.model) {
      drawWatermarkText(values.model, centerX, top, 600, fontSize * .95, 'center', 'middle', capsuleWidth * .58);
    }
    if (values.shootTime) {
      drawWatermarkText(values.shootTime, centerX, top + fontSize * 1.45, 400, fontSize * .72, 'center', 'middle', null, .72);
    }
    if (params) {
      drawWatermarkText(params, paramsX, middleY, 400, fontSize * .95, 'center', 'middle', capsuleWidth - dividerX - padding * 2);
    }
    if (signature) drawSignature(centerX, capsuleY + capsuleHeight - padding * .7, 'center');
  }

  return canvas;
}

async function downloadWatermarkedImage() {
  const photo = state.currentPhoto;
  if (!photo) return;
  const button = document.getElementById('downloadWatermarkButton');
  button.disabled = true;
  try {
    const settings = getWatermarkSettings(photo);
    const canvas = await watermarkedCanvas(photo);
    const link = document.createElement('a');
    link.download = `${photo.originalName.replace(/\.[^.]+$/, '')}-${settings.template}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    alert(error.message || '水印生成失败');
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  document.getElementById('uploadButton').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (event) => {
    uploadFiles(event.target.files);
    event.target.value = '';
  });

  const dropzone = document.getElementById('dropzone');
  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (event) => {
    uploadFiles(event.dataTransfer?.files);
  });

  document.getElementById('rulesForm').addEventListener('submit', generateCollections);
  document.getElementById('newCollectionButton').addEventListener('click', createCollection);
  document.getElementById('signatureTextButton').addEventListener('click', addTextSignature);
  document.getElementById('signatureInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTextSignature();
    }
  });
  document.getElementById('signatureUploadButton').addEventListener('click', () => document.getElementById('signatureFileInput').click());
  document.getElementById('signatureFileInput').addEventListener('change', (event) => {
    addImageSignature(event.target.files);
    event.target.value = '';
  });
  document.getElementById('signatureSelect').addEventListener('change', (event) => {
    updateCurrentWatermark((settings) => {
      settings.signatureId = event.target.value;
      if (event.target.value) settings.fields.signature = true;
    });
  });
  document.getElementById('multiSelectButton').addEventListener('click', toggleSelectionMode);
  document.getElementById('selectAllButton').addEventListener('click', () => {
    state.photos.forEach((photo) => state.selection.add(photo.id));
    updateSelectionUI();
  });
  document.getElementById('clearSelectionButton').addEventListener('click', clearSelection);
  document.getElementById('bulkDeleteButton').addEventListener('click', bulkDeleteSelected);
  document.getElementById('bulkExportButton').addEventListener('click', openExportModal);
  document.getElementById('exportCloseButton').addEventListener('click', closeExportModal);
  document.getElementById('exportPhotosButton').addEventListener('click', exportSelectedPhotos);
  document.getElementById('exportZipButton').addEventListener('click', exportSelectedZip);
  document.getElementById('exportModal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('exportModal')) closeExportModal();
  });

  document.querySelectorAll('#timeSegment button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('#timeSegment button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.timeGranularity = button.dataset.granularity;
    });
  });

  document.getElementById('rulesButton').addEventListener('click', () => {
    const form = document.getElementById('rulesForm');
    form.classList.toggle('hidden');
    document.getElementById('rulesButton').innerHTML = form.classList.contains('hidden') ? '<i data-icon="chevron-down"></i>' : '<i data-icon="chevron-up"></i>';
    renderIcons(form.parentElement);
  });

  document.getElementById('modalClose').addEventListener('click', closePhotoModal);
  document.getElementById('photoModal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('photoModal')) closePhotoModal();
  });
  document.getElementById('originalButton').addEventListener('click', () => {
    if (!state.currentPhoto) return;
    document.getElementById('previewImage').src = `/uploads/${state.currentPhoto.filename}`;
  });
  document.getElementById('parametersButton').addEventListener('click', () => {
    const parametersPanel = document.getElementById('parametersPanel');
    const watermarkPanel = document.getElementById('watermarkPanel');
    parametersPanel.classList.toggle('hidden');
    watermarkPanel.classList.add('hidden');
  });

  document.getElementById('watermarkButton').addEventListener('click', () => {
    const parametersPanel = document.getElementById('parametersPanel');
    const watermarkPanel = document.getElementById('watermarkPanel');
    watermarkPanel.classList.toggle('hidden');
    parametersPanel.classList.add('hidden');
  });

  document.querySelectorAll('.template-option').forEach((button) => {
    button.addEventListener('click', () => {
      updateCurrentWatermark((settings) => {
        settings.template = button.dataset.template;
      });
    });
  });

  document.querySelectorAll('#watermarkPanel input[data-field]').forEach((input) => {
    input.addEventListener('change', () => {
      updateCurrentWatermark((settings) => {
        settings.fields[input.dataset.field] = input.checked;
        if (input.dataset.field === 'signature' && input.checked && !settings.signatureId) {
          settings.signatureId = state.signatures[0]?.id || '';
        }
      });
    });
  });

  document.getElementById('watermarkSize').addEventListener('input', (event) => {
    updateCurrentWatermark((settings) => {
      settings.size = Number(event.target.value);
    });
  });

  document.querySelectorAll('.color-option').forEach((button) => {
    button.addEventListener('click', () => {
      updateCurrentWatermark((settings) => {
        settings.color = button.dataset.color;
      });
    });
  });

  document.getElementById('watermarkColor').addEventListener('input', (event) => {
    updateCurrentWatermark((settings) => {
      settings.color = event.target.value;
    });
  });

  document.querySelectorAll('#watermarkPanel [data-scope]').forEach((button) => {
    button.addEventListener('click', () => applyWatermarkToScope(button.dataset.scope));
  });

  document.getElementById('fullscreenButton').addEventListener('click', () => {
    const modalMedia = document.querySelector('.modal-media');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      modalMedia.requestFullscreen().catch(() => alert('浏览器拒绝了全屏请求'));
    }
  });

  const modalMedia = document.querySelector('.modal-media');
  modalMedia.addEventListener('fullscreenchange', updateFullscreenNavVisibility);
  modalMedia.addEventListener('mousemove', handleFullscreenMouseMove);
  document.getElementById('prevPhotoButton').addEventListener('click', () => moveCurrentPhoto(-1));
  document.getElementById('nextPhotoButton').addEventListener('click', () => moveCurrentPhoto(1));

  document.getElementById('downloadWatermarkButton').addEventListener('click', downloadWatermarkedImage);
  document.getElementById('deleteButton').addEventListener('click', deletePhoto);

  document.addEventListener('keydown', (event) => {
    const modalOpen = !document.getElementById('photoModal').classList.contains('hidden');
    if (event.key === 'Escape' && modalOpen) {
      closePhotoModal();
    }
    if (modalOpen && event.key === 'ArrowLeft') moveCurrentPhoto(-1);
    if (modalOpen && event.key === 'ArrowRight') moveCurrentPhoto(1);
    if (event.key === 'Escape' && !document.getElementById('exportModal').classList.contains('hidden')) {
      closeExportModal();
    }
  });
}

async function init() {
  bindEvents();
  await renderIcons();
  await Promise.all([loadCollections(), loadPhotos(), loadSignatures()]);
  renderIcons(document.getElementById('parametersPanel'));
}

init();
