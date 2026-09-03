"""
AI Clinical Report service.

Generates a structured, physician-facing report explaining a CNN ECG analysis
result: what each flagged pattern means in clinical terms, how to read the
combination, and which follow-up actions to consider.

Configuration (backend .env):
    AI_API_KEY   — API key (leave empty to use the rule-based template fallback)
    AI_BASE_URL  — OpenAI-compatible endpoint (default: https://api.openai.com/v1)
    AI_MODEL     — model name (default: gpt-4o-mini)

Works with Gemini (via its OpenAI-compat layer), OpenAI, Groq, OpenRouter, or
a local Ollama server by changing AI_BASE_URL/AI_MODEL — any endpoint
implementing /chat/completions.

Report shape (identical for the LLM and template paths):
    summary                — overview paragraph
    urgency                — "routine" | "monitoring" | "expedited"
    findings[]             — per flag: flag, confidence (0-1), explanation
    overall_interpretation — synthesis paragraph
    recommendations[]      — prioritized actions
    limitations[]          — caveats about this analysis
    disclaimer             — fixed legal text
    generated_by           — "ai" | "template"
    rag_used               — whether RAG guideline context was used
    guideline_references[] — (optional) which guideline criteria were applied

When RAG is enabled (RAG_ENABLED=true in .env):
    - LLM path: guideline passages are injected into the prompt so the
      LLM cites specific AHA/ACCF/HRS diagnostic criteria.
    - Template path: findings use guideline-grounded explanations with
      specific thresholds (e.g. ST elevation ≥2 mm in V2-V3) instead of
      generic superclass descriptions. Live FAISS retrieval supplements
      the static criteria when the index is available.
"""

import logging
from typing import Any, Dict, List, Optional

from backend.config import settings
from backend.models.ecg_result import ECGResult
from backend.rag.pipeline import build_rag_report_context, build_rag_context_header

logger = logging.getLogger(__name__)

DISCLAIMER = (
    "This AI-generated summary is decision support only. It is not a diagnosis. "
    "The treating physician is responsible for all clinical interpretation "
    "and decisions."
)

URGENCY_LEVELS = ("routine", "monitoring", "expedited")

# Factual context about the classifier, so the LLM interprets the numbers
# honestly instead of guessing what "confidence" means here.
MODEL_CONTEXT = (
    "About the classifier you are reporting on:\n"
    "- A 1D convolutional neural network trained on PTB-XL (21k+ standardized\n"
    "  12-lead, 10-second resting ECGs) to score 5 diagnostic superclasses:\n"
    "  normal, myocardial_infarction, conduction_defect, hypertrophy,\n"
    "  st_t_abnormality.\n"
    "- Probabilities come from a softmax across those 5 classes and are NOT\n"
    "  calibrated certainties.\n"
    "- Any non-normal class above 0.15 probability is listed as a flag, so\n"
    "  low-confidence flags are weak signals, not established findings.\n"
    "- Overall prediction is the argmax class (normal vs abnormal).\n"
    "- The recording was bandpass-filtered (0.5-45 Hz), resampled to 500 Hz,\n"
    "  and z-score normalized per lead before classification."
)

SYSTEM_PROMPT = (
    "You are a clinical decision-support assistant writing an ECG analysis "
    "report for the physician who will review this recording.\n\n"
    "Your job: explain what the model's output MEANS in clear clinical "
    "language — what each flagged superclass pattern typically looks like on "
    "a trace, what it can represent pathophysiologically, what belongs in "
    "the differential, and what a sensible next step looks like.\n\n"
    "Rules:\n"
    "1. You are NOT making a diagnosis. Frame everything as what the model "
    "detected: 'the model flagged a pattern consistent with…', 'consider "
    "correlating with…'. Never state or imply the patient HAS a condition.\n"
    "2. Audience is a physician — assume medical fluency, but explain what "
    "these superclass labels encompass, since the categories are dataset "
    "groupings, not textbook entities.\n"
    "3. Weight each flag by its stated probability: above ~50% deserves real "
    "attention; 25-50% is moderate; below 25% is a weak signal that may be "
    "noise and should be described as such.\n"
    "4. Be specific and educational: name the waveform features involved "
    "(e.g. pathological Q waves, ST elevation, wide notched QRS, voltage "
    "criteria), the differential, and what would confirm or exclude it.\n"
    "5. Calm, professional tone. Urgency must match the actual flags and "
    "probabilities — no alarmism.\n"
    "6. Respond ONLY with JSON matching the requested schema: no markdown, "
    "no commentary, no extra keys."
)

REPORT_SCHEMA = (
    "{\n"
    '  "summary": "3-5 sentences: what was analyzed, what the model '
    'concluded, and the bottom line for the reviewer",\n'
    '  "urgency": "routine | monitoring | expedited",\n'
    '  "findings": [\n'
    '    {"flag": "<exact flag name from the input>", "explanation": '
    '"2-4 sentences: what this superclass covers in ECG terms, typical '
    'waveform features, the main differential, and how the stated '
    'probability should temper interpretation"}\n'
    "  ],\n"
    '  "overall_interpretation": "1 paragraph tying the flags into a '
    'combined clinical picture; with no flags, what a normal prediction '
    'does and does not rule out",\n'
    '  "recommendations": ["3-5 concrete actions, most important first, '
    'each with a brief rationale"],\n'
    '  "limitations": ["2-4 honest caveats specific to this analysis"]\n'
    "}"
)


def _result_context(result: ECGResult) -> str:
    """Everything the LLM should know about this specific result."""
    lines = [
        f"- Patient ID: {result.patient_id}",
        f"- Recording file: {result.filename}",
        f"- Overall model prediction: {result.overall_prediction}",
    ]
    if result.raw_signal_summary:
        lines.append(
            f"- Input: 12-lead ECG, {result.raw_signal_summary.lower()}"
        )
    if result.flags:
        for flag, conf in zip(result.flags, result.confidence_scores):
            strength = (
                "high-confidence"
                if conf >= 0.5
                else "moderate"
                if conf >= 0.25
                else "weak signal, possibly noise"
            )
            lines.append(
                f"- Flag: {flag} — probability {conf:.0%} ({strength})"
            )
    else:
        lines.append("- Flags: none (no non-normal class exceeded 0.15)")
    return "\n".join(lines)


def _rag_context_block(result: ECGResult) -> str:
    """Build the RAG context block for injection into the user prompt.

    Returns an empty string when RAG is disabled, the index is missing,
    or no relevant passages are retrieved — the report degrades gracefully.
    """
    rag_text = build_rag_report_context(result)
    if not rag_text:
        return ""
    header = build_rag_context_header()
    return f"\n\n{header}\n{rag_text}\n"


def _user_prompt(result: ECGResult, rag_block: str = "") -> str:
    # If rag_block was not pre-computed, build it now (backward compat)
    if not rag_block:
        rag_block = _rag_context_block(result)

    return (
        f"ECG analysis result to report on:\n{_result_context(result)}\n\n"
        f"{MODEL_CONTEXT}\n\n"
        f"Respond with JSON in exactly this shape:\n{REPORT_SCHEMA}\n\n"
        'Choose "urgency" as the attention level the output warrants — '
        '"routine" (normal prediction, no flags), "monitoring" (abnormal '
        'patterns at low-to-moderate probability only), or "expedited" '
        '(high-probability patterns a physician should review promptly, '
        "e.g. a strong infarction signal). It is a suggested attention "
        "level, not a triage or emergency determination.\n\n"
        "Constraints:\n"
        "- findings[] must contain one entry per flag above, echoing each "
        "flag name EXACTLY as written; do not rename, merge, or invent "
        "flags. With no flags, use an empty array.\n"
        "- Write in natural clinical prose; no bullet characters inside "
        "string values.\n"
        "- When RAG guideline context is provided below, reference specific "
        "diagnostic criteria, thresholds, and waveform descriptions from the "
        "guidelines to ground your explanations. Cite the criteria by name "
        "(e.g., 'per AHA/ACCF/HRS criteria, STEMI requires ≥2 mm ST elevation "
        "in V2-V3...')."
        f"{rag_block}"
    )


# ── LLM path ────────────────────────────────────────────────────────────

def _canonical_flag(flag: str) -> str:
    """Normalize a flag name to the snake_case form the model uses."""
    return flag.strip().lower().replace(" ", "_").replace("-", "_")


def _str_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def _normalize_llm_report(
    parsed: Dict[str, Any],
    result: ECGResult,
    rag_used: bool = False,
    guideline_references: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Validate and coerce the LLM's JSON into the canonical report shape.

    Confidences are taken from the stored result — never from the LLM — so
    the numbers shown to physicians always match the model output.
    """
    summary = str(parsed.get("summary", "")).strip()
    if not summary:
        raise ValueError("LLM response missing 'summary'")

    conf_by_flag = {
        _canonical_flag(f): c
        for f, c in zip(result.flags, result.confidence_scores)
    }

    findings: List[Dict[str, Any]] = []
    seen = set()
    for item in parsed.get("findings") or []:
        if not isinstance(item, dict):
            continue
        flag = _canonical_flag(str(item.get("flag", "")))
        if not flag or flag in seen:
            continue
        seen.add(flag)
        findings.append(
            {
                "flag": flag,
                "confidence": conf_by_flag.get(flag),
                "explanation": str(item.get("explanation", "")).strip(),
            }
        )

    urgency = parsed.get("urgency")
    if urgency not in URGENCY_LEVELS:
        urgency = "monitoring" if result.flags else "routine"

    report: Dict[str, Any] = {
        "result_id": result.id,
        "summary": summary,
        "urgency": urgency,
        "findings": findings,
        "overall_interpretation": str(
            parsed.get("overall_interpretation", "")
        ).strip(),
        "recommendations": _str_list(parsed.get("recommendations")),
        "limitations": _str_list(parsed.get("limitations")),
        "disclaimer": DISCLAIMER,
        "generated_by": "ai",
        "rag_used": rag_used,
    }

    if guideline_references:
        report["guideline_references"] = guideline_references

    return report


async def generate_report_with_llm(result: ECGResult) -> Dict[str, Any]:
    """Call an OpenAI-compatible chat completion endpoint."""
    import httpx
    import json

    # Build RAG context once (empty string when disabled / unavailable)
    rag_block = _rag_context_block(result)
    rag_used = bool(rag_block)

    # Build the user prompt (includes RAG context if available)
    user_prompt = _user_prompt(result, rag_block=rag_block)

    # rstrip("/") so base URLs with or without a trailing slash both work
    # (Google documents the Gemini OpenAI-compat base URL WITH a slash)
    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.ai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.ai_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]

    return _normalize_llm_report(
        json.loads(content), result, rag_used=rag_used,
        guideline_references=_build_llm_guideline_references(result, rag_used),
    )


def _build_llm_guideline_references(
    result: ECGResult, rag_used: bool
) -> List[str]:
    """Build guideline_references list for the LLM report when RAG was used."""
    if not rag_used or not result.flags:
        return []
    refs = []
    for flag in result.flags:
        if flag in RAG_FLAG_DETAILS:
            refs.append(
                f"{flag}: AHA/ACCF/HRS diagnostic criteria applied "
                f"(Surawicz et al., 2009)"
            )
    return refs


# ── Template fallback (no API key / LLM failure) ─────────────────────────

# ── RAG-grounded guideline details ─────────────────────────────────────
# These contain specific AHA/ACCF/HRS criteria from Surawicz et al. 2009.
# Used by the template path when RAG retrieval is available to produce
# guideline-grounded reports even without an LLM.

RAG_FLAG_DETAILS: Dict[str, Dict[str, Any]] = {
    "myocardial_infarction": {
        "guideline_explanation": (
            "Per AHA/ACCF/HRS recommendations (Surawicz et al., 2009), "
            "myocardial infarction ECG signatures include: ST-segment elevation "
            "at the J-point in ≥2 contiguous leads with cut-points: ≥2.5 mm in "
            "men <40 years (≥2 mm in men ≥40, ≥1.5 mm in women) in V2-V3; "
            "≥1 mm in other leads. Pathological Q waves: ≥30 ms duration, "
            "≥1 mm deep, and Q-wave width ≥1 mm in leads I, II, aVL, aVF, or "
            "V4-V6. ST depression ≥0.5 mm in V1-V3 may indicate posterior "
            "injury. T-wave inversion ≥1 mm in two contiguous leads is a "
            "supporting but non-specific sign."
        ),
        "guideline_recommendations": [
            "Compare ST-segment measurements against AHA/ACCF/HRS J-point elevation thresholds for the relevant lead territories",
            "Assess for reciprocal ST depression in opposing leads to strengthen the ischemia hypothesis",
            "Serial ECGs at 15-30 minute intervals per guideline recommendation to detect evolving changes",
        ],
    },
    "conduction_defect": {
        "guideline_explanation": (
            "Per AHA/ACCF/HRS recommendations, conduction defects are defined by "
            "specific QRS morphology and duration criteria. Complete RBBB: QRS "
            "≥120 ms, rsr'/rsR'/rSR' in V1-V2, wide slurred S in I and V6. "
            "Complete LBBB: QRS ≥120 ms, broad notched/slurred R in I, aVL, "
            "V5-V6, absent Q in lateral leads. LAFB: QRS <120 ms, left axis "
            "deviation (-45° to -90°), qR in I/aVL, rS in II/III/aVF. "
            "Bifascicular block: RBBB + LAFB or RBBB + LPFB. AV block grading: "
            "1st degree (PR >200 ms), 2nd degree Mobitz I (progressive PR "
            "lengthening), Mobitz II (dropped beats with constant PR), 3rd degree "
            "(AV dissociation)."
        ),
        "guideline_recommendations": [
            "Measure QRS duration and morphology against AHA/ACCF/HRS criteria for the specific block type suspected",
            "Determine whether the conduction defect is new by comparison with prior tracings — new LBBB carries different implications than chronic",
            "Assess ventricular rate and hemodynamic significance per guideline recommendations for AV block management",
        ],
    },
    "hypertrophy": {
        "guideline_explanation": (
            "Per AHA/ACCF/HRS recommendations, LVH voltage criteria include: "
            "Sokolow-Lyon (S in V1 + R in V5/V6 ≥35 mm), Cornell voltage "
            "(R in aVL + S in V3 >28 mm men, >20 mm women), Cornell product "
            "(Cornell voltage × QRS duration >2440 mm·ms). RVH criteria: "
            "R/S ratio >1 in V1, R in V1 ≥7 mm, right axis deviation ≥110°, "
            "S in V5/V7 ≥7 mm. Left atrial abnormality: P-terminal force in "
            "V1 ≥40 mm·ms (area ≥1 mm deep × 40 ms). Right atrial abnormality: "
            "P amplitude ≥2.5 mm in II/III/aVF. LVH with repolarization "
            "('strain') pattern: downsloping ST depression and asymmetric T "
            "inversion in lateral leads increases specificity."
        ),
        "guideline_recommendations": [
            "Apply Sokolow-Lyon and Cornell voltage criteria on the raw 12-lead tracing to verify the hypertrophy signal",
            "Check for LVH strain pattern (ST-T changes in lateral leads) which increases specificity per guidelines",
            "Echocardiography recommended for structural confirmation — ECG voltage criteria have limited sensitivity and specificity per AHA/ACCF/HRS",
        ],
    },
    "st_t_abnormality": {
        "guideline_explanation": (
            "Per AHA/ACCF/HRS recommendations, ST-segment and T-wave abnormalities "
            "encompass a broad differential. ST depression: ≥0.5 mm horizontal or "
            "downsloping at J+60-80 ms is clinically significant; upsloping is less "
            "specific. ST elevation: ≥1 mm in non-V2-V3 leads; must be distinguished "
            "from early repolarization (notched/slurred J-point, concave-upward, "
            "stable over time). T-wave inversion: ≥1 mm in two contiguous leads is "
            "abnormal except in aVR, V1, III. QTc thresholds: prolonged >460 ms "
            "(men), >470 ms (women); markedly prolonged >500 ms increases "
            "arrhythmia risk. Hyperkalemia: tall peaked T waves → QRS widening → "
            "sine wave. Drug effects (digoxin): scooped ST, shortened QT."
        ),
        "guideline_recommendations": [
            "Measure ST-segment deviation at J+60-80 ms per AHA/ACCF/HRS measurement standards",
            "Calculate QTc using Bazett or Fridericia formula and compare against guideline thresholds (>460/470 ms prolonged)",
            "Review electrolytes and QT-prolonging medications when repolarization abnormalities are detected",
            "Distinguish early repolarization (benign) from ischemic ST elevation using morphology criteria per guidelines",
        ],
    },
}

FLAG_DETAILS: Dict[str, Dict[str, Any]] = {
    "myocardial_infarction": {
        "urgency": "expedited",
        "explanation": (
            "This superclass groups ischemic and infarction signatures: "
            "pathological Q waves, ST-segment elevation or depression, and "
            "T-wave changes in coronary-territory distributions — spanning "
            "both acute injury patterns and chronic infarct sequelae. The "
            "differential includes early repolarization, benign ST variants, "
            "and rate-related changes, so territory and serial comparison "
            "carry real weight."
        ),
        "recommendations": [
            "Correlate with presenting symptoms, serial ECGs, and troponin — high-confidence infarction patterns warrant prompt physician review",
            "Compare against any prior ECG to establish whether changes are new",
        ],
    },
    "conduction_defect": {
        "urgency": "monitoring",
        "explanation": (
            "This superclass covers conduction-system abnormalities: bundle "
            "branch blocks (wide, notched QRS), fascicular blocks, axis "
            "deviations, and AV-conduction delays. Many are chronic and "
            "incidental, but new blocks can signal structural or ischemic "
            "disease; in asymptomatic patients an isolated block is often "
            "benign."
        ),
        "recommendations": [
            "Review the QRS morphology and measure intervals on the full 12-lead trace",
            "If the block is new, evaluate for ischemia, electrolyte disturbance, and medication effects",
        ],
    },
    "hypertrophy": {
        "urgency": "monitoring",
        "explanation": (
            "This superclass reflects chamber-enlargement patterns: voltage "
            "criteria for ventricular hypertrophy, atrial-enlargement "
            "signatures in P-wave morphology, and pressure-overload changes. "
            "Voltage criteria are sensitive but notoriously unspecific — body "
            "habitus, age, and lead placement all shift them, and "
            "echocardiography remains the confirmation standard."
        ),
        "recommendations": [
            "Consider echocardiography for structural confirmation if not recently done",
            "Correlate with blood pressure history and any murmur on examination",
        ],
    },
    "st_t_abnormality": {
        "urgency": "monitoring",
        "explanation": (
            "This superclass captures ST-segment and T-wave changes: "
            "ischemic patterns, nonspecific repolarization abnormalities, "
            "electrolyte and drug effects, and rate-related changes. It is "
            "the most heterogeneous category — findings range from clinically "
            "silent variants to ischemic red flags, so waveform review with "
            "clinical context decides their weight."
        ),
        "recommendations": [
            "Review the ST-segment morphology and T-wave axis on the raw waveform",
            "Check electrolytes (K⁺, Mg²⁺, Ca²⁺) and review QT-prolonging medications",
        ],
    },
}

GENERIC_FINDING_EXPLANATION = (
    "The model assigned probability to this diagnostic superclass "
    "(a PTB-XL grouping of related conditions). See the flagged regions on "
    "the waveform above and weigh this against the stated confidence."
)

GENERIC_RECOMMENDATIONS = [
    "Correlate the flagged regions with the raw waveform before acting on them",
    "Compare with any prior ECG for this patient to establish chronicity",
    "Integrate findings with presentation, vitals, and labs",
]

TEMPLATE_LIMITATIONS = [
    "Based on a single short recording (10-second segments) with no clinical history, symptoms, or medication context",
    "Softmax probabilities are not calibrated certainties; flags below ~25% may be noise",
    "Superclass labels group many distinct conditions and cannot replace full waveform review by a cardiologist",
    "Benchmarked on PTB-XL; performance may differ on other machines or populations",
]


# ── RAG retrieval helper for template path ─────────────────────────────

def _retrieve_flag_guidelines(
    flags: List[str],
    confidence_scores: List[float],
) -> Dict[str, Dict[str, Any]]:
    """Retrieve guideline-grounded details for each flag via RAG.

    Returns a dict mapping flag name → {guideline_explanation, guideline_recommendations}
    when RAG is available and passages are found. Falls back to RAG_FLAG_DETAILS
    static criteria when the retriever is unavailable but RAG is enabled.

    Returns an empty dict when RAG is disabled.
    """
    if not settings.rag_enabled:
        return {}

    # Try the live retriever first
    live_results: Dict[str, Dict[str, Any]] = {}
    try:
        from backend.rag.retriever import get_retriever
        from backend.rag.pipeline import FLAG_TO_QUERIES

        retriever = get_retriever(
            index_dir=settings.rag_index_dir,
            model_name=settings.rag_embedding_model,
        )

        for flag, conf in zip(flags, confidence_scores):
            if conf < 0.15:
                continue
            flag_queries = FLAG_TO_QUERIES.get(flag, [])
            if not flag_queries:
                continue
            # Use fewer queries for the template path (latency-sensitive)
            top_q = min(3 if conf >= 0.5 else 2 if conf >= 0.25 else 1, len(flag_queries))
            hits = retriever.search_multi(
                queries=flag_queries[:top_q],
                top_k_per_query=2,
                min_score=0.20,
                deduplicate=True,
            )
            if hits:
                context = retriever.format_context(hits, max_chars=800)
                live_results[flag] = {
                    "guideline_context": context,
                    "num_passages": len(hits),
                }
    except Exception as e:
        logger.debug("RAG live retrieval failed for template: %s", e)

    # Build the final guideline details: static criteria + live passages
    guideline_details: Dict[str, Dict[str, Any]] = {}
    for flag in flags:
        static = RAG_FLAG_DETAILS.get(flag)
        live = live_results.get(flag)

        if static or live:
            detail: Dict[str, Any] = {}
            if static:
                detail["guideline_explanation"] = static["guideline_explanation"]
                detail["guideline_recommendations"] = static.get(
                    "guideline_recommendations", []
                )
            if live:
                detail["guideline_context"] = live["guideline_context"]
                detail["num_passages"] = live["num_passages"]
            guideline_details[flag] = detail

    return guideline_details


def generate_report_template(result: ECGResult) -> Dict[str, Any]:
    """Rule-based report used when no AI_API_KEY is configured.

    When RAG is enabled, enriches findings with specific AHA/ACCF/HRS
    diagnostic criteria retrieved from clinical guidelines, producing
    guideline-grounded reports without an LLM.
    """
    # Retrieve guideline-grounded details if RAG is available
    guideline_details = _retrieve_flag_guidelines(
        result.flags or [], result.confidence_scores or []
    )
    rag_used = bool(guideline_details)

    findings: List[Dict[str, Any]] = []
    recommendations: List[str] = []
    guideline_references: List[str] = []
    urgency = "routine"

    for flag, conf in zip(result.flags, result.confidence_scores):
        detail = FLAG_DETAILS.get(flag, {})
        rag_detail = guideline_details.get(flag, {})

        strength = (
            "strong"
            if conf >= 0.5
            else "moderate"
            if conf >= 0.25
            else "weak — possibly noise"
        )

        # Use guideline-grounded explanation when available, else fallback
        if rag_detail.get("guideline_explanation"):
            base_explanation = rag_detail["guideline_explanation"]
        else:
            base_explanation = detail.get("explanation", GENERIC_FINDING_EXPLANATION)

        findings.append(
            {
                "flag": flag,
                "confidence": conf,
                "explanation": (
                    f"{base_explanation} At {conf:.0%} probability this is a "
                    f"{strength} signal."
                ),
            }
        )

        # Use guideline-grounded recommendations when available
        flag_recs = rag_detail.get(
            "guideline_recommendations", detail.get("recommendations", [])
        )
        recommendations.extend(flag_recs)

        # Track guideline reference for the report
        if rag_detail.get("guideline_explanation"):
            guideline_references.append(
                f"{flag}: AHA/ACCF/HRS diagnostic criteria applied "
                f"(Surawicz et al., 2009)"
            )

        if detail.get("urgency") == "expedited":
            urgency = "expedited"
        elif urgency == "routine":
            urgency = "monitoring"

    if result.overall_prediction == "normal" or not result.flags:
        summary = (
            f"The CNN model did not flag any abnormal regions in this "
            f"recording (patient {result.patient_id}). The signal passed "
            f"through the standard preprocessing pipeline and was classified "
            f"as normal across all analyzed segments."
        )
        if rag_used:
            interpretation = (
                "A normal superclass prediction means the network found no "
                "pattern resembling infarction, conduction disease, "
                "hypertrophy, or ST/T abnormality in this recording. Per "
                "AHA/ACCF/HRS recommendations, a normal ECG does not exclude "
                "acute pathology: subtle, evolving, or atypical findings can "
                "still be missed. The model sees only these 10 seconds with "
                "no clinical context. If symptoms or risk factors suggest "
                "otherwise, standard workup should proceed."
            )
        else:
            interpretation = (
                "A normal superclass prediction means the network found no "
                "pattern resembling infarction, conduction disease, "
                "hypertrophy, or ST/T abnormality in this recording. It does "
                "not exclude acute pathology: subtle, evolving, or atypical "
                "findings can still be missed, and the model sees only these "
                "10 seconds with no clinical context. If symptoms or risk "
                "suggest otherwise, standard workup should proceed."
            )
    else:
        flags_str = ", ".join(
            f"{flag} ({conf:.0%})"
            for flag, conf in zip(result.flags, result.confidence_scores)
        )
        summary = (
            f"The CNN model flagged {len(result.flags)} abnormal pattern"
            f"{'s' if len(result.flags) > 1 else ''} in this recording "
            f"(patient {result.patient_id}): {flags_str}. Overall "
            f"prediction: {result.overall_prediction}. Each flag is a "
            f"pattern-recognition output, not a diagnosis, and should be "
            f"verified against the raw waveform by the reviewing physician."
        )
        if rag_used:
            interpretation = (
                "Read this output as a ranked list of pattern hypotheses, not a "
                "combined diagnosis: the highest-confidence flag deserves first "
                "attention, and weaker flags are leads to verify rather than "
                "findings. Explanations above reference specific AHA/ACCF/HRS "
                "diagnostic criteria and thresholds to support waveform review. "
                "The flagged regions on the waveform show where the model drew "
                "its evidence from."
            )
        else:
            interpretation = (
                "Read this output as a ranked list of pattern hypotheses, not a "
                "combined diagnosis: the highest-confidence flag deserves first "
                "attention, and weaker flags are leads to verify rather than "
                "findings. The flagged regions on the waveform above show where "
                "the model drew its evidence from."
            )

    recommendations.extend(GENERIC_RECOMMENDATIONS)
    # Keep it digestible — cap at 5
    recommendations = recommendations[:5]

    # Add RAG-specific limitations when guidelines were used
    limitations = list(TEMPLATE_LIMITATIONS)
    if rag_used:
        limitations.insert(
            0,
            "Guideline criteria referenced from Surawicz et al. (2009 "
            "AHA/ACCF/HRS Recommendations) — diagnostic thresholds apply to "
            "standard 12-lead 10-second recordings and may not generalise to "
            "other acquisition settings",
        )

    report: Dict[str, Any] = {
        "result_id": result.id,
        "summary": summary,
        "urgency": urgency,
        "findings": findings,
        "overall_interpretation": interpretation,
        "recommendations": recommendations,
        "limitations": limitations,
        "disclaimer": DISCLAIMER,
        "generated_by": "template",
        "rag_used": rag_used,
    }

    if guideline_references:
        report["guideline_references"] = guideline_references

    return report


# ── Public entry point ──────────────────────────────────────────────────

async def generate_ai_report(result: ECGResult) -> Dict[str, Any]:
    """
    Generate a clinical summary report for an ECG result.
    Uses the LLM if AI_API_KEY is set; otherwise falls back to a
    rule-based template so the endpoint always returns something useful.
    """
    if settings.ai_api_key:
        try:
            return await generate_report_with_llm(result)
        except Exception as e:
            # Network/model errors shouldn't break the endpoint — degrade
            # gracefully to the template report.
            logger.warning(
                "LLM report generation failed, using template: %s", e
            )
    return generate_report_template(result)
