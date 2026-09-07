"""
RAG Pipeline — assembles retrieval-augmented context for the AI report
generator.

Given an ECGResult, this module:
    1. Constructs clinical queries from the model's flags and predictions.
    2. Queries the GuidelineRetriever for relevant guideline passages.
    3. Formats the retrieved context for injection into the LLM system prompt.

This is the only module the rest of the backend needs to call:

    from backend.rag.pipeline import build_rag_report_context
    rag_context = build_rag_report_context(result)
    # → pass rag_context into the LLM prompt in ai_report.py
"""

import logging
from typing import Any, Dict, List, Optional

from backend.config import settings
from backend.models.ecg_result import ECGResult
from backend.rag.retriever import GuidelineRetriever, get_retriever

logger = logging.getLogger(__name__)


# ── Query construction ────────────────────────────────────────────────────

# Map CNN superclass labels to clinical search queries that will pull the
# most relevant guideline passages from Surawicz et al. 2009.
FLAG_TO_QUERIES: Dict[str, List[str]] = {
    "myocardial_infarction": [
        "ST segment elevation criteria STEMI diagnostic thresholds",
        "pathological Q waves criteria myocardial infarction",
        "ST depression ischemia subendocardial injury",
        "T wave changes ischemia hyperacute inverted",
        "evolution STEMI ECG changes acute coronary syndrome",
    ],
    "conduction_defect": [
        "right bundle branch block RBBB diagnostic criteria",
        "left bundle branch block LBBB diagnostic criteria",
        "left anterior fascicular block hemiblock axis deviation",
        "bifascicular block trifascicular block conduction",
        "AV block first degree second degree third degree",
        "QRS duration prolonged intraventricular conduction delay",
    ],
    "hypertrophy": [
        "left ventricular hypertrophy LVH voltage criteria Sokolow-Lyon Cornell",
        "right ventricular hypertrophy RVH ECG criteria",
        "left atrial abnormality enlargement P mitrale",
        "right atrial abnormality P pulmonale",
        "LVH strain pattern ST depression lateral leads",
    ],
    "st_t_abnormality": [
        "ST segment depression elevation normal variants early repolarization",
        "T wave inversion normal abnormal repolarization",
        "QT interval prolonged short corrected Bazett Fridericia",
        "electrolyte abnormalities ECG hyperkalemia hypokalemia",
        "Brugada syndrome ST elevation V1 V2 coved saddleback",
        "drug effects ECG digoxin antiarrhythmics",
    ],
}

# Queries used when the prediction is "normal" (confirm normality criteria)
NORMAL_QUERIES = [
    "normal ECG waveform morphology P wave QRS T wave",
    "normal sinus rhythm criteria heart rate PR interval",
    "normal ST segment T wave QT interval values",
    "early repolarization normal variant benign",
]


def build_queries(
    flags: List[str],
    confidence_scores: List[float],
    overall_prediction: str,
    top_k_queries: int = 5,
) -> List[str]:
    """
    Build a prioritised list of clinical search queries from the ECG result.

    Strategy:
    - For each flagged superclass, add its associated queries (high-confidence
      flags contribute more queries than low-confidence ones).
    - If the prediction is "normal", add normality-confirmation queries.
    - Cap the total query count to avoid excessive retrieval latency.
    """
    queries: List[str] = []

    if not flags or overall_prediction == "normal":
        queries.extend(NORMAL_QUERIES)
        return queries

    # Sort flags by confidence (descending) so high-confidence flags get
    # their queries added first.
    paired = sorted(
        zip(flags, confidence_scores), key=lambda x: x[1], reverse=True
    )

    for flag, conf in paired:
        flag_queries = FLAG_TO_QUERIES.get(flag, [])
        if conf >= 0.5:
            # High confidence — use all associated queries
            queries.extend(flag_queries)
        elif conf >= 0.25:
            # Moderate — use the first 3 queries
            queries.extend(flag_queries[:3])
        else:
            # Weak signal — use only the top query
            queries.extend(flag_queries[:1])

    # Deduplicate while preserving order
    seen = set()
    unique: List[str] = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique.append(q)

    return unique[:top_k_queries]


# ── Context assembly ──────────────────────────────────────────────────────


def build_rag_report_context(
    result: ECGResult,
    top_k_per_query: int = 3,
    max_context_chars: int = 6000,
    min_score: float = 0.15,
) -> str:
    """
    Retrieve relevant guideline passages for an ECG result and format them
    as a context string ready for injection into an LLM prompt.

    Returns an empty string if:
    - RAG is disabled in config (settings.rag_enabled == False)
    - The FAISS index is not built yet (graceful degradation)
    - No relevant passages are found

    Args:
        result: the ECGResult to build context for.
        top_k_per_query: number of chunks to retrieve per query.
        max_context_chars: maximum total characters for the context string.
        min_score: minimum cosine similarity for a chunk to be included.
    """
    if not settings.rag_enabled:
        logger.debug("RAG disabled in config, skipping retrieval.")
        return ""

    try:
        retriever = get_retriever(
            index_dir=settings.rag_index_dir,
            model_name=settings.rag_embedding_model,
        )
    except FileNotFoundError as e:
        logger.warning("RAG index not found, skipping: %s", e)
        return ""
    except Exception as e:
        logger.warning("RAG retriever failed to initialise, skipping: %s", e)
        return ""

    queries = build_queries(
        flags=result.flags or [],
        confidence_scores=result.confidence_scores or [],
        overall_prediction=result.overall_prediction,
        top_k_queries=settings.rag_max_queries,
    )

    if not queries:
        return ""

    logger.info(
        "RAG: searching %d queries for result %d (patient %s)",
        len(queries),
        result.id,
        result.patient_id,
    )

    results = retriever.search_multi(
        queries=queries,
        top_k_per_query=top_k_per_query,
        min_score=min_score,
        deduplicate=True,
    )

    if not results:
        logger.info("RAG: no relevant passages found for result %d", result.id)
        return ""

    context = retriever.format_context(results, max_chars=max_context_chars)
    logger.info(
        "RAG: retrieved %d passages (%d chars) for result %d",
        len(results),
        len(context),
        result.id,
    )

    return context


def build_rag_context_header() -> str:
    """
    Return the instruction header that tells the LLM how to use the RAG
    context. Prepended to the retrieved passages in the system prompt.
    """
    return (
        "CLINICAL GUIDELINE REFERENCE (Retrieved from AHA/ACCF/HRS "
        "Surawicz et al., 2009 Recommendations):\n"
        "The following passages from authoritative clinical guidelines have "
        "been retrieved for this specific ECG analysis. Use these passages to:\n"
        "1. Ground your explanations in specific diagnostic criteria and "
        "thresholds (e.g., ST elevation ≥2 mm in V2-V3, QTc >460 ms).\n"
        "2. Reference waveform morphology descriptions and clinical "
        "significance from the guideline.\n"
        "3. Cite specific criteria (e.g., Sokolow-Lyon, Cornell voltage) "
        "when relevant to the flagged patterns.\n"
        "4. Compare the model's probability against the guideline's "
        "diagnostic thresholds to calibrate your language.\n"
        "If a retrieved passage is not relevant to this specific result, "
        "ignore it. Do not fabricate criteria not present in the guideline.\n"
    )
