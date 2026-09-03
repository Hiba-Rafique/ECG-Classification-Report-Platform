"""
Guideline Retriever — loads a pre-built FAISS index and performs semantic
search to find the most relevant guideline passages for a given query.

The retriever:
    1. Loads the FAISS index + chunks.json + index_info.json at init time.
    2. Lazy-loads the sentence-transformer model (shared with the indexer).
    3. Embeds the query, runs FAISS inner-product search (= cosine similarity
       after L2 normalisation).
    4. Returns the top-k chunks with similarity scores.

Usage:
    from backend.rag.retriever import GuidelineRetriever

    retriever = GuidelineRetriever("data/index")
    results = retriever.search("ST elevation criteria in V2-V3", top_k=5)
    for r in results:
        print(f"[{r['score']:.3f}] {r['section']}")
        print(r['text'][:120])
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


class GuidelineRetriever:
    """Semantic search over a pre-built FAISS index of guideline chunks."""

    def __init__(
        self,
        index_dir: str = "data/index",
        model_name: Optional[str] = None,
    ):
        """
        Load a saved FAISS index and its metadata.

        Args:
            index_dir: directory containing faiss.index, chunks.json, index_info.json.
            model_name: override the embedding model recorded in index_info.json.
        """
        self.index_path = Path(index_dir)
        self._validate_artefacts()

        # Load metadata
        info = json.loads(
            (self.index_path / "index_info.json").read_text(encoding="utf-8")
        )
        self.model_name = model_name or info["model_name"]
        self.embedding_dim: int = info["embedding_dim"]
        self.num_chunks: int = info["num_chunks"]

        # Load chunks
        self.chunks: List[Dict[str, Any]] = json.loads(
            (self.index_path / "chunks.json").read_text(encoding="utf-8")
        )

        # Load FAISS index
        import faiss

        self.index = faiss.read_index(str(self.index_path / "faiss.index"))
        logger.info(
            "Retriever loaded: %d chunks, dim=%d, model=%s",
            self.num_chunks,
            self.embedding_dim,
            self.model_name,
        )

        # Lazy-load the embedder (deferred until first search)
        self._embedder = None

    def _validate_artefacts(self) -> None:
        required = ["faiss.index", "chunks.json", "index_info.json"]
        missing = [
            f for f in required if not (self.index_path / f).exists()
        ]
        if missing:
            raise FileNotFoundError(
                f"RAG index artefacts missing in {self.index_path.resolve()}: "
                f"{missing}. Run `python -m scripts.build_index` first."
            )

    def _get_embedder(self):
        """Lazy-load sentence-transformer on first use."""
        if self._embedder is None:
            from sentence_transformers import SentenceTransformer

            self._embedder = SentenceTransformer(self.model_name)
            logger.info("Embedding model loaded: %s", self.model_name)
        return self._embedder

    def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve the top-k most similar chunks for a query.

        Args:
            query: natural-language query (e.g. "LBBB diagnostic criteria").
            top_k: number of chunks to return.
            min_score: minimum cosine similarity to include a result.

        Returns:
            List of dicts: {text, section, source, score, chunk_hash}
            Sorted by descending similarity score.
        """
        if not query.strip():
            return []

        embedder = self._get_embedder()

        # Embed and normalise the query
        q_emb = embedder.encode([query], normalize_embeddings=True)
        q_vec = np.array(q_emb, dtype="float32")

        # FAISS inner-product search (cosine similarity after normalisation)
        k = min(top_k, self.num_chunks)
        scores, indices = self.index.search(q_vec, k)

        results: List[Dict[str, Any]] = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or score < min_score:
                continue
            chunk = self.chunks[idx].copy()
            chunk["score"] = float(score)
            results.append(chunk)

        return results

    def search_multi(
        self,
        queries: List[str],
        top_k_per_query: int = 3,
        min_score: float = 0.0,
        deduplicate: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Run multiple queries and merge results, optionally deduplicating.

        Useful when building context from multiple aspects of a single
        ECG result (e.g. one query per flagged superclass).

        Returns a flat list of unique chunks sorted by score (descending).
        """
        all_results: List[Dict[str, Any]] = []
        seen_hashes = set()

        for query in queries:
            hits = self.search(query, top_k=top_k_per_query, min_score=min_score)
            for hit in hits:
                h = hit["chunk_hash"]
                if deduplicate and h in seen_hashes:
                    continue
                seen_hashes.add(h)
                all_results.append(hit)

        all_results.sort(key=lambda x: x["score"], reverse=True)
        return all_results

    def format_context(
        self,
        results: List[Dict[str, Any]],
        max_chars: int = 6000,
    ) -> str:
        """
        Format retrieved chunks into a single context string for injection
        into an LLM prompt.

        Truncates to max_chars total, preserving whole chunks where possible.
        Each chunk is separated by a divider and annotated with its source.
        """
        if not results:
            return ""

        parts: List[str] = []
        total = 0
        for i, r in enumerate(results, 1):
            header = f"[Guideline {i}] {r['section']} (source: {r['source']}, relevance: {r['score']:.2f})"
            block = f"{header}\n{r['text']}"
            if total + len(block) + 4 > max_chars:
                # Truncate this chunk to fit within budget
                remaining = max_chars - total - len(header) - 8
                if remaining > 100:
                    parts.append(f"{header}\n{r['text'][:remaining]}...")
                break
            parts.append(block)
            total += len(block) + 4  # +4 for the separator

        return "\n\n---\n\n".join(parts)


# ── Singleton accessor (loaded once per process, reused) ─────────────

_retriever: Optional[GuidelineRetriever] = None


def get_retriever(
    index_dir: str = "data/index",
    model_name: Optional[str] = None,
) -> GuidelineRetriever:
    """Get or create the singleton GuidelineRetriever."""
    global _retriever
    if _retriever is None:
        _retriever = GuidelineRetriever(index_dir, model_name)
    return _retriever
