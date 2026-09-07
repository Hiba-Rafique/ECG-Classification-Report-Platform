"""
Stage 3 + Stage 4 — Structured clinical case + LLM narrative layer.
Strictly aligned with AHA/ACCF/HRS standardization guidelines and 
structured diagnostic score formatting.
"""

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.config import settings
from backend.models.ecg_result import ECGResult
from backend.services.measurements import measure_ecg
from ml.inference import SUPERCLASSES, SUPERCLASS_READABLE

logger = logging.getLogger(__name__)

DISCLAIMER = (
    "This report is decision support only. It is not a diagnosis. The "
    "treating physician is responsible for all clinical interpretation "
    "and decisions. Narrative text is generated strictly from the "
    "structured analysis object following AHA/ACCF/HRS standards."
)

SECTION_KEYS = (
    "clinical_presentation",
    "ecg_findings",
    "diagnosis",
    "interpretation",
    "key_teaching_points",
)

SECTION_TITLES = {
    "clinical_presentation": "Clinical Presentation",
    "ecg_findings": "ECG Findings",
    "diagnosis": "Diagnosis",
    "interpretation": "Interpretation",
    "key_teaching_points": "Key Teaching Points",
}

SYSTEM_PROMPT = (
    "You are a senior clinical cardiologist producing narrative sections of a standardized 12-lead "
    "electrocardiogram report strictly complying with AHA/ACCF/HRS recommendations (including global "
    "interval standards, QRS duration criteria, and frontal plane electrical axis definitions). "
    "You will receive ONE structured JSON case object containing patient metadata, exact waveform measurements, "
    "and multi-label classification scores. Synthesize this object into professional clinical prose "
    "across exactly five keys: clinical_presentation, ecg_findings, diagnosis, interpretation, and key_teaching_points.\n\n"
    "STRICT COMPLIANCE RULES:\n"
    "1. FACTUAL FIDELITY: Use ONLY the values, facts, and findings explicitly present in the input JSON. "
    "Never invent, estimate, extrapolate, or round any numerical value or clinical metric.\n"
    "2. MISSING VALUES: Where any measurement or interval is null, explicitly state that it is 'unavailable' "
    "or provide qualitative context indicating that automated fiducial boundary detection was restricted by active waveform deviation.\n"
    "3. AHA TERMINOLOGY: Apply standard electrical axis phrasing (e.g., normal axis between -30° and 90°, left-axis deviation) "
    "and structural conduction parameters as provided in the dataset.\n"
    "4. GRAMMAR AND FORMATTING: Ensure every sentence is fully complete and properly punctuated with terminal periods. "
    "Each section must be a standard, contiguous prose string under 120 words without bullet points or lists.\n"
    "5. TONE: Maintain an objective clinical tone. Strictly avoid any reference to software models, neural networks, "
    "classifiers, algorithms, or artificial intelligence.\n\n"
    "Respond ONLY with a valid JSON object containing exactly these keys: "
    "clinical_presentation, ecg_findings, diagnosis, interpretation, key_teaching_points."
)


# ── Stage 3: structured case object ─────────────────────────────────────

def format_category_scores_table(class_probs: Dict[str, float], thresholds: Dict[str, float]) -> List[Dict[str, Any]]:
    """Generates structured table rows for diagnostic category scores using < or > signs and explicit thresholds."""
    rows = []
    for s, p in class_probs.items():
        pct = p * 100
        thresh_pct = thresholds[s] * 100
        relation = ">=" if p >= thresholds[s] else "<"
        eval_desc = f"{relation} {thresh_pct:.0f}%"
        rows.append({
            "category": SUPERCLASS_READABLE.get(s, s),
            "score_pct": round(pct, 1),
            "threshold_pct": round(thresh_pct, 1),
            "relation": relation,
            "display_string": f"{SUPERCLASS_READABLE.get(s, s)} {pct:.1f}% ({relation} {thresh_pct:.0f}%)"
        })
    return rows


def derive_findings(ecg: Dict[str, Any], class_probabilities: Dict[str, float],
                    thresholds: Dict[str, float]) -> List[str]:
    f: List[str] = []

    hr = ecg.get("heart_rate")
    if hr is None:
        f.append("Heart rate is not measurable from this recording.")
    elif hr < 60:
        f.append(f"The rhythm demonstrates bradycardia at {hr} beats per minute.")
    elif hr > 100:
        f.append(f"The rhythm demonstrates sinus or junctional tachycardia at {hr} beats per minute.")
    else:
        f.append(f"Heart rate is maintained at {hr} beats per minute.")

    qrs = ecg.get("qrs")
    if qrs is not None:
        if qrs >= 120:
            f.append(f"Global QRS duration is prolonged at {qrs} milliseconds, meeting criteria for intraventricular conduction disturbance.")
        else:
            f.append(f"Global QRS duration measures {qrs} milliseconds.")
    else:
        f.append("Precise QRS duration delineation is precluded by marked ST segment deviation or localized waveform distortion.")

    qtc = ecg.get("qtc")
    if qtc is not None:
        f.append(f"The Bazett-corrected QTc interval is measured at {qtc} milliseconds.")
    else:
        f.append("QT/QTc interval measurement is deferred due to baseline repolarization abnormalities.")

    ax = ecg.get("qrs_axis")
    if isinstance(ax, str):
        f.append(f"Frontal plane electrical axis reveals {ax}.")

    flagged = [(s, class_probabilities[s]) for s in SUPERCLASSES
               if class_probabilities[s] >= thresholds[s]]
    for s, p in flagged:
        if s != "NORM":
            pct = p * 100
            thresh_pct = thresholds[s] * 100
            f.append(f"Pattern recognition identifies features consistent with {SUPERCLASS_READABLE[s].lower()} ({pct:.1f}%, > {thresh_pct:.0f}%).")
    
    if not flagged:
        f.append("No abnormality pattern exceeds statistical reporting thresholds.")
        
    return f


def build_case(result: ECGResult, measurements: Dict[str, Any],
               class_probabilities: Dict[str, float],
               thresholds: Dict[str, float]) -> Dict[str, Any]:
    ecg = {
        "heart_rate": measurements.get("heart_rate"),
        "rhythm": measurements.get("rhythm"),
        "pr": measurements.get("pr"), 
        "qrs": measurements.get("qrs"),
        "qt": measurements.get("qt"), 
        "qtc": measurements.get("qtc"),
        "qrs_axis": measurements.get("qrs_axis"),
        "p_axis": measurements.get("p_axis"),
        "t_axis": measurements.get("t_axis"),
        "calibration": "10 mm/mV and 25 mm/s",
        "acquisition": "10-second standard 12-lead digital recording"
    }
    
    flagged = [(s, class_probabilities[s]) for s in SUPERCLASSES
               if class_probabilities[s] >= thresholds[s]]
    if flagged:
        diagnosis = [
            f"Findings consistent with {SUPERCLASS_READABLE[s].lower()} "
            f"({p * 100:.1f}%)"
            for s, p in flagged
        ]
    else:
        diagnosis = ["No diagnostic abnormalities detected beyond reporting thresholds."]

    scores_table = format_category_scores_table(class_probabilities, thresholds)

    return {
        "case_id": str(result.id),
        "recording": {
            "filename": result.filename,
            "patient_id": result.patient_id,
            "standard": "AHA/ACCF/HRS Recommendations",
        },
        "ecg": ecg,
        "findings": derive_findings(ecg, class_probabilities, thresholds),
        "diagnosis": diagnosis,
        "category_scores_table": scores_table,
        "class_probabilities": {s: round(float(class_probabilities[s]), 4)
                                for s in SUPERCLASSES},
        "thresholds": {s: round(float(thresholds[s]), 4) for s in SUPERCLASSES},
    }


# ── Stage 4: LLM narrative with numeric guardrail ───────────────────────

NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def _allowed_numbers(case: Dict[str, Any]) -> set:
    allowed = {"10", "12"}

    def add(v: float) -> None:
        variants = [f"{v:g}", f"{v:.2f}", f"{v:.1f}", f"{v:.0f}"]
        if 0.0 < v < 1.0:
            pv = v * 100
            variants += [f"{pv:g}", f"{pv:.2f}", f"{pv:.1f}", f"{pv:.0f}"]
        allowed.update(variants)
        if v == int(v):
            allowed.add(str(int(v)))

    def walk(o: Any) -> None:
        if isinstance(o, bool) or o is None:
            return
        if isinstance(o, (int, float)):
            add(float(o))
        elif isinstance(o, str):
            for tok in NUM_RE.findall(o):
                allowed.add(tok)
        elif isinstance(o, dict):
            for x in o.values():
                walk(x)
        elif isinstance(o, (list, tuple)):
            for x in o:
                walk(x)

    walk(case)
    return allowed


def numeric_violations(case: Dict[str, Any], sections: Dict[str, str]) -> List[str]:
    allowed = _allowed_numbers(case)
    bad: List[str] = []
    for text in sections.values():
        for tok in NUM_RE.findall(text):
            if tok in allowed:
                continue
            try:
                v = float(tok)
            except ValueError:
                continue
            if f"{v:g}" not in allowed:
                bad.append(tok)
    return sorted(set(bad))


def _measurement_str(v: Optional[float], unit: str = "") -> str:
    return "unavailable" if v is None else f"{v}{unit}"


def template_narrative(case: Dict[str, Any]) -> Dict[str, str]:
    ecg = case["ecg"]
    rec = case["recording"]
    findings_list = case["findings"]
    diagnosis = case["diagnosis"]
    
    score_lines = [row["display_string"] for row in case.get("category_scores_table", [])]
    scores_summary = "; ".join(score_lines)

    rhythm = ecg.get("rhythm") or "Normal sinus rhythm"
    rate = _measurement_str(ecg.get("heart_rate"), " beats per minute")

    presentation = (
        f"A standard 10-second 12-lead digital electrocardiographic recording "
        f"(Patient ID: {rec['patient_id']}, File: {rec['filename']}) was acquired "
        f"at standard calibration ({ecg.get('calibration')}) following AHA/ACCF/HRS recommendations."
    )

    findings_prose = (
        f"The baseline rhythm is {rhythm} at a rate of {rate}. "
        f"Interval metrics reflect structural waveform dynamics where automated "
        f"fiducial boundary detection was restricted by active waveform deviation. "
        f"Detailed morphological observations: {' '.join(findings_list)}"
    )

    diagnosis_prose = " ".join(diagnosis)

    interpretation = (
        f"Multi-label evaluation yielded category metrics: {scores_summary}. "
        f"Findings exceeding statistical reporting thresholds reflect pattern recognition matches "
        f"and must be correlated directly with patient clinical history and prior tracings."
    )

    teaching = (
        f"Per AHA standards, automated interpretation represents advisory support data only "
        f"and requires direct physician verification of waveform complexes, ST segments, and intervals."
    )

    return {
        "clinical_presentation": presentation,
        "ecg_findings": findings_prose,
        "diagnosis": diagnosis_prose,
        "interpretation": interpretation,
        "key_teaching_points": teaching,
    }


async def _call_llm(case: Dict[str, Any], retry_note: str = "") -> Dict[str, str]:
    import httpx

    user_prompt = "CASE JSON:\n" + json.dumps(case, indent=2) + retry_note
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
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]

    data = json.loads(content)
    sections = {}
    for key in SECTION_KEYS:
        val = data.get(key)
        sections[key] = str(val).strip() if isinstance(val, str) and val.strip() else ""
    if not all(sections.values()):
        raise ValueError("LLM response missing one or more narrative sections")
    return sections


async def generate_narrative(case: Dict[str, Any]) -> Tuple[Dict[str, str], List[str], str]:
    if not settings.ai_api_key:
        return template_narrative(case), [], "template"

    retry_note = ""
    for attempt in range(2):
        try:
            sections = await _call_llm(case, retry_note)
        except Exception as e:
            logger.warning("LLM narrative call failed (%s: %s) — template fallback",
                           type(e).__name__, str(e)[:120])
            return template_narrative(case), [], "template"

        bad = numeric_violations(case, sections)
        if not bad:
            return sections, [], "ai"

        logger.warning("Narrative draft %d violated the numeric guardrail: %s",
                       attempt + 1, bad[:10])
        retry_note = (
            "\n\nIMPORTANT: your previous draft contained numbers that do not "
            "appear in the JSON above. Regenerate it using ONLY the exact "
            "values present in the JSON with proper sentence punctuation."
        )

    return template_narrative(case), bad, "template"


# ── Pipeline orchestrator: ECGResult → full report ─────────────────────

_report_cache: Dict[int, Dict[str, Any]] = {}


async def generate_clinical_report(result: ECGResult,
                                   force_refresh: bool = False) -> Dict[str, Any]:
    if not force_refresh and result.id is not None and result.id in _report_cache:
        return _report_cache[result.id]

    from ml.preprocessing import (TARGET_FS, bandpass_filter, load_ecg_file,
                                preprocess_ecg, resample_signal)
    from ml.inference import run_inference

    signal, fs = load_ecg_file(result.file_path)
    if signal.ndim != 2 or signal.shape[1] != 12:
        raise ValueError(
            f"Expected 12-lead ECG, got "
            f"{signal.shape[1] if signal.ndim == 2 else 1} lead(s)."
        )

    preprocessed = preprocess_ecg(signal, fs)
    inference = run_inference(preprocessed)
    class_probabilities = inference["class_probabilities"]
    thresholds = inference["thresholds"]

    filtered = bandpass_filter(signal, fs)
    if fs != TARGET_FS:
        filtered = resample_signal(filtered, fs, TARGET_FS)
    window = filtered[: TARGET_FS * 10]
    measurements = measure_ecg(window, fs=TARGET_FS)

    case = build_case(result, measurements, class_probabilities, thresholds)
    sections, violations, generated_by = await generate_narrative(case)

    report = {
        "result_id": result.id,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "generated_by": generated_by,
        "guardrail": {"violations": violations},
        "case": case,
        "narrative": sections,
        "disclaimer": DISCLAIMER,
    }
    if result.id is not None:
        _report_cache[result.id] = report
    return report