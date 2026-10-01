import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";

export async function renderInvoicePdf(input: {
  invoiceNumber: string;
  issuedAt: Date;
  participantName: string;
  runTitle: string;
  snapshot: Record<string, unknown>;
}): Promise<Uint8Array> {
  const font = await readFile(
    path.join(
      process.cwd(),
      "node_modules",
      "@fontsource",
      "vazirmatn",
      "files",
      "vazirmatn-arabic-400-normal.woff",
    ),
  );
  const doc = new PDFDocument({
    size: "A4",
    margin: 52,
    info: { Title: input.invoiceNumber, Author: "EventOS" },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  const snapshot = input.snapshot;
  const value = (key: string) =>
    typeof snapshot[key] === "string" ? snapshot[key] : "—";
  doc.registerFont("Vazirmatn", font).font("Vazirmatn");
  doc.fontSize(22).text("فاکتور پرداخت", { align: "right" });
  doc.moveDown().fontSize(12);
  for (const [label, text] of [
    ["شماره", input.invoiceNumber],
    ["تاریخ", input.issuedAt.toLocaleDateString("fa-IR-u-ca-persian")],
    ["شرکت‌کننده", input.participantName],
    ["برنامه", input.runTitle],
    ["مبلغ اصلی", value("originalAmount")],
    ["تخفیف", value("discountAmount")],
    ["مبلغ پرداختی", value("paidAmount")],
    ["واحد پول", value("currency")],
    ["شناسه مرجع", value("providerReferenceId")],
  ])
    doc.text(`${label}: ${text}`, { align: "right" }).moveDown(0.35);
  doc.end();
  return finished;
}
