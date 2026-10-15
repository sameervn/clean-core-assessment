"""Render the PDF fixture and extract its logical ActualText with MuPDF."""
import pathlib
import pymupdf as fitz

directory = pathlib.Path(__file__).resolve().parents[3] / "generated-artifacts/pdf-typography"
document = fitz.open(directory / "complex.pdf")
document[0].get_pixmap(matrix=fitz.Matrix(2, 2)).save(directory / "mupdf.png")
(directory / "logical.txt").write_text("".join(page.get_text() for page in document), encoding="utf8")
