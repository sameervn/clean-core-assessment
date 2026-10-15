import { rgb, type PDFDocument } from "pdf-lib";
import type { createPdfText } from "./pdf-text";

type RecommendationGroup = {
  label: string;
  count: number;
  confidenceText: string;
  rationales: readonly string[];
};

/** Keep ordinary groups together; split oversized groups only between measured lines. */
export function drawPdfRecommendations(
  document: PDFDocument,
  pdf: Awaited<ReturnType<typeof createPdfText>>,
  groups: readonly RecommendationGroup[],
) {
  const top = 505;
  const bottom = 52;
  const width = 738;
  let page = newPage(false);
  let y = top;

  function newPage(continued: boolean) {
    const next = document.addPage([842, 595]);
    pdf.draw(next, `Recommended solution patterns${continued ? " (continued)" : ""}`, {
      x: 46, y: 548, size: 22, strong: true, color: rgb(0.03, 0.11, 0.2),
    });
    return next;
  }
  function advancePage() {
    page = newPage(true);
    y = top;
  }

  for (const group of groups) {
    const labels = pdf.wrap(`${group.label} (${group.count})`, width, 12, true);
    const rationales = pdf.wrap(
      `Confidence: ${group.confidenceText}. ${group.rationales.join(" ") || "Validate against object-level evidence."}`,
      width, 8.5,
    );
    const lines = [
      ...labels.map(text => ({ text, size: 12, strong: true, step: 17 })),
      ...rationales.map(text => ({ text, size: 8.5, strong: false, step: 13 })),
    ];
    // Last baseline must fit above the footer; include a small label/body gap.
    const height = lines.reduce((sum, line) => sum + line.step, 0) - 13 + 2;
    if (y < top && (height <= top - bottom ? y - height < bottom : true)) advancePage();
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (index === labels.length) y -= 2;
      if (y < bottom) advancePage();
      if (line.text) pdf.draw(page, line.text, {
        x: 52, y, size: line.size, strong: line.strong,
        color: line.strong ? rgb(0.03, 0.11, 0.2) : rgb(0.32, 0.41, 0.48),
      });
      y -= line.step;
    }
    y -= 16;
  }
}
