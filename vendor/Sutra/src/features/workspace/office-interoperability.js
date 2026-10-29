(function (global) {
  'use strict';

  function xml(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
  function engine() { if (!global.SutraSheetsEngine) throw new Error('Sutra Sheets engine is unavailable.'); return global.SutraSheetsEngine; }
  function zipApi() { if (!global.JSZip) throw new Error('The local Office package helper is unavailable.'); return global.JSZip; }
  function download(blob, filename) { var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); global.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1500); }
  function safeName(value, fallback) { return String(value || fallback || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || fallback || 'file'; }
  var MAX_OFFICE_FILE_BYTES = 25 * 1024 * 1024;
  var MAX_OFFICE_ENTRIES = 2500;
  var MAX_OFFICE_EXPANDED_BYTES = 100 * 1024 * 1024;
  var MAX_OFFICE_TEXT_PART_BYTES = 16 * 1024 * 1024;
  var MAX_XLSX_ROWS = 20000;
  var MAX_XLSX_COLUMNS = 512;
  var MAX_XLSX_CELLS = 250000;
  var MAX_PPTX_SLIDES = 300;
  var MAX_PPTX_SHAPES_PER_SLIDE = 2000;

  function inputByteLength(input) {
    if (!input) return 0;
    if (typeof input.size === 'number') return input.size;
    if (typeof input.byteLength === 'number') return input.byteLength;
    return 0;
  }
  function entryExpandedBytes(entry) {
    var size = entry && entry._data && Number(entry._data.uncompressedSize);
    return Number.isFinite(size) && size >= 0 ? size : 0;
  }
  function validateOfficeInput(input) {
    var bytes = inputByteLength(input);
    if (bytes > MAX_OFFICE_FILE_BYTES) throw new Error('Office files must be 25 MB or smaller.');
  }
  function validateOfficePackage(zip) {
    var entries = Object.keys(zip && zip.files || {});
    if (entries.length > MAX_OFFICE_ENTRIES) throw new Error('This Office package contains too many parts.');
    var expanded = entries.reduce(function (total, name) { return total + entryExpandedBytes(zip.files[name]); }, 0);
    if (expanded > MAX_OFFICE_EXPANDED_BYTES) throw new Error('This Office package expands beyond the 100 MB safety limit.');
    return entries;
  }
  async function readTextPart(entry, label) {
    if (!entry) throw new Error('The Office package is missing ' + label + '.');
    if (entryExpandedBytes(entry) > MAX_OFFICE_TEXT_PART_BYTES) throw new Error(label + ' exceeds the 16 MB safety limit.');
    var text = await entry.async('text');
    if (new TextEncoder().encode(text).byteLength > MAX_OFFICE_TEXT_PART_BYTES) throw new Error(label + ' exceeds the 16 MB safety limit.');
    return text;
  }

  function parseDelimited(text, delimiter) {
    var source = String(text == null ? '' : text); var separator = delimiter || (source.indexOf('\t') !== -1 ? '\t' : ','); var rows = []; var row = []; var field = ''; var quoted = false;
    for (var i = 0; i < source.length; i += 1) {
      var character = source.charAt(i);
      if (quoted) {
        if (character === '"' && source.charAt(i + 1) === '"') { field += '"'; i += 1; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === separator) { row.push(field); field = ''; }
      else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (character !== '\r') field += character;
    }
    row.push(field); if (row.length > 1 || row[0] !== '' || !rows.length) rows.push(row);
    return rows;
  }

  function quoteDelimited(value, delimiter) { var text = String(value == null ? '' : value); return /["\r\n]/.test(text) || text.indexOf(delimiter) !== -1 ? '"' + text.replace(/"/g, '""') + '"' : text; }
  function exportDelimited(workbook, sheetId, delimiter) {
    var book = engine().normalizeWorkbook(workbook); var sheet = book.sheets.find(function (item) { return item.id === sheetId; }) || book.sheets[0]; var maxRow = 0; var maxCol = 0;
    Object.keys(sheet.cells || {}).forEach(function (key) { var bits = key.split(':'); var r = sheet.rows.findIndex(function (item) { return item.id === bits[0]; }); var c = sheet.columns.findIndex(function (item) { return item.id === bits[1]; }); maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, c); });
    var lines = []; for (var row = 0; row <= maxRow; row += 1) { var fields = []; for (var col = 0; col <= maxCol; col += 1) { var cell = engine().cellAt(sheet, row, col); fields.push(quoteDelimited(cell && (cell.formula || cell.value), delimiter)); } lines.push(fields.join(delimiter)); }
    return lines.join('\r\n');
  }

  function workbookFromDelimited(text, options) {
    var opts = options || {}; var rows = parseDelimited(text, opts.delimiter); var workbook = engine().createWorkbook(opts.title || 'Imported workbook'); var sheet = engine().createSheet(opts.sheetName || 'Sheet1', { rowCount: Math.max(200, rows.length + 10), columnCount: Math.max(26, rows.reduce(function (max, item) { return Math.max(max, item.length); }, 0) + 4) }); workbook.sheets = [sheet];
    rows.forEach(function (values, row) { values.forEach(function (source, col) { if (source === '') return; var numeric = Number(source); var value = Number.isFinite(numeric) && source.trim() !== '' ? numeric : source; engine().setCell(sheet, row, col, { value: source.charAt(0) === '=' ? '' : value, formula: source.charAt(0) === '=' ? source : '' }); }); });
    return engine().normalizeWorkbook(workbook);
  }

  function usedBounds(sheet) {
    var rows = new Map(sheet.rows.map(function (item, index) { return [item.id, index]; })); var cols = new Map(sheet.columns.map(function (item, index) { return [item.id, index]; })); var maxRow = 0; var maxCol = 0;
    Object.keys(sheet.cells || {}).forEach(function (key) { var bits = key.split(':'); maxRow = Math.max(maxRow, rows.get(bits[0]) || 0); maxCol = Math.max(maxCol, cols.get(bits[1]) || 0); });
    (sheet.merges || []).forEach(function (merge) { var range = typeof merge === 'string' ? merge : merge && merge.range; var refs = String(range || '').split(':').map(engine().parseA1).filter(Boolean); refs.forEach(function (ref) { maxRow = Math.max(maxRow, ref.row); maxCol = Math.max(maxCol, ref.col); }); });
    return { maxRow: maxRow, maxCol: maxCol };
  }

  function xlsxRgb(value, fallback) { var match = /#?([0-9a-f]{6})/i.exec(String(value || '')); return 'FF' + (match ? match[1] : fallback || '202124').toUpperCase(); }
  function generatedXlsxStyles(book) {
    var keys = Object.keys(book.styles || {}).filter(function (key) { return book.styles[key] && typeof book.styles[key] === 'object'; });
    if (!keys.length && book.officeParts && book.officeParts.stylesXml) return { xml: book.officeParts.stylesXml, indexes: {}, preserveImported: true };
    var indexes = {}; var fonts = ['<font><sz val="11"/><name val="Aptos"/><family val="2"/></font>']; var fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']; var borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']; var xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    keys.forEach(function (key, index) { var style = book.styles[key]; var fontId = fonts.length; var fillId = 0; var borderId = 0; indexes[key] = index + 1; fonts.push('<font>' + (style.fontWeight === '700' || style.fontWeight === 'bold' ? '<b/>' : '') + (style.fontStyle === 'italic' ? '<i/>' : '') + '<sz val="11"/><color rgb="' + xlsxRgb(style.color, '202124') + '"/><name val="Aptos"/><family val="2"/></font>'); if (style.backgroundColor) { fillId = fills.length; fills.push('<fill><patternFill patternType="solid"><fgColor rgb="' + xlsxRgb(style.backgroundColor, 'FFFFFF') + '"/><bgColor indexed="64"/></patternFill></fill>'); } if (style.border) { borderId = borders.length; borders.push('<border><left style="thin"><color rgb="FF9CA3AF"/></left><right style="thin"><color rgb="FF9CA3AF"/></right><top style="thin"><color rgb="FF9CA3AF"/></top><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border>'); } var numFmtId = ({ number: 4, percent: 10, currency: 164, date: 14 })[style.numberFormat] || 0; var alignment = style.textAlign ? '<alignment horizontal="' + xml(style.textAlign) + '"/>' : ''; xfs.push('<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0" applyFont="1"' + (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') + (numFmtId ? ' applyNumberFormat="1"' : '') + (alignment ? ' applyAlignment="1"' : '') + '>' + alignment + '</xf>'); });
    return { indexes: indexes, preserveImported: false, xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts><fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') + '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' };
  }

  function xlsxCell(cell, address, stylePackage) {
    if (!cell) return '';
    var importedStyle = /^xlsx-(\d+)$/.exec(String(cell.styleId || '')); var styleIndex = stylePackage && stylePackage.indexes && stylePackage.indexes[cell.styleId]; if (styleIndex == null && stylePackage && stylePackage.preserveImported && importedStyle) styleIndex = Number(importedStyle[1]); var styleAttr = styleIndex == null ? '' : ' s="' + styleIndex + '"';
    if (cell.formula) return '<c r="' + address + '"' + styleAttr + '><f>' + xml(String(cell.formula).replace(/^=/, '')) + '</f></c>';
    if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return '<c r="' + address + '"' + styleAttr + '><v>' + cell.value + '</v></c>';
    if (typeof cell.value === 'boolean') return '<c r="' + address + '" t="b"' + styleAttr + '><v>' + (cell.value ? 1 : 0) + '</v></c>';
    if (cell.value === '' || cell.value == null) return '';
    return '<c r="' + address + '" t="inlineStr"' + styleAttr + '><is><t xml:space="preserve">' + xml(cell.value) + '</t></is></c>';
  }

  function worksheetXml(sheet, stylePackage) {
    var bounds = usedBounds(sheet); var rowXml = [];
    for (var row = 0; row <= bounds.maxRow; row += 1) {
      var cells = []; for (var col = 0; col <= bounds.maxCol; col += 1) { var cellXml = xlsxCell(engine().cellAt(sheet, row, col), engine().columnLabel(col) + String(row + 1), stylePackage); if (cellXml) cells.push(cellXml); }
      var meta = sheet.rows[row] || {}; if (cells.length || meta.hidden || Number(meta.height) !== 28) rowXml.push('<row r="' + (row + 1) + '"' + (meta.hidden ? ' hidden="1"' : '') + (Number(meta.height) !== 28 ? ' ht="' + Number(meta.height || 28) + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>');
    }
    var columns = (sheet.columns || []).map(function (column, index) { if (!column.hidden && Number(column.width) === 120) return ''; return '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + Math.max(4, Number(column.width || 120) / 7) + '" customWidth="1"' + (column.hidden ? ' hidden="1"' : '') + '/>'; }).join('');
    var merges = (sheet.merges || []).map(function (merge) { return typeof merge === 'string' ? merge : merge && merge.range; }).filter(Boolean);
    var frozen = sheet.frozen || {}; var pane = frozen.rows || frozen.columns ? '<sheetViews><sheetView workbookViewId="0"><pane' + (frozen.columns ? ' xSplit="' + frozen.columns + '"' : '') + (frozen.rows ? ' ySplit="' + frozen.rows + '"' : '') + ' topLeftCell="' + engine().columnLabel(frozen.columns || 0) + String((frozen.rows || 0) + 1) + '" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + pane + (columns ? '<cols>' + columns + '</cols>' : '') + '<sheetData>' + rowXml.join('') + '</sheetData>' + (merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map(function (range) { return '<mergeCell ref="' + xml(range) + '"/>'; }).join('') + '</mergeCells>' : '') + '</worksheet>';
  }

  async function exportXlsx(workbook) {
    var book = engine().normalizeWorkbook(workbook); var Zip = zipApi(); var zip = new Zip(); var count = book.sheets.length;
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + book.sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    var names = Object.keys(book.namedRanges || {}).map(function (name) { return '<definedName name="' + xml(name) + '">' + xml(book.namedRanges[name]) + '</definedName>'; }).join('');
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + book.sheets.map(function (sheet, i) { return '<sheet name="' + xml(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' + (names ? '<definedNames>' + names + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + book.sheets.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (count + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    var stylePackage = generatedXlsxStyles(book); zip.file('xl/styles.xml', stylePackage.xml);
    book.sheets.forEach(function (sheet, i) { zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', worksheetXml(sheet, stylePackage)); });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function parseXml(text) { var parsed = new DOMParser().parseFromString(text, 'application/xml'); if (parsed.querySelector('parsererror')) throw new Error('The Office package contains malformed XML.'); return parsed; }
  function textOf(node, selector) { var found = node && node.querySelector(selector); return found ? found.textContent || '' : ''; }

  async function importXlsx(file) {
    validateOfficeInput(file);
    var Zip = zipApi(); var zip = await Zip.loadAsync(file); var warnings = []; var packageEntries = validateOfficePackage(zip);
    if (zip.file('xl/vbaProject.bin')) throw new Error('Macro-enabled workbooks are not supported. Export the workbook as .xlsx first.');
    if (packageEntries.some(function (name) { return /^xl\/externalLinks\//.test(name); })) warnings.push('External data connections were not imported.');
    if (packageEntries.some(function (name) { return /^xl\/pivot/.test(name); })) warnings.push('Pivot tables were not imported.');
    var workbookFile = zip.file('xl/workbook.xml'); var relsFile = zip.file('xl/_rels/workbook.xml.rels'); if (!workbookFile || !relsFile) throw new Error('This file is not a readable XLSX workbook.');
    var workbookXml = parseXml(await readTextPart(workbookFile, 'workbook.xml')); var relsXml = parseXml(await readTextPart(relsFile, 'workbook relationships')); var relationships = {};
    Array.from(relsXml.querySelectorAll('Relationship')).forEach(function (rel) { if (rel.getAttribute('TargetMode') !== 'External') relationships[rel.getAttribute('Id')] = rel.getAttribute('Target'); });
    var shared = []; var sharedFile = zip.file('xl/sharedStrings.xml'); if (sharedFile) { var sharedXml = parseXml(await readTextPart(sharedFile, 'shared strings')); shared = Array.from(sharedXml.querySelectorAll('si')).map(function (node) { return Array.from(node.querySelectorAll('t')).map(function (part) { return part.textContent || ''; }).join(''); }); }
    var result = engine().createWorkbook(file && file.name ? file.name.replace(/\.xlsx$/i, '') : 'Imported workbook'); result.sheets = []; result.importWarnings = warnings; result.officeParts = {};
    var stylesFile = zip.file('xl/styles.xml'); if (stylesFile) result.officeParts.stylesXml = await readTextPart(stylesFile, 'styles.xml');
    var sheetNodes = Array.from(workbookXml.querySelectorAll('sheet'));
    for (var i = 0; i < sheetNodes.length; i += 1) {
      var sheetNode = sheetNodes[i]; var relId = sheetNode.getAttribute('r:id') || sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); var target = relationships[relId] || ('worksheets/sheet' + (i + 1) + '.xml'); var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''); var sheetFile = zip.file(path); if (!sheetFile || !/^xl\/worksheets\/[^/]+\.xml$/i.test(path)) { warnings.push('A worksheet part was missing or unsafe: ' + sheetNode.getAttribute('name')); continue; }
      var sheetXml = parseXml(await readTextPart(sheetFile, 'worksheet ' + (i + 1))); var cellNodes = Array.from(sheetXml.querySelectorAll('c')); if (cellNodes.length > MAX_XLSX_CELLS) throw new Error('A worksheet contains more than 250,000 populated cells.'); var refs = cellNodes.map(function (cell) { return engine().parseA1(cell.getAttribute('r')); }).filter(Boolean); var maxRow = refs.reduce(function (max, ref) { return Math.max(max, ref.row); }, 0); var maxCol = refs.reduce(function (max, ref) { return Math.max(max, ref.col); }, 0); if (maxRow >= MAX_XLSX_ROWS || maxCol >= MAX_XLSX_COLUMNS) throw new Error('A worksheet exceeds the 20,000 row or 512 column safety limit.'); var sheet = engine().createSheet(sheetNode.getAttribute('name') || ('Sheet' + (i + 1)), { rowCount: Math.max(200, maxRow + 20), columnCount: Math.max(26, maxCol + 8) });
      Array.from(sheetXml.querySelectorAll('row')).forEach(function (rowNode) { var index = Number(rowNode.getAttribute('r')) - 1; if (!sheet.rows[index]) return; if (rowNode.getAttribute('hidden') === '1') sheet.rows[index].hidden = true; if (rowNode.getAttribute('ht')) sheet.rows[index].height = Math.max(20, Math.min(200, Number(rowNode.getAttribute('ht')))); });
      Array.from(sheetXml.querySelectorAll('col')).forEach(function (colNode) { var start = Number(colNode.getAttribute('min')) - 1; var end = Number(colNode.getAttribute('max')) - 1; for (var col = start; col <= end; col += 1) if (sheet.columns[col]) { sheet.columns[col].hidden = colNode.getAttribute('hidden') === '1'; if (colNode.getAttribute('width')) sheet.columns[col].width = Math.max(44, Math.min(600, Number(colNode.getAttribute('width')) * 7)); } });
      cellNodes.forEach(function (cellNode) { var ref = engine().parseA1(cellNode.getAttribute('r')); if (!ref) return; var type = cellNode.getAttribute('t'); var raw = textOf(cellNode, 'v'); var value = type === 's' ? (shared[Number(raw)] || '') : type === 'inlineStr' ? Array.from(cellNode.querySelectorAll('t')).map(function (node) { return node.textContent || ''; }).join('') : type === 'b' ? raw === '1' : (raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw); var formula = textOf(cellNode, 'f'); var styleIndex = cellNode.getAttribute('s'); engine().setCell(sheet, ref.row, ref.col, { value: formula ? '' : value, formula: formula ? '=' + formula : '', styleId: styleIndex ? 'xlsx-' + styleIndex : '' }); });
      sheet.merges = Array.from(sheetXml.querySelectorAll('mergeCell')).map(function (node) { return node.getAttribute('ref'); }).filter(Boolean); var pane = sheetXml.querySelector('pane[state="frozen"]'); if (pane) sheet.frozen = { rows: Math.max(0, Number(pane.getAttribute('ySplit')) || 0), columns: Math.max(0, Number(pane.getAttribute('xSplit')) || 0) };
      if (sheetXml.querySelector('conditionalFormatting')) warnings.push(sheet.name + ': conditional formatting was preserved only as an import warning.'); if (sheetXml.querySelector('drawing')) warnings.push(sheet.name + ': drawings or charts were not imported.'); result.sheets.push(sheet);
    }
    if (!result.sheets.length) result.sheets = [engine().createSheet('Sheet1')];
    Array.from(workbookXml.querySelectorAll('definedName')).forEach(function (node) { var name = node.getAttribute('name'); if (name && name.indexOf('_xlnm.') !== 0) result.namedRanges[name] = node.textContent || ''; });
    result.importWarnings = warnings; return { workbook: engine().normalizeWorkbook(result), report: { warnings: warnings, unsupported: warnings.slice() } };
  }

  var PPTX_WIDTH = 12192000;
  var PPTX_HEIGHT = 6858000;
  function pptxColor(value, fallback) { var match = /#?([0-9a-f]{6})/i.exec(String(value || '')); return (match ? match[1] : fallback || '1F2937').toUpperCase(); }
  function pptxNumber(value, fallback) { var number = Number(value); return Number.isFinite(number) ? number : fallback; }
  function pptxBox(element) {
    return {
      x: Math.round(PPTX_WIDTH * pptxNumber(element && element.x, 8) / 100),
      y: Math.round(PPTX_HEIGHT * pptxNumber(element && element.y, 8) / 100),
      w: Math.max(91440, Math.round(PPTX_WIDTH * pptxNumber(element && (element.width == null ? element.w : element.width), 40) / 100)),
      h: Math.max(91440, Math.round(PPTX_HEIGHT * pptxNumber(element && (element.height == null ? element.h : element.height), 18) / 100))
    };
  }
  function pptxParagraph(text, element) {
    var size = Math.max(800, Math.min(9600, Math.round(pptxNumber(element && element.fontSize, 24) * 100)));
    var align = ({ left: 'l', center: 'ctr', right: 'r', justify: 'just' })[String(element && (element.textAlign || element.align) || 'left')] || 'l';
    return '<a:p><a:pPr algn="' + align + '"/><a:r><a:rPr lang="en-US" sz="' + size + '"' + (element && (element.bold || element.fontWeight === 'bold' || element.fontWeight === '700') ? ' b="1"' : '') + (element && element.italic ? ' i="1"' : '') + '><a:solidFill><a:srgbClr val="' + pptxColor(element && element.color, '1F2937') + '"/></a:solidFill></a:rPr><a:t>' + xml(text) + '</a:t></a:r><a:endParaRPr lang="en-US" sz="' + size + '"/></a:p>';
  }
  function pptxTextShape(element, id, name, text, geometry) {
    var box = pptxBox(element); var fill = String(element && element.fill || '').trim(); var outline = String(element && element.stroke || '').trim();
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xml(name) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + box.x + '" y="' + box.y + '"/><a:ext cx="' + box.w + '" cy="' + box.h + '"/></a:xfrm><a:prstGeom prst="' + (geometry || 'rect') + '"><a:avLst/></a:prstGeom>' + (fill ? '<a:solidFill><a:srgbClr val="' + pptxColor(fill, 'FFFFFF') + '"/></a:solidFill>' : '<a:noFill/>') + (outline ? '<a:ln><a:solidFill><a:srgbClr val="' + pptxColor(outline, '64748B') + '"/></a:solidFill></a:ln>' : '<a:ln><a:noFill/></a:ln>') + '</p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' + String(text == null ? '' : text).split(/\r?\n/).map(function (line) { return pptxParagraph(line, element); }).join('') + '</p:txBody></p:sp>';
  }
  function pptxTableText(element) {
    var rows = Array.isArray(element && element.rows) ? element.rows : []; return rows.map(function (row) { return (Array.isArray(row) ? row : []).join('    '); }).join('\n');
  }
  function pptxChartShapes(element, idStart) {
    var values = Array.isArray(element && element.values) ? element.values : (element && element.chart && Array.isArray(element.chart.values) ? element.chart.values : []); values = values.map(Number).filter(Number.isFinite); if (!values.length) return { xml: pptxTextShape(element, idStart, 'Chart', element && element.title || 'Chart', 'rect'), nextId: idStart + 1 };
    var box = pptxBox(element); var max = Math.max.apply(Math, values.concat([1])); var barWidth = Math.max(91440, Math.floor(box.w / values.length * 0.58)); var gap = Math.max(45720, Math.floor(box.w / values.length)); var shapes = [];
    values.forEach(function (value, index) { var height = Math.max(45720, Math.round(box.h * value / max)); var bar = { x: ((box.x + index * gap) / PPTX_WIDTH) * 100, y: ((box.y + box.h - height) / PPTX_HEIGHT) * 100, w: (barWidth / PPTX_WIDTH) * 100, h: (height / PPTX_HEIGHT) * 100, fill: element.fill || '#6D5DD3', stroke: element.stroke || '#6D5DD3', color: '#FFFFFF', fontSize: 10, align: 'center' }; shapes.push(pptxTextShape(bar, idStart + index, 'Chart bar ' + (index + 1), String(value), 'rect')); });
    return { xml: shapes.join(''), nextId: idStart + values.length };
  }
  function pptxSlideXml(slide, media, slideNumber) {
    var elements = Array.isArray(slide && slide.elements) ? slide.elements : []; var shapeId = 2; var body = [];
    elements.forEach(function (element) {
      var type = String(element && element.type || 'text');
      if (type === 'image' && /^data:image\/(png|jpe?g);base64,/i.test(String(element.src || element.dataUrl || ''))) {
        var source = String(element.src || element.dataUrl); var match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(source); var extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpg'; var mediaId = media.length + 1; var relationshipId = 'rId' + (mediaId + 1); media.push({ id: mediaId, fileName: 'image' + (slideNumber || 1) + '_' + mediaId + '.' + extension, extension: extension, base64: match[2], relationshipId: relationshipId }); var box = pptxBox(element);
        body.push('<p:pic><p:nvPicPr><p:cNvPr id="' + shapeId + '" name="Image ' + mediaId + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + relationshipId + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + box.x + '" y="' + box.y + '"/><a:ext cx="' + box.w + '" cy="' + box.h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'); shapeId += 1; return;
      }
      if (type === 'chart') { var chart = pptxChartShapes(element, shapeId); body.push(chart.xml); shapeId = chart.nextId; return; }
      var text = type === 'table' ? pptxTableText(element) : (element.text || element.title || ''); var geometry = type === 'shape' ? (element.shape === 'ellipse' ? 'ellipse' : element.shape === 'roundRect' ? 'roundRect' : 'rect') : 'rect'; body.push(pptxTextShape(element, shapeId, type === 'table' ? 'Table' : type === 'shape' ? 'Shape' : 'Text', text, geometry)); shapeId += 1;
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="' + xml(slide && slide.title || '') + '"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + pptxColor(slide && slide.background, 'FFFFFF') + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + body.join('') + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }
  function pptxThemeXml() { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sutra"><a:themeElements><a:clrScheme name="Sutra"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="334155"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="6D5DD3"/></a:accent1><a:accent2><a:srgbClr val="A87B59"/></a:accent2><a:accent3><a:srgbClr val="0EA5E9"/></a:accent3><a:accent4><a:srgbClr val="10B981"/></a:accent4><a:accent5><a:srgbClr val="F59E0B"/></a:accent5><a:accent6><a:srgbClr val="EF4444"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Sutra"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Sutra"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
  }
  async function exportPptx(deck) {
    var presentation = deck && typeof deck === 'object' ? deck : {}; var slides = Array.isArray(presentation.slides) && presentation.slides.length ? presentation.slides : [{ title: 'Slide 1', elements: [] }]; var Zip = zipApi(); var zip = new Zip(); var overrides = slides.map(function (_, index) { return '<Override PartName="/ppt/slides/slide' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'; }).join('');
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="json" ContentType="application/json"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + overrides + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
    zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + slides.map(function (_, index) { return '<p:sldId id="' + (256 + index) + '" r:id="rId' + (index + 2) + '"/>'; }).join('') + '</p:sldIdLst><p:sldSz cx="' + PPTX_WIDTH + '" cy="' + PPTX_HEIGHT + '" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
    zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' + slides.map(function (_, index) { return '<Relationship Id="rId' + (index + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (index + 1) + '.xml"/>'; }).join('') + '</Relationships>');
    zip.file('ppt/slideMasters/slideMaster1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>');
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
    zip.file('ppt/slideLayouts/slideLayout1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'); zip.file('ppt/theme/theme1.xml', pptxThemeXml());
    slides.forEach(function (slide, index) { var media = []; zip.file('ppt/slides/slide' + (index + 1) + '.xml', pptxSlideXml(slide, media, index + 1)); zip.file('ppt/slides/_rels/slide' + (index + 1) + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' + media.map(function (item) { return '<Relationship Id="' + item.relationshipId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + item.fileName + '"/>'; }).join('') + '</Relationships>'); media.forEach(function (item) { zip.file('ppt/media/' + item.fileName, item.base64, { base64: true }); }); });
    zip.file('ppt/sutra-deck.json', JSON.stringify({ format: 'sutra-slides-v2', version: 2, deck: presentation }, null, 2)); return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }
  async function importPptx(file) {
    validateOfficeInput(file);
    var Zip = zipApi(); var zip = await Zip.loadAsync(file); validateOfficePackage(zip); if (zip.file('ppt/vbaProject.bin')) throw new Error('Macro-enabled presentations are not supported. Save the file as .pptx first.'); var model = zip.file('ppt/sutra-deck.json'); if (model) { var parsed = JSON.parse(await readTextPart(model, 'embedded Sutra deck')); if (!parsed || !parsed.deck) throw new Error('The embedded Sutra deck is invalid.'); return { deck: parsed.deck, report: { warnings: [], unsupported: [] } }; }
    var slideFiles = Object.keys(zip.files).filter(function (name) { return /^ppt\/slides\/slide\d+\.xml$/.test(name); }).sort(function (a, b) { return Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]); }); if (!slideFiles.length) throw new Error('This file is not a readable PPTX presentation.'); if (slideFiles.length > MAX_PPTX_SLIDES) throw new Error('Presentations may contain at most 300 slides.'); var warnings = ['Imported standard PowerPoint text and basic positioning. Complex themes, SmartArt, animations, and transitions were not imported.']; var slides = [];
    for (var i = 0; i < slideFiles.length; i += 1) { var documentXml = parseXml(await readTextPart(zip.file(slideFiles[i]), 'slide ' + (i + 1))); var elements = []; var shapes = Array.from(documentXml.getElementsByTagNameNS('*', 'sp')); if (shapes.length > MAX_PPTX_SHAPES_PER_SLIDE) throw new Error('A slide contains more than 2,000 shapes.'); shapes.forEach(function (shape, index) { var texts = Array.from(shape.getElementsByTagNameNS('*', 't')).map(function (node) { return node.textContent || ''; }); if (!texts.length) return; var transform = shape.getElementsByTagNameNS('*', 'xfrm')[0]; var off = transform && transform.getElementsByTagNameNS('*', 'off')[0]; var ext = transform && transform.getElementsByTagNameNS('*', 'ext')[0]; elements.push({ id: 'pptx_text_' + i + '_' + index, type: 'text', text: texts.join('\n'), x: off ? Number(off.getAttribute('x')) / PPTX_WIDTH * 100 : 8, y: off ? Number(off.getAttribute('y')) / PPTX_HEIGHT * 100 : 8 + index * 12, w: ext ? Number(ext.getAttribute('cx')) / PPTX_WIDTH * 100 : 70, h: ext ? Number(ext.getAttribute('cy')) / PPTX_HEIGHT * 100 : 12, fontSize: 24, color: '#1F2937', align: 'left' }); }); slides.push({ id: 'pptx_slide_' + (i + 1), title: elements[0] && elements[0].text || 'Slide ' + (i + 1), background: '#FFFFFF', speakerNotes: '', elements: elements }); }
    return { deck: { version: 2, title: file && file.name ? file.name.replace(/\.pptx$/i, '') : 'Imported presentation', size: 'wide', slides: slides, importWarnings: warnings }, report: { warnings: warnings, unsupported: warnings.slice() } };
  }

  var api = {
    parseDelimited: parseDelimited,
    exportDelimited: exportDelimited,
    workbookFromDelimited: workbookFromDelimited,
    exportXlsx: exportXlsx,
    importXlsx: importXlsx,
    exportPptx: exportPptx,
    importPptx: importPptx,
    downloadXlsx: async function (workbook, filename) { var blob = await exportXlsx(workbook); download(blob, safeName(filename, 'workbook') + '.xlsx'); return blob; },
    downloadPptx: async function (deck, filename) { var blob = await exportPptx(deck); download(blob, safeName(filename, 'presentation') + '.pptx'); return blob; },
    downloadDelimited: function (workbook, sheetId, delimiter, filename) { var text = exportDelimited(workbook, sheetId, delimiter); var extension = delimiter === '\t' ? '.tsv' : '.csv'; download(new Blob([text], { type: 'text/plain;charset=utf-8' }), safeName(filename, 'sheet') + extension); return text; },
    _test: { validateOfficeInput: validateOfficeInput, validateOfficePackage: validateOfficePackage, readTextPart: readTextPart }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraOfficeInterop = api;
}(typeof window !== 'undefined' ? window : globalThis));
