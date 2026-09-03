"""Quick smoke test for the RAG retriever."""
import sys
sys.path.insert(0, ".")

from backend.rag.retriever import GuidelineRetriever

r = GuidelineRetriever("data/index")

queries = [
    "LBBB diagnostic criteria QRS duration",
    "ST elevation STEMI thresholds V2 V3",
    "LVH Sokolow-Lyon voltage criteria",
    "hyperkalemia ECG tall peaked T waves",
]

for q in queries:
    print(f"\n{'='*60}")
    print(f"QUERY: {q}")
    print(f"{'='*60}")
    hits = r.search(q, top_k=3)
    for h in hits:
        print(f"  [{h['score']:.3f}] {h['section'][:80]}")
        print(f"    {h['text'][:150]}")
        print()

# Test the full pipeline context builder
print(f"\n{'='*60}")
print("PIPELINE TEST: build_rag_report_context")
print(f"{'='*60}")

from unittest.mock import MagicMock
from backend.rag.pipeline import build_rag_report_context

mock_result = MagicMock()
mock_result.id = 1
mock_result.patient_id = "test_patient"
mock_result.flags = ["myocardial_infarction", "st_t_abnormality"]
mock_result.confidence_scores = [0.72, 0.35]
mock_result.overall_prediction = "abnormal"

ctx = build_rag_report_context(mock_result)
print(f"Context length: {len(ctx)} chars")
print(f"Context preview (first 500 chars):\n{ctx[:500]}")
