import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, 'data');

export async function downloadAndRead(page, url) {
  const ext = guessExtension(url);

  // For PDFs, try to read them
  if (ext === '.pdf') {
    return await readPdfFromUrl(url);
  }

  // For plain text files
  if (['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm'].includes(ext)) {
    return await readTextFromUrl(url);
  }

  // For anything else, try to read as text
  return await readTextFromUrl(url);
}

async function readPdfFromUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());

    // Dynamic import pdf-parse
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);

    let text = data.text || '';
    if (text.length > 8000) text = text.slice(0, 8000) + '\n...[truncated]';
    return {
      type: 'pdf',
      pages: data.numpages,
      text
    };
  } catch (e) {
    return { type: 'pdf', error: e.message, text: '' };
  }
}

async function readTextFromUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let text = await res.text();
    if (text.length > 8000) text = text.slice(0, 8000) + '\n...[truncated]';
    return { type: 'text', text };
  } catch (e) {
    return { type: 'text', error: e.message, text: '' };
  }
}

function guessExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    return extname(pathname).toLowerCase();
  } catch {
    return '';
  }
}

// Detect download links on a page
export async function findDownloadLinks(page) {
  try {
    return await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const downloadable = [];
      const exts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.json', '.xml', '.zip', '.ppt', '.pptx'];

      for (const link of links) {
        const href = link.href || '';
        const text = link.textContent?.trim() || '';
        const ext = href.split('?')[0].split('#')[0].match(/\.\w+$/)?.[0]?.toLowerCase() || '';

        if (exts.includes(ext) || text.toLowerCase().includes('download') || link.hasAttribute('download')) {
          downloadable.push({
            url: href,
            text: text.slice(0, 100),
            ext
          });
        }
      }
      return downloadable.slice(0, 10);
    });
  } catch {
    return [];
  }
}
