(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PdfExamSplitter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_PAGE_COUNT = 200;
  // 标准 A4 纸张（单位 pt，72dpi）：210mm × 297mm
  const A4_SHORT_SIDE = 595.276;
  const A4_LONG_SIDE = 841.89;

  function degrees(angle) {
    return { type: 'degrees', angle };
  }

  function clampRatio(ratio) {
    const value = Number(ratio);
    if (!Number.isFinite(value)) return 0.5;
    return Math.min(0.7, Math.max(0.3, value));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function makeOutputName(fileName) {
    const safeName = (fileName || '试卷.pdf').replace(/[\\/:*?"<>|]/g, '_');
    return safeName.replace(/\.pdf$/i, '') + '_切分后.pdf';
  }

  function parsePageRanges(input, totalPages) {
    if (!Number.isInteger(totalPages) || totalPages < 1) {
      throw new Error('PDF页数异常，无法解析页码范围。');
    }
    const all = Array.from({ length: totalPages }, (_, i) => i);
    const raw = String(input || '').trim();
    if (!raw) {
      return { mode: 'all', indexes: new Set(all), display: '全部页面' };
    }

    const normalized = raw.replace(/[，、；;]/g, ',').replace(/\s+/g, ',');
    const parts = normalized.split(',').filter(Boolean);
    const indexes = new Set();

    for (const part of parts) {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
      if (!match) {
        throw new Error(`页码范围“${part}”格式不正确，请输入类似 1-5,8 的格式。`);
      }
      let start = Number(match[1]);
      let end = match[2] ? Number(match[2]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
        throw new Error('页码必须是大于 0 的整数。');
      }
      if (start > end) [start, end] = [end, start];
      if (end > totalPages) {
        throw new Error(`页码 ${end} 超出文件总页数 ${totalPages}。`);
      }
      for (let p = start; p <= end; p += 1) indexes.add(p - 1);
    }

    if (indexes.size === 0) {
      throw new Error('请至少输入一个需要切分的页码。');
    }
    return { mode: indexes.size === totalPages ? 'all' : 'partial', indexes, display: raw };
  }

  function readRotation(page) {
    try {
      if (typeof page.getRotation !== 'function') return 0;
      const rotation = page.getRotation();
      const angle = rotation && typeof rotation === 'object' ? Number(rotation.angle) : Number(rotation);
      if (!Number.isFinite(angle)) return 0;
      const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
      return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
    } catch (err) {
      return 0;
    }
  }

  function pageBox(page) {
    const size = page.getSize();
    let box = null;
    if (typeof page.getCropBox === 'function') {
      const crop = page.getCropBox();
      if (crop && Number.isFinite(crop.width) && Number.isFinite(crop.height) && crop.width > 0 && crop.height > 0) {
        const x = Number(crop.x || 0);
        const y = Number(crop.y || 0);
        box = { left: x, bottom: y, right: x + crop.width, top: y + crop.height, width: crop.width, height: crop.height };
      }
    }
    if (!box) {
      box = { left: 0, bottom: 0, right: size.width, top: size.height, width: size.width, height: size.height };
    }
    // 旋转 90/270 度的页面，视觉宽高与 MediaBox 宽高互换，切分方向需按视觉方向计算。
    box.rotation = readRotation(page);
    return box;
  }

  // 把“视觉坐标系”中的切分位置换算回页面自身坐标系（未旋转）。
  function clipBoxInPageSpace(box, direction, ratio, part) {
    const rotation = box.rotation || 0;
    const width = box.width;
    const height = box.height;
    const first = part === 0;

    if (rotation === 0) {
      if (direction === 'vertical') {
        const splitX = box.left + width * ratio;
        return first
          ? { left: box.left, bottom: box.bottom, right: splitX, top: box.top }
          : { left: splitX, bottom: box.bottom, right: box.right, top: box.top };
      }
      const splitY = box.top - height * ratio;
      return first
        ? { left: box.left, bottom: splitY, right: box.right, top: box.top }
        : { left: box.left, bottom: box.bottom, right: box.right, top: splitY };
    }

    if (rotation === 180) {
      if (direction === 'vertical') {
        const splitX = box.right - width * ratio;
        return first
          ? { left: splitX, bottom: box.bottom, right: box.right, top: box.top }
          : { left: box.left, bottom: box.bottom, right: splitX, top: box.top };
      }
      const splitY = box.bottom + height * ratio;
      return first
        ? { left: box.left, bottom: box.bottom, right: box.right, top: splitY }
        : { left: box.left, bottom: splitY, right: box.right, top: box.top };
    }

    if (rotation === 90) {
      if (direction === 'vertical') {
        const splitY = box.bottom + height * ratio;
        return first
          ? { left: box.left, bottom: box.bottom, right: box.right, top: splitY }
          : { left: box.left, bottom: splitY, right: box.right, top: box.top };
      }
      const splitX = box.left + width * ratio;
      return first
        ? { left: box.left, bottom: box.bottom, right: splitX, top: box.top }
        : { left: splitX, bottom: box.bottom, right: box.right, top: box.top };
    }

    // rotation === 270
    if (direction === 'vertical') {
      const splitY = box.top - height * ratio;
      return first
        ? { left: box.left, bottom: splitY, right: box.right, top: box.top }
        : { left: box.left, bottom: box.bottom, right: box.right, top: splitY };
    }
    const splitX = box.right - width * ratio;
    return first
      ? { left: splitX, bottom: box.bottom, right: box.right, top: box.top }
      : { left: box.left, bottom: box.bottom, right: splitX, top: box.top };
  }

  async function splitPdfBytes(srcBytes, options, deps) {
    const PDFDocument = deps && deps.PDFDocument;
    if (!PDFDocument) throw new Error('PDF处理库未加载，请刷新页面后重试。');

    const direction = options && options.direction === 'horizontal' ? 'horizontal' : 'vertical';
    const ratio = clampRatio(options && options.ratio);
    const pageIndexes = options && options.pageIndexes;
    const reverseOrder = Boolean(options && options.reverseOrder);
    const onProgress = typeof (options && options.onProgress) === 'function' ? options.onProgress : function () {};
    const signal = options && options.signal;

    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: false, updateMetadata: false });
    const totalPages = src.getPageCount();
    if (totalPages > MAX_PAGE_COUNT) throw new Error(`暂不支持超过 ${MAX_PAGE_COUNT} 页的PDF。`);

    const out = await PDFDocument.create();
    out.setTitle('PDF试卷切分结果');
    out.setProducer('PDF试卷切分助手（离线版）');
    out.setCreator('PDF试卷切分助手');
    out.setCreationDate(new Date());
    out.setModificationDate(new Date());

    for (let i = 0; i < totalPages; i += 1) {
      if (signal && signal.aborted) {
        const err = new Error('已取消切分。');
        err.name = 'AbortError';
        throw err;
      }

      const sourcePage = src.getPage(i);
      const box = pageBox(sourcePage);
      const shouldSplit = !pageIndexes || pageIndexes.has(i);

      if (!shouldSplit) {
        // 未选中的页面不切分，但同样输出为铺满的 A4，保证整份文件可直接 A4 打印。
        await appendA4Page(out, sourcePage, box, box.rotation);
      } else {
        const firstBox = clipBoxInPageSpace(box, direction, ratio, 0);
        const secondBox = clipBoxInPageSpace(box, direction, ratio, 1);
        const order = reverseOrder ? [secondBox, firstBox] : [firstBox, secondBox];
        for (const clipBox of order) {
          await appendA4Page(out, sourcePage, clipBox, box.rotation);
        }
      }

      onProgress({ current: i + 1, total: totalPages, percent: Math.round(((i + 1) / totalPages) * 100) });
      if (typeof requestAnimationFrame === 'function') {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return await out.save({ useObjectStreams: true, addDefaultPage: false });
  }

  // 根据裁剪块的视觉横竖方向，计算输出页在“页面坐标系”下应有的 A4 尺寸。
  // 若源页面带 /Rotate 90/270，页面坐标系与视觉坐标系宽高互换，需要同步交换。
  function a4PageSize(clipWidth, clipHeight, rotation) {
    const swapped = rotation === 90 || rotation === 270;
    const visualWidth = swapped ? clipHeight : clipWidth;
    const visualHeight = swapped ? clipWidth : clipHeight;
    const landscape = visualWidth > visualHeight;
    const visualA4Width = landscape ? A4_LONG_SIDE : A4_SHORT_SIDE;
    const visualA4Height = landscape ? A4_SHORT_SIDE : A4_LONG_SIDE;
    return swapped
      ? { width: visualA4Height, height: visualA4Width }
      : { width: visualA4Width, height: visualA4Height };
  }

  // 输出页固定为标准 A4 纸张尺寸，裁剪出的内容铺满整页，可直接用 A4 纸打印、无需缩放。
  async function appendA4Page(outDoc, sourcePage, clipBox, rotation) {
    const clipWidth = Math.max(1, clipBox.right - clipBox.left);
    const clipHeight = Math.max(1, clipBox.top - clipBox.bottom);
    const embedded = await outDoc.embedPage(sourcePage, clipBox);

    const size = a4PageSize(clipWidth, clipHeight, rotation);
    const page = outDoc.addPage([size.width, size.height]);
    if (typeof page.setMediaBox === 'function') page.setMediaBox(0, 0, size.width, size.height);
    if (typeof page.setCropBox === 'function') page.setCropBox(0, 0, size.width, size.height);

    page.drawPage(embedded, { x: 0, y: 0, width: size.width, height: size.height });
    if (rotation) page.setRotation(degrees(rotation));
  }

  return {
    MAX_FILE_BYTES,
    MAX_PAGE_COUNT,
    clampRatio,
    formatBytes,
    makeOutputName,
    parsePageRanges,
    splitPdfBytes,
  };
});
