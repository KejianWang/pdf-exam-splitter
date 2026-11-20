const fs = require('fs');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');

const { PDFDocument, StandardFonts, rgb, degrees } = require('../public/vendor/pdf-lib.min.js');
const Splitter = require('../public/pdf-splitter.js');

const A4_SHORT = 595.276;
const A4_LONG = 841.89;

function approx(actual, expected, epsilon = 0.01) {
  assert(Math.abs(actual - expected) <= epsilon, `Expected ${actual} ≈ ${expected}`);
}

function assertA4(page, orientation) {
  const { width, height } = page.getSize();
  const visualWidth = orientation === 'landscape' ? A4_LONG : A4_SHORT;
  const visualHeight = orientation === 'landscape' ? A4_SHORT : A4_LONG;
  const rotation = page.getRotation().angle || 0;
  const swapped = ((rotation % 180) + 180) % 180 !== 0;
  const expectedWidth = swapped ? visualHeight : visualWidth;
  const expectedHeight = swapped ? visualWidth : visualHeight;
  approx(width, expectedWidth, 0.1);
  approx(height, expectedHeight, 0.1);
  const media = page.getMediaBox();
  approx(media.x, 0);
  approx(media.y, 0);
  approx(media.width, expectedWidth, 0.1);
  approx(media.height, expectedHeight, 0.1);
  const crop = page.getCropBox();
  approx(crop.x, 0);
  approx(crop.y, 0);
  approx(crop.width, expectedWidth, 0.1);
  approx(crop.height, expectedHeight, 0.1);
  assertEmbeddedPageFills(page, expectedWidth, expectedHeight);
}

function embeddedPageInfo(page) {
  const context = page.node.context;
  const resources = page.node.Resources();
  const xobjects = context.lookup(resources.get(context.obj('XObject')));
  const entries = xobjects.entries();
  assert.strictEqual(entries.length, 1, '每个输出页应只有一个嵌入的裁剪页');
  const embedded = context.lookup(entries[0][1]);
  const bbox = embedded.dict.get(context.obj('BBox')).asArray().map((n) => n.asNumber());
  const matrixEntry = embedded.dict.get(context.obj('Matrix'));
  const matrix = matrixEntry ? matrixEntry.asArray().map((n) => n.asNumber()) : [1, 0, 0, 1, 0, 0];

  const contents = page.node.Contents();
  const refs = contents.asArray ? contents.asArray() : [contents];
  const content = refs.map((ref) => {
    const stream = ref.getContents ? ref : context.lookup(ref);
    const bytes = Buffer.from(stream.getContents());
    try {
      return zlib.inflateSync(bytes).toString('latin1');
    } catch (err) {
      return bytes.toString('latin1');
    }
  }).join('\n');
  assert(/\/EmbeddedPdfPage-[^\s]+\s+Do/.test(content), '输出页应绘制嵌入的裁剪页');
  const number = '[+\\-\\d.eE]+';
  const cmPattern = new RegExp(`(${number})\\s+(${number})\\s+(${number})\\s+(${number})\\s+(${number})\\s+(${number})\\s+cm`, 'g');
  const drawMatrix = [1, 0, 0, 1, 0, 0];
  const matrices = [...content.matchAll(cmPattern)].map((match) => match.slice(1, 7).map(Number));
  assert(matrices.length > 0, '输出页应包含内容缩放矩阵');
  const combined = matrices.reduce((current, next) => multiplyMatrices(current, next), drawMatrix);
  return { bbox, matrix, drawMatrix: combined };
}

function multiplyMatrices(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformPoint(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function assertEmbeddedPageFills(page, expectedWidth, expectedHeight) {
  const { bbox, matrix, drawMatrix } = embeddedPageInfo(page);
  const corners = [
    transformPoint(matrix, bbox[0], bbox[1]),
    transformPoint(matrix, bbox[2], bbox[1]),
    transformPoint(matrix, bbox[0], bbox[3]),
    transformPoint(matrix, bbox[2], bbox[3]),
  ].map(([x, y]) => transformPoint(drawMatrix, x, y));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  approx(Math.min(...xs), 0);
  approx(Math.min(...ys), 0);
  approx(Math.max(...xs), expectedWidth);
  approx(Math.max(...ys), expectedHeight);
}

function assertEmbeddedClip(page, expected) {
  const { bbox } = embeddedPageInfo(page);
  approx(bbox[0], expected.left);
  approx(bbox[1], expected.bottom);
  approx(bbox[2], expected.right);
  approx(bbox[3], expected.top);
}

async function makeSamplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const width = 1190;
  const height = 842;

  for (let p = 1; p <= 2; p += 1) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width: width / 2, height, color: rgb(0.9, 0.96, 1) });
    page.drawRectangle({ x: width / 2, y: 0, width: width / 2, height, color: rgb(1, 0.94, 0.88) });
    page.drawText(`SOURCE ${p} LEFT`, { x: 60, y: height - 90, size: 36, font, color: rgb(0, 0.18, 0.6) });
    page.drawText(`SOURCE ${p} RIGHT`, { x: width / 2 + 60, y: height - 90, size: 36, font, color: rgb(0.58, 0.1, 0) });
    page.drawLine({ start: { x: width / 2, y: 0 }, end: { x: width / 2, y: height }, thickness: 2, color: rgb(0.85, 0.1, 0.2) });
  }

  return doc.save();
}

(async () => {
  assert.strictEqual(Splitter.makeOutputName('数学试卷.pdf'), '数学试卷_切分后.pdf');
  const ranges = Splitter.parsePageRanges('1-2, 4', 5);
  assert.deepStrictEqual([...ranges.indexes], [0, 1, 3]);

  const srcBytes = await makeSamplePdf();

  const verticalBytes = await Splitter.splitPdfBytes(srcBytes, {
    direction: 'vertical',
    ratio: 0.5,
    pageIndexes: Splitter.parsePageRanges('', 2).indexes,
  }, { PDFDocument });
  const verticalDoc = await PDFDocument.load(verticalBytes);
  assert.strictEqual(verticalDoc.getPageCount(), 4, '竖向切分后页数应翻倍');
  for (const page of verticalDoc.getPages()) {
    // 1190×842 竖切一半 → 595×842（竖版），输出为纵向 A4 并铺满
    assertA4(page, 'portrait');
  }

  const rangeBytes = await Splitter.splitPdfBytes(srcBytes, {
    direction: 'vertical',
    ratio: 0.5,
    pageIndexes: Splitter.parsePageRanges('1', 2).indexes,
  }, { PDFDocument });
  const rangeDoc = await PDFDocument.load(rangeBytes);
  assert.strictEqual(rangeDoc.getPageCount(), 3, '只切第1页时应输出3页');
  assertA4(rangeDoc.getPage(0), 'portrait');
  assertA4(rangeDoc.getPage(1), 'portrait');
  // 未切分的横版原页 → 横向 A4
  assertA4(rangeDoc.getPage(2), 'landscape');

  const reverseBytes = await Splitter.splitPdfBytes(srcBytes, {
    direction: 'vertical',
    ratio: 0.4,
    reverseOrder: true,
    pageIndexes: Splitter.parsePageRanges('1', 2).indexes,
  }, { PDFDocument });
  const reverseDoc = await PDFDocument.load(reverseBytes);
  assert.strictEqual(reverseDoc.getPageCount(), 3, '反转切分仍应只切选中页');
  // ratio=0.4 时两块宽度不同，但都铺满纵向 A4
  assertA4(reverseDoc.getPage(0), 'portrait');
  assertA4(reverseDoc.getPage(1), 'portrait');

  const horizontalBytes = await Splitter.splitPdfBytes(srcBytes, {
    direction: 'horizontal',
    ratio: 0.6,
    pageIndexes: Splitter.parsePageRanges('', 2).indexes,
  }, { PDFDocument });
  const horizontalDoc = await PDFDocument.load(horizontalBytes);
  assert.strictEqual(horizontalDoc.getPageCount(), 4, '横向切分后页数应翻倍');
  for (const page of horizontalDoc.getPages()) {
    // 1190×505 / 1190×337 都是横版 → 横向 A4 并铺满
    assertA4(page, 'landscape');
  }

  // 旋转页必须按用户看到的上/下方向切分，同时覆盖非零 CropBox 原点。
  for (const rotation of [90, 270]) {
    const rotatedSource = await PDFDocument.create();
    const rotatedPage = rotatedSource.addPage([942, 1290]);
    rotatedPage.setCropBox(100, 50, 842, 1190);
    rotatedPage.drawRectangle({ x: 100, y: 50, width: 842, height: 1190, color: rgb(0.9, 0.96, 1) });
    rotatedPage.setRotation(degrees(rotation));
    const rotatedBytes = await Splitter.splitPdfBytes(await rotatedSource.save(), {
      direction: 'horizontal',
      ratio: 0.5,
      pageIndexes: new Set([0]),
    }, { PDFDocument });
    const rotatedDoc = await PDFDocument.load(rotatedBytes);
    assert.strictEqual(rotatedDoc.getPageCount(), 2);
    rotatedDoc.getPages().forEach((page) => assertA4(page, 'landscape'));

    const top = rotation === 90
      ? { left: 100, bottom: 50, right: 521, top: 1240 }
      : { left: 521, bottom: 50, right: 942, top: 1240 };
    const bottom = rotation === 90
      ? { left: 521, bottom: 50, right: 942, top: 1240 }
      : { left: 100, bottom: 50, right: 521, top: 1240 };
    assertEmbeddedClip(rotatedDoc.getPage(0), top);
    assertEmbeddedClip(rotatedDoc.getPage(1), bottom);
  }

  if (process.env.KEEP_TEST_OUTPUT === '1') {
    const outDir = path.resolve(__dirname, '../.tmp');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'sample-src.pdf'), Buffer.from(srcBytes));
    fs.writeFileSync(path.join(outDir, 'sample-vertical.pdf'), Buffer.from(verticalBytes));
    fs.writeFileSync(path.join(outDir, 'sample-horizontal.pdf'), Buffer.from(horizontalBytes));
    console.log(`样例文件已生成：${outDir}`);
  }

  console.log('全部冒烟测试通过。');
})();


