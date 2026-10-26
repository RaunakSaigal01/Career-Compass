import sys
from pathlib import Path
import pymupdf
from PIL import Image
from rapidocr import RapidOCR

def extract_pdf_text(pdf_path: str) -> str:
    path = Path(pdf_path)
    if not path.is_file():
        return ""
    
    doc = pymupdf.open(str(path))
    ocr = None
    matrix = pymupdf.Matrix(200 / 72, 200 / 72)
    page_texts = []
    
    for page in doc:
        txt = page.get_text("text").strip()
        if len(txt) < 80:
            if ocr is None:
                ocr = RapidOCR()
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            img = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            res = ocr(img, use_cls=False)
            txt = "\n".join(res.txts) if res and res.txts else txt
        page_texts.append(txt)
        
    return "\n".join(page_texts).strip()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(extract_pdf_text(sys.argv[1]))
