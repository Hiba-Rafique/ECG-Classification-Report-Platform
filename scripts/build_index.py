"""
Build the FAISS index for RAG retrieval over clinical guidelines.

Usage:
    python -m scripts.build_index                          # defaults
    python -m scripts.build_index --docs_dir data/guidelines --index_dir data/index
    python -m scripts.build_index --model all-MiniLM-L6-v2 --chunk_size 1200

After building, enable RAG in .env:
    RAG_ENABLED=true

Then restart the backend — AI reports will automatically include
guideline-grounded context from Surawicz et al. 2009 (AHA/ACCF/HRS).

Requirements (install first):
    pip install -r requirements.txt
"""

import argparse
import logging
import sys
from pathlib import Path

# Ensure the project root is on sys.path so `backend.rag.*` imports work
# when running as `python -m scripts.build_index` from the repo root.
_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build FAISS index from clinical guideline documents for RAG.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Example:\n"
            "  python -m scripts.build_index --docs_dir data/guidelines "
            "--index_dir data/index --model all-MiniLM-L6-v2\n"
        ),
    )
    parser.add_argument(
        "--docs_dir",
        default="data/guidelines",
        help="Directory containing .md guideline documents (default: data/guidelines)",
    )
    parser.add_argument(
        "--index_dir",
        default="data/index",
        help="Output directory for FAISS index artefacts (default: data/index)",
    )
    parser.add_argument(
        "--model",
        default="all-MiniLM-L6-v2",
        help="sentence-transformers model name (default: all-MiniLM-L6-v2)",
    )
    parser.add_argument(
        "--chunk_size",
        type=int,
        default=1200,
        help="Maximum characters per chunk (default: 1200)",
    )
    parser.add_argument(
        "--overlap",
        type=int,
        default=200,
        help="Overlap characters between sub-chunks (default: 200)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # Validate docs directory
    docs_path = Path(args.docs_dir)
    if not docs_path.exists():
        print(f"ERROR: Documents directory not found: {docs_path.resolve()}", file=sys.stderr)
        print("Create it and add .md guideline files, e.g.:", file=sys.stderr)
        print("  mkdir -p data/guidelines", file=sys.stderr)
        print("  # copy your guideline .md files there", file=sys.stderr)
        sys.exit(1)

    md_files = list(docs_path.rglob("*.md"))
    if not md_files:
        print(f"ERROR: No .md files found in {docs_path.resolve()}", file=sys.stderr)
        sys.exit(1)

    print(f"Building RAG index from {len(md_files)} document(s) in {docs_path.resolve()}")
    print(f"  Model:     {args.model}")
    print(f"  Chunk max: {args.chunk_size} chars")
    print(f"  Overlap:   {args.overlap} chars")
    print(f"  Output:    {Path(args.index_dir).resolve()}")
    print()

    from backend.rag.indexer import build_index

    info = build_index(
        docs_dir=args.docs_dir,
        index_dir=args.index_dir,
        model_name=args.model,
        max_chunk_chars=args.chunk_size,
        overlap_chars=args.overlap,
    )

    print()
    print("✓ Index built successfully!")
    print(f"  Chunks:     {info['num_chunks']}")
    print(f"  Dimensions: {info['embedding_dim']}")
    print(f"  Documents:  {info['num_documents']}")
    print()
    print("Next steps:")
    print("  1. Enable RAG in .env:")
    print("     RAG_ENABLED=true")
    print("  2. Restart the backend:")
    print("     uvicorn backend.main:app --reload")
    print("  3. Upload an ECG and request a report — the AI will now")
    print("     cite AHA/ACCF/HRS guideline criteria.")


if __name__ == "__main__":
    main()
