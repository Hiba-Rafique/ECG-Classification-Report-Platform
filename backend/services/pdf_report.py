"""
PDF Generation Service — renders the structured clinical ECG report 
into a one-page A4 PDF matching AHA/ACCF/HRS guidelines using fpdf2 
with structured category scores and explicit reporting thresholds.
"""

from typing import Any, Dict

from fpdf import FPDF

from ml.inference import SUPERCLASSES, SUPERCLASS_READABLE

# Narrative section order (matches SECTION_KEYS in clinical_report.py)
SECTION_ORDER = (
    ("clinical_presentation", "Clinical Presentation"),
    ("ecg_findings", "ECG Findings"),
    ("diagnosis", "Diagnosis"),
    ("interpretation", "Interpretation"),
    ("key_teaching_points", "Key Teaching Points"),
)

# Common Unicode punctuation -> latin-1 equivalents
_TRANSLATIONS = str.maketrans({
    "\u2018": "'", "\u2019": "'",            # curly single quotes
    "\u201c": '"', "\u201d": '"',            # curly double quotes
    "\u2013": "-", "\u2014": "-",            # en/em dash
    "\u2026": "...",                         # ellipsis
    "\u00d7": "x", "\u2212": "-", "\u00b5": "u",
    "\u2022": "-",                           # bullet
    "\u00a0": " ",                           # non-breaking space
})

COLOR_PRIMARY = (30, 58, 138)      # Deep Navy
COLOR_TEXT = (15, 23, 42)          # Dark Slate
COLOR_MUTED = (100, 116, 139)      # Muted Slate
COLOR_BG_LIGHT = (248, 250, 252)   # Very light slate background
COLOR_BORDER = (203, 213, 225)     # Soft border gray
def _lat(s: Any) -> str:
    return str(s).translate(_TRANSLATIONS).encode("latin-1", "replace").decode("latin-1")


def _trunc(s: Any, n: int) -> str:
    s = str(s)
    return s if len(s) <= n else s[: n - 3] + "..."


def _val(v: Any, unit: str = "") -> str:
    return "unavailable" if v is None else f"{v}{unit}"


def build_pdf_bytes(report: Dict[str, Any]) -> bytes:
    case = report["case"]
    ecg = case["ecg"]
    rec = case["recording"]
    narrative = report.get("narrative", {})
    probs = case.get("class_probabilities", {})
    thresholds = case.get("thresholds", {})

    pdf = FPDF()
    pdf.set_auto_page_break(True, margin=12)
    pdf.add_page()

    # ── Header ────────────────────────────────────────────────────
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 6, "Clinical Electrocardiographic Report", new_x="LMARGIN", new_y="NEXT", align="C")
    
    pdf.set_text_color(*COLOR_MUTED)
    pdf.set_font("Helvetica", "I", 7.5)
    gen_at = str(report.get("generated_at", ""))[:16].replace("T", " ")
    subtitle = "AHA/ACCF/HRS Standardized Structured Analysis"
    if gen_at:
        subtitle = f"Generated {gen_at} — " + subtitle
    pdf.cell(0, 4, _lat(subtitle), new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(2)

    # ── Patient & measurements table ──────────────────────────────
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "Patient & Measurements", new_x="LMARGIN", new_y="NEXT")
    
    pdf.set_text_color(*COLOR_TEXT)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_fill_color(*COLOR_BG_LIGHT)
    pdf.set_draw_color(*COLOR_BORDER)

    rows = [
        ("Case ID", _trunc(case.get("case_id", ""), 30)),
        ("Patient", _trunc(rec.get("patient_id") or "unknown", 30)),
        ("Recording", "10-second 12-lead ECG"),
        ("File", _trunc(rec.get("filename") or "-", 30)),
        ("Rhythm", ecg.get("rhythm") or "not determinable"),
        ("Heart rate", _val(ecg.get("heart_rate"), " bpm")),
        ("PR interval", _val(ecg.get("pr"), " ms")),
        ("QRS duration", _val(ecg.get("qrs"), " ms")),
        ("QT / QTc", f"{_val(ecg.get('qt'), ' ms')} / {_val(ecg.get('qtc'), ' ms')}"),
        ("QRS axis", ecg.get("qrs_axis") or "unavailable"),
        ("P / T axis", f"{ecg.get('p_axis') or 'unavailable'} / "
                       f"{ecg.get('t_axis') or 'unavailable'}"),
    ]
    colw = (pdf.w - 2 * pdf.l_margin) / 2
    for i in range(0, len(rows), 2):
        for label, val in rows[i: i + 2]:
            pdf.cell(colw, 4.6, _lat(f"{label}: {val}"), border=1, fill=True)
        pdf.ln()
    pdf.ln(1)

    # ── Findings ──────────────────────────────────────────────────
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "Findings", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(*COLOR_TEXT)
    pdf.set_font("Helvetica", "", 8)
    for fnd in case.get("findings", []):
        pdf.multi_cell(0, 4, _lat("- " + fnd), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    # ── Diagnosis ─────────────────────────────────────────────────
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "Diagnosis", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(*COLOR_TEXT)
    pdf.set_font("Helvetica", "", 8)
    if case.get("diagnosis"):
        for d in case["diagnosis"]:
            pdf.multi_cell(0, 4, _lat("- " + d), new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.multi_cell(0, 4, "- No abnormalities detected by analysis thresholds",
                       new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    # ── Diagnostic category scores table ──────────────────────────
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "Diagnostic Category Scores", new_x="LMARGIN", new_y="NEXT")
    
    col_widths = [54, 28, (pdf.w - 2 * pdf.l_margin - 82)]
    
    pdf.set_fill_color(*COLOR_PRIMARY)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(col_widths[0], 5, "Diagnostic Category", border=1, fill=True, align="C")
    pdf.cell(col_widths[1], 5, "Score", border=1, fill=True, align="C")
    pdf.cell(col_widths[2], 5, "Status", border=1, fill=True, align="C")
    pdf.ln()

    pdf.set_text_color(*COLOR_TEXT)
    pdf.set_font("Helvetica", "", 8)
    for idx, s in enumerate(SUPERCLASSES):
        p = float(probs.get(s, 0.0))
        t = float(thresholds.get(s, 0.5))
        pct = p * 100
        thresh_pct = t * 100
        relation = ">=" if p >= t else "<"
        
        category_name = SUPERCLASS_READABLE.get(s, s)
        score_str = f"{pct:.1f}%"
        status_str = f"{relation} {thresh_pct:.0f}%"

        # Alternate row background tint
        fill_row = (idx % 2 == 0)
        pdf.set_fill_color(241, 245, 249) if fill_row else pdf.set_fill_color(255, 255, 255)

        pdf.cell(col_widths[0], 4.6, _lat(category_name), border=1, fill=True)
        pdf.cell(col_widths[1], 4.6, _lat(score_str), border=1, fill=True, align="R")
        pdf.cell(col_widths[2], 4.6, _lat(status_str), border=1, fill=True)
        pdf.ln()
    pdf.ln(1)

    # ── Narrative sections ────────────────────────────────────────
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "Interpretive Report", new_x="LMARGIN", new_y="NEXT")
    for key, title in SECTION_ORDER:
        text = (narrative.get(key) or "").strip()
        if not text:
            continue
        pdf.set_text_color(*COLOR_PRIMARY)
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.multi_cell(0, 3.6, _lat(title), new_x="LMARGIN", new_y="NEXT")
        
        pdf.set_text_color(*COLOR_TEXT)
        pdf.set_font("Helvetica", "", 7.5)
        pdf.multi_cell(0, 3.6, _lat(text), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

    # ── Footer ────────────────────────────────────────────────────
    pdf.set_text_color(*COLOR_MUTED)
    pdf.set_font("Helvetica", "I", 6)
    pdf.multi_cell(0, 3, _lat(
        "Source attribution: analysis categories trained and validated on PTB-XL, "
        "PhysioNet (Wagner et al., Scientific Data, 2020). "
        "Narrative text is generated strictly from the structured analysis object; "
        "numbers absent from that object are rejected by a validation layer. "
        "Decision support only - not a diagnosis. The treating physician is "
        "responsible for all clinical interpretation."),
        new_x="LMARGIN", new_y="NEXT")

    data = pdf.output()
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    return str(data).encode("latin-1", "replace")


def generate_ecg_pdf(report: Dict[str, Any], output_path: str) -> str:
    """Wrapper function to write bytes output directly to file path."""
    pdf_bytes = build_pdf_bytes(report)
    with open(output_path, "wb") as f:
        f.write(pdf_bytes)
    return output_path