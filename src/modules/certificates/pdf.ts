import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { fillTemplate, type TemplateFields } from "./schema";

type CertificatePdfInput = {
  participantName: string;
  programName: string;
  instructorName: string;
  organizationName: string;
  issuedAt: Date;
  serialNumber: string;
  verificationUrl: string;
  fields: TemplateFields;
  background?: Uint8Array;
  logo?: Uint8Array;
};

export async function renderCertificatePdf(
  input: CertificatePdfInput,
): Promise<Uint8Array> {
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
    layout: "landscape",
    margin: 48,
    info: { Title: "Certificate", Author: input.organizationName },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  doc.registerFont("Vazirmatn", font).font("Vazirmatn");
  if (input.background)
    doc.image(Buffer.from(input.background), 0, 0, { width: 842, height: 595 });
  doc.rect(28, 28, 786, 539).lineWidth(2).stroke(input.fields.accentColor);
  if (input.logo && input.fields.showOrganizationLogo)
    doc.image(Buffer.from(input.logo), 375, 52, {
      fit: [92, 70],
      align: "center",
    });
  doc
    .fillColor(input.fields.accentColor)
    .fontSize(19)
    .text(input.organizationName, 65, 138, { width: 712, align: "center" });
  doc.fontSize(27).text("گواهی شرکت", 65, 194, { width: 712, align: "center" });
  doc
    .fillColor("#243c45")
    .fontSize(16)
    .text(
      fillTemplate(input.fields.message, {
        participantName: input.participantName,
        programName: input.programName,
        instructorName: input.instructorName,
        issuedAt: input.issuedAt.toLocaleDateString("fa-IR"),
      }),
      94,
      275,
      { width: 654, height: 155, align: "center" },
    );
  doc.fontSize(11).text(`شماره گواهی: ${input.serialNumber}`, 65, 463, {
    width: 712,
    align: "center",
  });
  doc.fontSize(10).text(input.verificationUrl, 65, 492, {
    width: 712,
    align: "center",
    link: input.verificationUrl,
  });
  doc.end();
  return finished;
}
