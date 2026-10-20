declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    text: string;
  }
  function pdfParse(
    data: Buffer,
    options?: { pagerender?: (pageData: never) => Promise<string> },
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
