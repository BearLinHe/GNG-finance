import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

export async function restoreWorkbookCachedZeros(workbook: ExcelJS.Workbook, buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = new Map<string, string>(), targets = new Map<string, string>();
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relationships = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relationships) return;
  const bookParser = new SaxesParser();
  bookParser.on('opentag', tag => {
    if (tag.name === 'sheet') sheets.set(String(tag.attributes['r:id']), String(tag.attributes.name));
  });
  bookParser.write(workbookXml).close();
  const relationParser = new SaxesParser();
  relationParser.on('opentag', tag => {
    if (tag.name === 'Relationship') targets.set(String(tag.attributes.Id), String(tag.attributes.Target));
  });
  relationParser.write(relationships).close();
  for (const [relation, name] of sheets) {
    const target = targets.get(relation), sheet = workbook.getWorksheet(name);
    if (!target || !sheet) continue;
    const entry = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join('xl', target));
    const xml = await zip.file(entry)?.async('string');
    if (!xml) continue;
    let address = '', type = '', formula = false, inValue = false, value = '';
    // ExcelJS omits cached zero formula results; only restore explicit numeric XML values.
    const parser = new SaxesParser();
    parser.on('opentag', tag => {
      if (tag.name === 'c') { address = String(tag.attributes.r || ''); type = String(tag.attributes.t || 'n'); formula = false; value = ''; }
      if (tag.name === 'f') formula = true;
      if (tag.name === 'v') inValue = true;
    });
    parser.on('text', text => { if (inValue) value += text; });
    parser.on('closetag', tag => {
      if (tag.name === 'v') inValue = false;
      if (tag.name === 'c' && formula && address && type === 'n' && value.trim() && Number(value) === 0) sheet.getCell(address).value = 0;
    });
    parser.write(xml).close();
  }
}
