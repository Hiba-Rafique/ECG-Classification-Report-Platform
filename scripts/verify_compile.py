"""Verify all RAG module files compile without syntax errors."""
import py_compile
import sys

files = [
    "backend/services/ai_report.py",
    "backend/rag/pipeline.py",
    "backend/rag/indexer.py",
    "backend/rag/retriever.py",
    "backend/rag/__init__.py",
    "backend/config.py",
    "scripts/build_index.py",
]

ok = True
for f in files:
    try:
        py_compile.compile(f, doraise=True)
        print(f"  OK  {f}")
    except py_compile.PyCompileError as e:
        print(f"  ERR {f}: {e}")
        ok = False

if ok:
    print("\nAll files compile OK!")
else:
    print("\nSome files have errors!")
    sys.exit(1)
