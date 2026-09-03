"""Package the RAG module as a .zip deliverable."""
import zipfile
import os
from pathlib import Path

zf = zipfile.ZipFile("rag-module.zip", "w", zipfile.ZIP_DEFLATED)

files = [
    # RAG module
    "backend/rag/__init__.py",
    "backend/rag/indexer.py",
    "backend/rag/retriever.py",
    "backend/rag/pipeline.py",
    # Guidelines
    "data/guidelines/surawicz-2009.md",
    # Built index
    "data/index/faiss.index",
    "data/index/chunks.json",
    "data/index/index_info.json",
    # Scripts
    "scripts/__init__.py",
    "scripts/build_index.py",
    "scripts/test_rag.py",
    # Updated existing files
    "backend/config.py",
    "backend/services/ai_report.py",
    "requirements.txt",
    ".env.example",
    ".env",
    "README.md",
]

for f in files:
    p = Path(f)
    if p.exists():
        zf.write(f)
        print(f"  + {f}")
    else:
        print(f"  ! {f} (missing)")

zf.close()
size = os.path.getsize("rag-module.zip")
print(f"\nCreated rag-module.zip ({size/1024:.1f} KB, {len(files)} files)")
