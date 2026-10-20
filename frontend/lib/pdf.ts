import { Document } from '@langchain/core/documents';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

interface PageData {
  pageIndex: number;
  getTextContent: (options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<{ items: TextItem[] }>;
}

/**
 * Rebuilds a page's text line by line from item positions, so a table row
 * (label and value side by side) stays on one line instead of being split.
 */
async function renderPageByLine(pageData: PageData): Promise<string> {
  const { items } = await pageData.getTextContent({
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  });
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = item.transform[5];
    const line = lines.find((l) => Math.abs(l.y - y) < 3);
    if (line) line.items.push(item);
    else lines.push({ y, items: [item] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let text = '';
      let lastEnd: number | undefined;
      for (const item of sorted) {
        const x = item.transform[4];
        // A wide gap means a new table column.
        if (lastEnd !== undefined) text += x - lastEnd > 10 ? ' | ' : ' ';
        text += item.str.trim();
        lastEnd = x + item.width;
      }
      return text;
    })
    .join('\n');
}

/**
 * Processes a PDF file by parsing it into Document objects, one per page.
 * @param file - The PDF file to process.
 * @returns An array of Document objects extracted from the PDF.
 */
export async function processPDF(file: File): Promise<Document[]> {
  const buffer = await bufferFile(file);
  const pages: string[] = [];
  const { numpages } = await pdfParse(buffer, {
    pagerender: async (pageData: PageData) => {
      const text = await renderPageByLine(pageData);
      pages[pageData.pageIndex] = text;
      return text;
    },
  });

  return pages
    .map(
      (pageContent, i) =>
        new Document({
          pageContent,
          metadata: {
            source: file.name,
            filename: file.name,
            pdf: { totalPages: numpages },
            loc: { pageNumber: i + 1 },
          },
        }),
    )
    .filter((doc) => doc.pageContent.trim().length > 0);
}

/**
 * Converts a File object to a Buffer.
 * @param file - The uploaded file.
 * @returns A Buffer containing the file content.
 */
async function bufferFile(file: File): Promise<Buffer> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  } catch (error) {
    console.error('Error buffering file:', error);
    throw new Error('Failed to read file content.');
  }
}
