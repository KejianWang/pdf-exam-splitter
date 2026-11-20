(function () {
  'use strict';

  const { PDFDocument } = PDFLib;
  const Core = window.PdfExamSplitter;
  const pdfjs = window.pdfjsLib;

  if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }

  const state = {
    file: null,
    sourceBuffer: null,
    pdfInfo: null,
    pdfjsDoc: null,
    currentPage: 1,
    previewMode: 'original',
    direction: 'vertical',
    ratio: 50,
    reverseOrder: false,
    resultBytes: null,
    resultBlob: null,
    resultUrl: null,
    resultDoc: null,
    outputName: '',
    processing: false,
    cancelSignal: { aborted: false },
    deferredPrompt: null,
    renderToken: 0,
    nativeImporting: false,
    nativeListenerRegistered: false,
    nativePollTimer: null,
    activePreset: 'a3',
  };

  const el = {
    app: document.getElementById('app'),
    pickBtn: document.getElementById('pickBtn'),
    fileInput: document.getElementById('fileInput'),
    dropZone: document.getElementById('dropZone'),
    fileMeta: document.getElementById('fileMeta'),
    fileName: document.getElementById('fileName'),
    fileStats: document.getElementById('fileStats'),
    clearFileBtn: document.getElementById('clearFileBtn'),
    resetAllBtn: document.getElementById('resetAllBtn'),
    verticalBtn: document.getElementById('verticalBtn'),
    horizontalBtn: document.getElementById('horizontalBtn'),
    recommendText: document.getElementById('recommendText'),
    ratio: document.getElementById('ratio'),
    resetRatioBtn: document.getElementById('resetRatioBtn'),
    reverseOrderBtn: document.getElementById('reverseOrderBtn'),
    ratioText: document.getElementById('ratioText'),
    ratioHelp: document.getElementById('ratioHelp'),
    pageRange: document.getElementById('pageRange'),
    rangeHelp: document.getElementById('rangeHelp'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageIndicator: document.getElementById('pageIndicator'),
    originalTab: document.getElementById('originalTab'),
    splitTab: document.getElementById('splitTab'),
    previewStage: document.getElementById('previewStage'),
    startBtn: document.getElementById('startBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    shareBtn: document.getElementById('shareBtn'),
    progressPanel: document.getElementById('progressPanel'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    resultPanel: document.getElementById('resultPanel'),
    resultStats: document.getElementById('resultStats'),
    resultPreview: document.getElementById('resultPreview'),
    toast: document.getElementById('toast'),
    installBanner: document.getElementById('installBanner'),
    installBtn: document.getElementById('installBtn'),
    dismissInstallBtn: document.getElementById('dismissInstallBtn'),
    privacyDot: document.getElementById('privacyDot'),
    privacyText: document.getElementById('privacyText'),
    presetBtns: Array.from(document.querySelectorAll('[data-preset]')),
  };

  init();

  function init() {
    bindEvents();
    setDirection('vertical', false);
    updateRatioText();
    updateReverseButton();
    updatePresetState();
    updateActionState();
    updatePrivacyStatus();
    registerServiceWorker();
    loadSharedFileIfNeeded();
    setupNativeIncomingPdf();
  }

  function bindEvents() {
    el.pickBtn.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) loadFile(file);
      el.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((name) => {
      el.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        el.dropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      el.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        el.dropZone.classList.remove('is-dragover');
      });
    });
    el.dropZone.addEventListener('drop', (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    el.clearFileBtn.addEventListener('click', resetFile);
    if (el.resetAllBtn) el.resetAllBtn.addEventListener('click', resetAll);
    el.verticalBtn.addEventListener('click', () => setDirection('vertical', true));
    el.horizontalBtn.addEventListener('click', () => setDirection('horizontal', true));
    el.ratio.addEventListener('input', () => {
      setRatio(Number(el.ratio.value), true);
    });
    if (el.resetRatioBtn) el.resetRatioBtn.addEventListener('click', () => setRatio(50, true));
    if (el.reverseOrderBtn) el.reverseOrderBtn.addEventListener('click', toggleReverseOrder);
    el.presetBtns.forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
    el.pageRange.addEventListener('input', () => {
      updateRangeHelp();
      schedulePreviewRender();
      invalidateResult();
    });
    el.prevPageBtn.addEventListener('click', () => turnPage(-1));
    el.nextPageBtn.addEventListener('click', () => turnPage(1));
    let touchStartX = 0;
    let touchStartY = 0;
    el.previewStage.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: true });
    el.previewStage.addEventListener('touchend', (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch || !state.pdfjsDoc) return;
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        turnPage(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
    el.originalTab.addEventListener('click', () => setPreviewMode('original'));
    el.splitTab.addEventListener('click', () => setPreviewMode('split'));
    el.startBtn.addEventListener('click', startSplit);
    el.cancelBtn.addEventListener('click', () => {
      state.cancelSignal.aborted = true;
      setProgressText('正在取消，请稍等…');
    });
    el.downloadBtn.addEventListener('click', downloadResult);
    el.shareBtn.addEventListener('click', shareResult);

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredPrompt = event;
      if (!localStorage.getItem('pdf-splitter-install-dismissed')) {
        el.installBanner.hidden = false;
      }
    });
    el.installBtn.addEventListener('click', async () => {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice.catch(() => null);
      state.deferredPrompt = null;
      el.installBanner.hidden = true;
    });
    el.dismissInstallBtn.addEventListener('click', () => {
      localStorage.setItem('pdf-splitter-install-dismissed', '1');
      el.installBanner.hidden = true;
    });

    window.addEventListener('online', updatePrivacyStatus);
    window.addEventListener('offline', updatePrivacyStatus);
  }

  async function loadFile(file) {
    try {
      setBusy(true, '正在读取PDF…');
      validateFile(file);
      revokeResultUrl();
      state.file = file;
      state.sourceBuffer = await file.arrayBuffer();
      setProgressText('正在解析PDF，请稍等…');

      const sourceForPdfLib = state.sourceBuffer.slice(0);
      const pdfInfo = await PDFDocument.load(sourceForPdfLib, { ignoreEncryption: false, updateMetadata: false });
      const pageCount = pdfInfo.getPageCount();
      if (pageCount > Core.MAX_PAGE_COUNT) {
        throw new Error(`当前PDF共 ${pageCount} 页，暂不支持超过 ${Core.MAX_PAGE_COUNT} 页的文件。`);
      }

      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(state.sourceBuffer.slice(0)),
        disableAutoFetch: true,
        disableStream: true,
      });
      const pdfjsDoc = await loadingTask.promise;

      state.pdfInfo = pdfInfo;
      state.pdfjsDoc = pdfjsDoc;
      state.currentPage = 1;
      state.resultBytes = null;
      state.resultBlob = null;
      state.resultDoc = null;
      state.outputName = Core.makeOutputName(file.name);

      el.fileName.textContent = file.name;
      el.fileStats.textContent = `${pageCount} 页 · ${Core.formatBytes(file.size)}`;
      el.fileMeta.hidden = false;
      el.pageRange.placeholder = `全部页面(1-${pageCount})`;
      autoRecommendDirection();
      updateRangeHelp();
      updateActionState();
      setBusy(false, 'PDF已导入，可直接开始切分。');
      await renderPreview();
    } catch (err) {
      resetFile();
      showError(normalizeError(err));
    }
  }

  function validateFile(file) {
    const lowerName = (file.name || '').toLowerCase();
    if (!lowerName.endsWith('.pdf') && file.type !== 'application/pdf') {
      throw new Error('请选择PDF格式文件。');
    }
    if (file.size > Core.MAX_FILE_BYTES) {
      throw new Error(`文件过大：${Core.formatBytes(file.size)}。当前版本最多支持 100MB。`);
    }
  }

  function resetFile() {
    state.file = null;
    state.sourceBuffer = null;
    state.pdfInfo = null;
    if (state.pdfjsDoc && typeof state.pdfjsDoc.destroy === 'function') state.pdfjsDoc.destroy();
    state.pdfjsDoc = null;
    state.currentPage = 1;
    el.fileMeta.hidden = true;
    el.pageRange.value = '';
    el.pageRange.placeholder = '全部页面(1-4)';
    el.previewStage.innerHTML = emptyPreviewHtml('请选择PDF文件后查看预览');
    el.pageIndicator.textContent = '- / -';
    state.resultBytes = null;
    state.resultBlob = null;
    state.resultDoc = null;
    state.outputName = '';
    el.resultPanel.hidden = true;
    el.resultPreview.innerHTML = '';
    el.resultStats.textContent = '';
    revokeResultUrl();
    updateActionState();
    updateRangeHelp();
    setProgressText('请先选择PDF文件。');
  }

  function setDirection(direction, userChanged) {
    state.direction = direction;
    const isVertical = direction === 'vertical';
    el.verticalBtn.classList.toggle('is-active', isVertical);
    el.horizontalBtn.classList.toggle('is-active', !isVertical);
    el.verticalBtn.setAttribute('aria-pressed', String(isVertical));
    el.horizontalBtn.setAttribute('aria-pressed', String(!isVertical));
    updateRatioText();
    updateReverseButton();
    updatePresetState();
    if (userChanged) {
      state.activePreset = '';
      invalidateResult();
      schedulePreviewRender();
      toast(isVertical ? '已选择竖向切分。' : '已选择横向切分。');
    }
  }

  function setRatio(value, userChanged) {
    state.ratio = Math.round(Core.clampRatio(Number(value) / 100) * 100);
    el.ratio.value = String(state.ratio);
    updateRatioText();
    if (userChanged) state.activePreset = '';
    updatePresetState();
    if (userChanged) {
      schedulePreviewRender();
      invalidateResult();
    }
  }

  function toggleReverseOrder() {
    state.reverseOrder = !state.reverseOrder;
    state.activePreset = '';
    updateRatioText();
    updateReverseButton();
    updatePresetState();
    invalidateResult();
    schedulePreviewRender();
    toast(state.reverseOrder ? '已反转输出顺序。' : '已恢复默认输出顺序。');
  }

  function updateReverseButton() {
    if (!el.reverseOrderBtn) return;
    el.reverseOrderBtn.textContent = state.direction === 'vertical' ? '左右反转' : '上下反转';
    el.reverseOrderBtn.classList.toggle('is-active', state.reverseOrder);
    el.reverseOrderBtn.setAttribute('aria-pressed', String(state.reverseOrder));
  }

  function resetAll() {
    resetFile();
    state.reverseOrder = false;
    applyPreset('a3', false);
    toast('已清空并恢复默认设置。');
  }

  function applyPreset(name, notify = true) {
    const preset = {
      a3: { direction: 'vertical', ratio: 50, label: 'A3试卷对半' },
      columns: { direction: 'vertical', ratio: 50, label: '双栏文档' },
      stacked: { direction: 'horizontal', ratio: 50, label: '上下分卷' },
    }[name] || { direction: 'vertical', ratio: 50, label: 'A3试卷对半' };
    state.activePreset = name || 'a3';
    setDirection(preset.direction, false);
    setRatio(preset.ratio, false);
    state.reverseOrder = false;
    updateReverseButton();
    updatePresetState();
    invalidateResult();
    schedulePreviewRender();
    if (notify) toast(`已应用预设：${preset.label}`);
  }

  function updatePresetState() {
    if (!el.presetBtns) return;
    el.presetBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.preset === state.activePreset));
  }

  async function autoRecommendDirection() {
    try {
      const firstPage = await state.pdfjsDoc.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      const recommended = viewport.width >= viewport.height ? 'vertical' : 'horizontal';
      state.activePreset = '';
      setDirection(recommended, false);
      el.recommendText.textContent = recommended === 'vertical'
        ? '检测到横版，推荐竖向切分'
        : '检测到竖版，推荐横向切分';
    } catch (err) {
      el.recommendText.textContent = '检测到横版，推荐竖向切分';
    }
  }

  function updateRatioText() {
    const first = state.ratio;
    const second = 100 - first;
    el.ratioText.textContent = `${first}:${second}`;
    if (state.direction === 'vertical') {
      el.ratioHelp.textContent = state.reverseOrder ? `左右顺序：右侧 ${second}% → 左侧 ${first}%` : `左右顺序：左侧 ${first}% → 右侧 ${second}%`;
    } else {
      el.ratioHelp.textContent = state.reverseOrder ? `上下顺序：下侧 ${second}% → 上侧 ${first}%` : `上下顺序：上侧 ${first}% → 下侧 ${second}%`;
    }
  }

  function updateRangeHelp() {
    if (!state.pdfjsDoc) {
      el.rangeHelp.textContent = '留空切分全部页面';
      return;
    }
    try {
      const parsed = Core.parsePageRanges(el.pageRange.value, state.pdfjsDoc.numPages);
      if (parsed.mode === 'all') {
        el.rangeHelp.textContent = `切分全部 ${state.pdfjsDoc.numPages} 页`;
      } else {
        const unchanged = state.pdfjsDoc.numPages - parsed.indexes.size;
        el.rangeHelp.textContent = `切分 ${parsed.indexes.size} 页，${unchanged} 页不变`;
      }
      el.rangeHelp.classList.remove('is-error');
    } catch (err) {
      el.rangeHelp.textContent = err.message;
      el.rangeHelp.classList.add('is-error');
    }
  }

  function setPreviewMode(mode) {
    state.previewMode = mode;
    el.originalTab.classList.toggle('is-active', mode === 'original');
    el.splitTab.classList.toggle('is-active', mode === 'split');
    el.originalTab.setAttribute('aria-selected', String(mode === 'original'));
    el.splitTab.setAttribute('aria-selected', String(mode === 'split'));
    renderPreview();
  }

  function schedulePreviewRender() {
    if (!state.pdfjsDoc) return;
    window.clearTimeout(schedulePreviewRender.timer);
    schedulePreviewRender.timer = window.setTimeout(renderPreview, 80);
  }

  function turnPage(delta) {
    if (!state.pdfjsDoc) return;
    const next = Math.max(1, Math.min(state.pdfjsDoc.numPages, state.currentPage + delta));
    if (next === state.currentPage) return;
    state.currentPage = next;
    renderPreview();
  }

  async function renderPreview() {
    const token = ++state.renderToken;
    if (!state.pdfjsDoc) {
      el.previewStage.innerHTML = emptyPreviewHtml('请选择PDF文件后查看预览');
      return;
    }

    updatePageButtons();
    el.previewStage.innerHTML = '<div class="loading-inline">正在生成预览…</div>';
    try {
      const page = await state.pdfjsDoc.getPage(state.currentPage);
      if (token !== state.renderToken) return;
      const rendered = await renderPdfPageToCanvas(page, getPreviewMaxWidth());
      if (token !== state.renderToken) return;

      const selected = isCurrentPageSelected();
      if (state.previewMode === 'split' && selected) {
        showSplitPreview(rendered.canvas);
      } else {
        showOriginalPreview(rendered.canvas, selected);
      }
    } catch (err) {
      if (token !== state.renderToken) return;
      el.previewStage.innerHTML = emptyPreviewHtml('预览生成失败，请尝试直接切分。');
    }
  }

  function getPreviewMaxWidth() {
    const rect = el.previewStage.getBoundingClientRect();
    return Math.max(260, Math.min(760, rect.width - 28 || window.innerWidth - 48));
  }

  async function renderPdfPageToCanvas(page, maxCssWidth) {
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = Math.min(1.8, Math.max(0.2, maxCssWidth / baseViewport.width));
    const viewport = page.getViewport({ scale: cssScale });
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    await page.render({
      canvasContext: context,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;
    return { canvas, viewport, dpr };
  }

  function showOriginalPreview(canvas, selected) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    const shell = document.createElement('div');
    shell.className = 'canvas-shell';
    shell.appendChild(canvas);
    if (selected) {
      const line = document.createElement('div');
      line.className = 'split-line ' + (state.direction === 'vertical' ? 'is-vertical' : 'is-horizontal');
      if (state.direction === 'vertical') line.style.left = `${state.ratio}%`;
      else line.style.top = `${state.ratio}%`;
      shell.appendChild(line);
    }
    wrap.appendChild(shell);

    const note = document.createElement('div');
    note.className = selected ? 'preview-note' : 'preview-note warn';
    note.textContent = selected
      ? '红色虚线为切割位。'
      : '该页不在切分范围内，导出时将保持原样。';
    wrap.appendChild(note);
    el.previewStage.replaceChildren(wrap);
  }

  function showSplitPreview(sourceCanvas) {
    const list = document.createElement('div');
    list.className = 'split-preview-list';
    const ratio = Core.clampRatio(state.ratio / 100);
    const pieces = [];
    if (state.direction === 'vertical') {
      const splitX = Math.round(sourceCanvas.width * ratio);
      pieces.push({ name: '左侧', canvas: cropCanvas(sourceCanvas, 0, 0, splitX, sourceCanvas.height) });
      pieces.push({ name: '右侧', canvas: cropCanvas(sourceCanvas, splitX, 0, sourceCanvas.width - splitX, sourceCanvas.height) });
    } else {
      const topH = Math.round(sourceCanvas.height * ratio);
      pieces.push({ name: '上侧', canvas: cropCanvas(sourceCanvas, 0, 0, sourceCanvas.width, topH) });
      pieces.push({ name: '下侧', canvas: cropCanvas(sourceCanvas, 0, topH, sourceCanvas.width, sourceCanvas.height - topH) });
    }
    if (state.reverseOrder) pieces.reverse();
    pieces.forEach((piece, index) => list.appendChild(makePreviewPiece(`输出第 ${index + 1} 页：${piece.name}`, piece.canvas)));
    el.previewStage.replaceChildren(list);
  }

  function cropCanvas(src, sx, sy, sw, sh) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    canvas.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas;
  }

  function makePreviewPiece(title, canvas) {
    const item = document.createElement('figure');
    item.className = 'preview-piece';
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    item.appendChild(caption);
    item.appendChild(canvas);
    return item;
  }

  function updatePageButtons() {
    const total = state.pdfjsDoc ? state.pdfjsDoc.numPages : 0;
    el.pageIndicator.textContent = total ? `${state.currentPage} / ${total}` : '- / -';
    el.prevPageBtn.disabled = !total || state.currentPage <= 1;
    el.nextPageBtn.disabled = !total || state.currentPage >= total;
  }

  function isCurrentPageSelected() {
    if (!state.pdfjsDoc) return false;
    try {
      const parsed = Core.parsePageRanges(el.pageRange.value, state.pdfjsDoc.numPages);
      return parsed.indexes.has(state.currentPage - 1);
    } catch (err) {
      return false;
    }
  }

  async function startSplit() {
    if (!state.sourceBuffer || state.processing) return;
    try {
      const parsed = Core.parsePageRanges(el.pageRange.value, state.pdfInfo.getPageCount());
      state.processing = true;
      state.cancelSignal = { aborted: false };
      invalidateResult(false);
      updateActionState();
      showProgress(0, '准备开始切分…');

      const bytes = await Core.splitPdfBytes(state.sourceBuffer.slice(0), {
        direction: state.direction,
        ratio: state.ratio / 100,
        pageIndexes: parsed.indexes,
        reverseOrder: state.reverseOrder,
        signal: state.cancelSignal,
        onProgress: ({ current, total, percent }) => {
          showProgress(percent, `正在处理第 ${current} / ${total} 页（${percent}%）`);
        },
      }, { PDFDocument });

      state.resultBytes = bytes;
      state.resultBlob = new Blob([bytes], { type: 'application/pdf' });
      state.outputName = Core.makeOutputName(state.file.name);
      state.resultDoc = await PDFDocument.load(bytes.slice ? bytes.slice(0) : bytes, { updateMetadata: false });
      showProgress(100, '切分完成。');
      showResult();
      toast('切分完成，可以保存或分享。');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        showProgress(0, '已取消切分。');
        toast('已取消切分。');
      } else {
        showError(normalizeError(err, '处理失败，请重试。'));
      }
    } finally {
      state.processing = false;
      updateActionState();
    }
  }

  function invalidateResult(clearPanel = true) {
    revokeResultUrl();
    state.resultBytes = null;
    state.resultBlob = null;
    state.resultDoc = null;
    if (clearPanel) {
      el.resultPanel.hidden = true;
      el.resultPreview.innerHTML = '';
      el.resultStats.textContent = '';
    }
    updateActionState();
  }

  function revokeResultUrl() {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
  }

  async function showResult() {
    const outPages = state.resultDoc.getPageCount();
    el.resultStats.textContent = `${state.outputName} · ${outPages} 页 · ${Core.formatBytes(state.resultBlob.size)}`;
    el.resultPanel.hidden = false;
    await renderResultPreview();
  }

  async function renderResultPreview() {
    el.resultPreview.innerHTML = '<div class="loading-inline">正在生成结果预览…</div>';
    try {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(state.resultBytes.slice(0)), disableAutoFetch: true, disableStream: true }).promise;
      const total = Math.min(3, doc.numPages);
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= total; i += 1) {
        const page = await doc.getPage(i);
        const rendered = await renderPdfPageToCanvas(page, 220);
        const item = makePreviewPiece(`结果第 ${i} 页`, rendered.canvas);
        frag.appendChild(item);
      }
      el.resultPreview.replaceChildren(frag);
      if (typeof doc.destroy === 'function') doc.destroy();
    } catch (err) {
      el.resultPreview.innerHTML = '<div class="preview-note warn">结果已生成，但当前浏览器无法预览，可直接保存。</div>';
    }
  }

  async function downloadResult() {
    if (!state.resultBlob) return;
    try {
      if (isNativeApp() && getCapPlugin('Filesystem')) {
        const saved = await writeResultFile('DOCUMENTS');
        toast(`已保存到手机文档目录：${saved.path || state.outputName}`, 5000);
        return;
      }

      if (/MicroMessenger/i.test(navigator.userAgent)) {
        toast('微信内下载可能受限：请点右上角“在浏览器中打开”后保存。', 5000);
      }
      revokeResultUrl();
      state.resultUrl = URL.createObjectURL(state.resultBlob);
      const a = document.createElement('a');
      a.href = state.resultUrl;
      a.download = state.outputName || '试卷_切分后.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      toast('保存失败，请尝试使用“系统分享”发送或保存。', 5000);
    }
  }

  async function shareResult() {
    if (!state.resultBlob) return;
    try {
      const NativeShare = getCapPlugin('Share');
      if (isNativeApp() && NativeShare && getCapPlugin('Filesystem')) {
        const saved = await writeResultFile('CACHE');
        await NativeShare.share({
          title: '切分后的试卷PDF',
          text: 'PDF试卷切分助手已在本机生成文件。',
          url: saved.uri,
          dialogTitle: '分享切分后的PDF',
        });
        return;
      }

      const file = new File([state.resultBlob], state.outputName || '试卷_切分后.pdf', { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ title: '切分后的试卷PDF', text: 'PDF试卷切分助手已在本机生成文件。', files: [file] });
      } else {
        await downloadResult();
        toast('当前浏览器不支持系统分享，已改为保存到本地。');
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('分享失败，可先保存到本地再发送。');
    }
  }

  function isNativeApp() {
    return Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  }

  function getCapPlugin(name) {
    if (!window.Capacitor) return null;
    window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    if (window.Capacitor.Plugins[name]) return window.Capacitor.Plugins[name];

    // Custom Android plugins are not always pre-populated in window.Capacitor.Plugins.
    // Explicitly registering the proxy is required before calling native methods.
    if (typeof window.Capacitor.registerPlugin === 'function') {
      try {
        window.Capacitor.Plugins[name] = window.Capacitor.registerPlugin(name);
        return window.Capacitor.Plugins[name];
      } catch (err) {
        console.warn('Capacitor 插件注册失败：', name, err);
      }
    }
    return null;
  }

  async function writeResultFile(directory) {
    const Filesystem = getCapPlugin('Filesystem');
    if (!Filesystem || !state.resultBlob) throw new Error('原生文件保存能力不可用。');
    const base64 = await blobToBase64(state.resultBlob);
    return await Filesystem.writeFile({
      path: state.outputName || '试卷_切分后.pdf',
      data: base64,
      directory,
      recursive: true,
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function setupNativeIncomingPdf(attempt = 0) {
    const maxAttempts = 20;
    const IncomingPdf = getCapPlugin('IncomingPdf');
    if (!isNativeApp() || !IncomingPdf) {
      if (attempt < maxAttempts) {
        window.setTimeout(() => setupNativeIncomingPdf(attempt + 1), 250);
      }
      return;
    }

    if (!state.nativeListenerRegistered && typeof IncomingPdf.addListener === 'function') {
      state.nativeListenerRegistered = true;
      try {
        await IncomingPdf.addListener('incomingPdf', () => {
          loadNativePendingPdf('系统已传入PDF，正在读取…');
        });
      } catch (err) {
        state.nativeListenerRegistered = false;
        console.warn('IncomingPdf listener 注册失败：', err);
      }
    }

    startNativePendingPdfPolling();
  }

  function startNativePendingPdfPolling() {
    if (state.nativePollTimer) window.clearInterval(state.nativePollTimer);
    let remaining = 12;
    const poll = () => {
      loadNativePendingPdf('正在读取外部打开的PDF…');
      remaining -= 1;
      if (remaining <= 0 && state.nativePollTimer) {
        window.clearInterval(state.nativePollTimer);
        state.nativePollTimer = null;
      }
    };
    poll();
    state.nativePollTimer = window.setInterval(poll, 500);
  }

  async function loadNativePendingPdf(message) {
    if (state.nativeImporting) return;
    const IncomingPdf = getCapPlugin('IncomingPdf');
    if (!IncomingPdf || typeof IncomingPdf.getPendingFile !== 'function') return;

    state.nativeImporting = true;
    try {
      const payload = await IncomingPdf.getPendingFile();
      if (!payload || !payload.available || !payload.data) return;

      toast(message || '已接收外部PDF。');
      const file = base64ToFile(payload.data, payload.name || 'shared.pdf', payload.mimeType || 'application/pdf');
      await loadFile(file);
    } catch (err) {
      console.warn('读取外部PDF失败：', err);
      toast('未能读取微信传入的PDF，请先保存到手机后再从应用内选择。', 5000);
    } finally {
      state.nativeImporting = false;
    }
  }

  function base64ToFile(base64, name, mimeType) {
    const binary = atob(base64);
    const chunkSize = 64 * 1024;
    const chunks = [];
    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const slice = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(slice.length);
      for (let i = 0; i < slice.length; i += 1) {
        bytes[i] = slice.charCodeAt(i);
      }
      chunks.push(bytes);
    }
    return new File(chunks, name || 'shared.pdf', { type: mimeType || 'application/pdf' });
  }


  function setBusy(busy, message) {
    if (busy) {
      el.progressPanel.hidden = false;
      el.progressBar.style.width = '0%';
    }
    if (message) setProgressText(message);
  }

  function showProgress(percent, text) {
    el.progressPanel.hidden = false;
    el.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    setProgressText(text);
  }

  function setProgressText(text) {
    el.progressText.textContent = text;
  }

  function updateActionState() {
    const hasFile = Boolean(state.sourceBuffer && state.pdfInfo);
    const hasResult = Boolean(state.resultBlob);
    el.startBtn.disabled = !hasFile || state.processing;
    el.startBtn.textContent = hasResult ? '重新切分' : '开始切分';
    el.cancelBtn.hidden = !state.processing;
    el.downloadBtn.disabled = !hasResult || state.processing;
    el.shareBtn.disabled = !hasResult || state.processing;
    el.verticalBtn.disabled = state.processing;
    el.horizontalBtn.disabled = state.processing;
    el.ratio.disabled = state.processing;
    if (el.resetRatioBtn) el.resetRatioBtn.disabled = state.processing;
    if (el.reverseOrderBtn) el.reverseOrderBtn.disabled = state.processing;
    el.presetBtns.forEach((btn) => { btn.disabled = state.processing; });
    el.pageRange.disabled = state.processing;
  }

  function updatePrivacyStatus() {
    if (navigator.onLine) {
      el.privacyDot.className = 'status-dot';
      el.privacyText.textContent = '本工具不上传文件；联网仅用于首次打开/更新页面资源。';
    } else {
      el.privacyDot.className = 'status-dot is-offline';
      el.privacyText.textContent = '当前离线：PWA缓存生效，仍可正常切分PDF。';
    }
  }

  function showError(message) {
    setProgressText(message);
    toast(message, 5000);
  }

  function normalizeError(err, fallback) {
    const msg = err && err.message ? err.message : fallback || '文件解析失败，请检查文件是否完整。';
    if (/encrypted|password/i.test(msg)) return '暂不支持加密或受权限保护的PDF。';
    if (/Invalid PDF|Failed to parse|No PDF header|bad XRef|xref/i.test(msg)) return '文件解析失败，请检查文件是否完整。';
    return msg;
  }

  function toast(message, duration = 3000) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { el.toast.hidden = true; }, duration);
  }

  function emptyPreviewHtml(text) {
    return `<div class="empty-state"><div class="empty-icon">📄</div><p>${escapeHtml(text)}</p></div>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('Service Worker 注册失败：', err);
    }
  }

  async function loadSharedFileIfNeeded() {
    const params = new URLSearchParams(location.search);
    if (!params.has('shared')) return;
    try {
      const record = await readAndDeleteSharedFile();
      if (record && record.file) {
        toast('已接收系统分享的PDF。');
        await loadFile(record.file);
        history.replaceState(null, '', location.pathname);
      }
    } catch (err) {
      toast('未能读取分享文件，请手动选择PDF。');
    }
  }

  function openShareDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('pdf-exam-splitter-share', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readAndDeleteSharedFile() {
    const db = await openShareDb();
    try {
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        let value;
        const getReq = store.get('latest');
        getReq.onsuccess = () => {
          value = getReq.result;
          store.delete('latest');
        };
        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return record;
    } finally {
      db.close();
    }
  }
})();


