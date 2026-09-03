"""
Document Indexer — chunks guideline markdown files, embeds them with
sentence-transformers, and builds a FAISS flat (inner-product) index.

Run via `scripts/build_index.py` or import directly:

    from backend.rag.indexer import build_index
    build_index(
        docs_dir="data/guidelines",
        index_dir="data/index",
        model_name="all-MiniLM-L6-v2",
    )

Output artefacts (all written to index_dir):
    faiss.index      — serialised FAISS index (float32 vectors)
    chunks.json      — JSON array of chunk metadata + text
    index_info.json  — build-time metadata (model name, doc count, dims)
"""

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

# ── Chunking ────────────────────────────────────────────────────────────

# Split on H2 or H3 markdown headings, keeping the heading as the chunk header.
_SECTION_RE = re.compile(r"^(#{1,3}\s.+)$", re.MULTILINE)


def chunk_markdown(
    text: str,
    source: str,
    max_chunk_chars: int = 1200,
    overlap_chars: int = 200,
) -> List[Dict[str, Any]]:
    """
    Split a markdown document into semantically meaningful chunks.

    Strategy:
    1. Split on H1/H2/H3 headings → sections.
    2. If a section exceeds max_chunk_chars, further split on H4 headings
       or paragraph breaks, with overlap_chars of trailing context prepended
       to the next sub-chunk.
    3. Each chunk records its section title, source file, and a deterministic
       content hash for deduplication.

    Returns a list of dicts: {text, section, source, chunk_hash}
    """
    sections = _split_into_sections(text)
    chunks: List[Dict[str, Any]] = []

    for title, body in sections:
        full_section = f"{title}\n\n{body}".strip()
        if len(full_section) <= max_chunk_chars:
            chunks.append(_make_chunk(full_section, title, source))
        else:
            chunks.extend(
                _split_large_section(
                    full_section, title, source, max_chunk_chars, overlap_chars
                )
            )

    return chunks


def _split_into_sections(text: str) -> List[Tuple[str, str]]:
    """Split markdown on H1/H2/H3 headings. Returns (heading, body) pairs."""
    parts = _SECTION_RE.split(text)
    sections: List[Tuple[str, str]] = []

    # parts[0] is text before the first heading (preamble)
    if parts[0].strip():
        sections.append(("Preamble", parts[0].strip()))

    # Remaining parts alternate: heading, body, heading, body, ...
    i = 1
    while i < len(parts):
        heading = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        if heading or body:
            sections.append((heading, body))
        i += 2

    return sections


def _split_large_section(
    text: str,
    title: str,
    source: str,
    max_chars: int,
    overlap: int,
) -> List[Dict[str, Any]]:
    """Sub-split a large section on paragraph breaks with overlap."""
    paragraphs = text.split("\n\n")
    chunks: List[Dict[str, Any]] = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 > max_chars and current:
            chunks.append(_make_chunk(current.strip(), title, source))
            # Keep trailing overlap context
            current = current[-overlap:].strip() + "\n\n" + para
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        chunks.append(_make_chunk(current.strip(), title, source))

    return chunks


def _make_chunk(text: str, section: str, source: str) -> Dict[str, Any]:
    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return {
        "text": text,
        "section": section,
        "source": source,
        "chunk_hash": content_hash,
    }


# ── Embedding + Indexing ────────────────────────────────────────────────


def build_index(
    docs_dir: str = "data/guidelines",
    index_dir: str = "data/index",
    model_name: str = "all-MiniLM-L6-v2",
    max_chunk_chars: int = 1200,
    overlap_chars: int = 200,
) -> Dict[str, Any]:
    """
    End-to-end index build:
    1. Read all .md files in docs_dir (recursively).
    2. Chunk each document.
    3. Embed chunks with sentence-transformers.
    4. Build a FAISS IndexFlatIP (normalised → cosine similarity).
    5. Write faiss.index, chunks.json, and index_info.json to index_dir.

    Returns a summary dict with chunk count, doc count, and model name.
    """
    import faiss
    import numpy as np
    from sentence_transformers import SentenceTransformer

    docs_path = Path(docs_dir)
    idx_path = Path(index_dir)
    idx_path.mkdir(parents=True, exist_ok=True)

    # ── 1. Discover documents ────────────────────────────────────────
    md_files = sorted(docs_path.rglob("*.md"))
    if not md_files:
        raise FileNotFoundError(
            f"No .md files found in {docs_path.resolve()}. "
            "Add guideline documents to data/guidelines/ first."
        )
    logger.info("Found %d guideline document(s) in %s", len(md_files), docs_path)

    # ── 2. Chunk ─────────────────────────────────────────────────────
    all_chunks: List[Dict[str, Any]] = []
    for md_file in md_files:
        text = md_file.read_text(encoding="utf-8")
        source = str(md_file.relative_to(docs_path.parent))
        file_chunks = chunk_markdown(
            text, source, max_chunk_chars=max_chunk_chars, overlap_chars=overlap_chars
        )
        logger.info("  %s → %d chunks", md_file.name, len(file_chunks))
        all_chunks.extend(file_chunks)

    if not all_chunks:
        raise ValueError("Document chunking produced zero chunks. Check your files.")

    logger.info("Total chunks: %d", len(all_chunks))

    # ── 3. Embed ─────────────────────────────────────────────────────
    logger.info("Loading embedding model: %s", model_name)
    embedder = SentenceTransformer(model_name)
    texts = [c["text"] for c in all_chunks]
    embeddings = embedder.encode(texts, show_progress_bar=True, normalize_embeddings=True)
    embeddings = np.array(embeddings, dtype="float32")

    # ── 4. Build FAISS index (flat inner product = cosine after norm) ─
    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    logger.info("FAISS index built: %d vectors, dim=%d", index.ntotal, dim)

    # ── 5. Persist ───────────────────────────────────────────────────
    faiss.write_index(index, str(idx_path / "faiss.index"))

    chunks_path = idx_path / "chunks.json"
    chunks_path.write_text(
        json.dumps(all_chunks, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    info = {
        "model_name": model_name,
        "embedding_dim": dim,
        "num_chunks": len(all_chunks),
        "num_documents": len(md_files),
        "max_chunk_chars": max_chunk_chars,
        "overlap_chars": overlap_chars,
        "source_files": [str(f.relative_to(docs_path.parent)) for f in md_files],
    }
    (idx_path / "index_info.json").write_text(
        json.dumps(info, indent=2), encoding="utf-8"
    )

    logger.info("Index artefacts written to %s", idx_path.resolve())
    return info
