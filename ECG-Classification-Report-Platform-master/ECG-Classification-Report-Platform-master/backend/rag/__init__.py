"""
RAG (Retrieval-Augmented Generation) module for ECG clinical guidelines.

Provides document chunking, embedding, FAISS indexing, and semantic retrieval
to ground LLM-generated reports in authoritative clinical guidelines
(Surawicz et al., 2009 AHA/ACCF/HRS recommendations).

Sub-modules:
    indexer   — chunk documents, embed with sentence-transformers, build FAISS index
    retriever — load a saved FAISS index, run semantic search over chunks
    pipeline  — orchestrates retrieval → prompt assembly → LLM call

Usage:
    from backend.rag.pipeline import build_rag_report_context
    context = build_rag_report_context(result, top_k=5)
"""

from backend.rag.retriever import GuidelineRetriever
from backend.rag.pipeline import build_rag_report_context

__all__ = ["GuidelineRetriever", "build_rag_report_context"]
