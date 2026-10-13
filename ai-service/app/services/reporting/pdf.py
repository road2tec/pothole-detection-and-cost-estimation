"""Maintenance report PDF rendering (ReportLab).

The Express server computes every figure (from MongoDB, with the stored cost configuration)
and sends it here; this module only lays the data out. It never recalculates or invents values.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from app.core.security import resolve_storage_path

GRAPHITE = colors.HexColor("#1f2937")
SLATE = colors.HexColor("#64748b")
AMBER = colors.HexColor("#d97706")
LIGHT = colors.HexColor("#f1f5f9")
RULE = colors.HexColor("#cbd5e1")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], textColor=GRAPHITE, fontSize=18, spaceAfter=4)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], textColor=GRAPHITE, fontSize=12.5, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=8.5, leading=11, alignment=TA_LEFT)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=7.5, leading=9.5, textColor=SLATE)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=7.5, leading=9)


def _inr(v: Any) -> str:
    if v is None:
        return "—"
    return "Rs. " + f"{float(v):,.2f}"


def _num(v: Any, digits: int = 3, unit: str = "") -> str:
    if v is None:
        return "—"
    return f"{float(v):.{digits}f}{unit}"


def _table(rows: list[list[Any]], widths: list[float], header: bool = True) -> Table:
    data = [[c if isinstance(c, (Paragraph, Image)) else Paragraph(str(c), CELL) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), GRAPHITE), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        for i in range(len(rows[0])):
            if isinstance(data[0][i], Paragraph):
                data[0][i] = Paragraph(f"<font color='white'><b>{rows[0][i]}</b></font>", CELL)
    t.setStyle(TableStyle(style))
    return t


def _image(rel: str | None, max_w: float, max_h: float) -> Image | Paragraph:
    if not rel:
        return Paragraph("No image", SMALL)
    try:
        path = resolve_storage_path(rel, must_exist=True)
        img = Image(str(path))
        ratio = min(max_w / img.imageWidth, max_h / img.imageHeight)
        img.drawWidth, img.drawHeight = img.imageWidth * ratio, img.imageHeight * ratio
        return img
    except Exception:  # noqa: BLE001 — a missing image must not abort the whole report
        return Paragraph("Image unavailable", SMALL)


def _footer(canvas, doc) -> None:  # noqa: ANN001
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(SLATE)
    canvas.drawString(12 * mm, 8 * mm, doc.title)
    canvas.drawRightString(doc.pagesize[0] - 12 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


def render_report(payload: dict[str, Any], output_rel: str) -> dict[str, Any]:
    out = resolve_storage_path(output_rel)
    out.parent.mkdir(parents=True, exist_ok=True)
    title = payload.get("title") or "Pothole Maintenance Report"
    doc = SimpleDocTemplate(str(out), pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=12 * mm, bottomMargin=14 * mm, title=title)
    width = doc.width
    story: list[Any] = []

    story.append(Paragraph(title, H1))
    meta = payload.get("meta", {})
    story.append(Paragraph(
        f"Generated {meta.get('generatedAt', datetime.now().isoformat(timespec='minutes'))} by "
        f"{meta.get('generatedBy', '—')} · Date range: {meta.get('dateRange', 'All dates')} · "
        f"Road: {meta.get('road', 'All')} · Locality: {meta.get('locality', 'All')} · Ward: {meta.get('ward', 'All')}",
        SMALL))
    if meta.get("includesDemo"):
        story.append(Paragraph("<b>This report includes clearly labelled DEMO records that were not detected by AI.</b>", BODY))
    story.append(Spacer(1, 6))

    totals = payload.get("totals", {})
    story.append(Paragraph("Summary", H2))
    story.append(_table([
        ["Unique potholes", "Measured (volume known)", "Not calibrated / incomplete", "Verified", "Repaired",
         "Estimated budget", "Material", "Labour", "Mobilisation"],
        [totals.get("potholes", 0), totals.get("measured", 0), totals.get("unmeasured", 0), totals.get("verified", 0),
         totals.get("repaired", 0), _inr(totals.get("estimatedBudget")), _inr(totals.get("materialCost")),
         _inr(totals.get("labourCost")), _inr(totals.get("mobilisationCost"))],
    ], [width / 9] * 9))
    story.append(Paragraph(totals.get("mobilisationNote", ""), SMALL))

    sev = payload.get("severity", [])
    if sev:
        story.append(Paragraph("Severity-wise counts", H2))
        rows = [["Severity", "Potholes", "Estimated variable cost (material + labour)"]]
        rows += [[s["severity"], s["count"], _inr(s.get("variableCost"))] for s in sev]
        story.append(_table(rows, [width * 0.25, width * 0.2, width * 0.35]))

    areas = payload.get("areas", [])
    if areas:
        story.append(Paragraph("Area-wise summary", H2))
        rows = [["Ward", "Locality", "Road", "Potholes", "Severe", "Estimated budget"]]
        rows += [[a.get("ward") or "—", a.get("locality") or "—", a.get("road") or "—", a["count"], a.get("severe", 0),
                  _inr(a.get("estimatedBudget"))] for a in areas]
        story.append(_table(rows, [width * 0.13, width * 0.22, width * 0.27, width * 0.1, width * 0.1, width * 0.18]))

    cfg = payload.get("costConfig") or {}
    story.append(Paragraph("Cost configuration used", H2))
    story.append(Paragraph(
        f"Version {cfg.get('version', '—')} · Material {_inr(cfg.get('materialPerM3'))}/m³ · Labour "
        f"{_inr(cfg.get('labourPerM3'))}/m³ · Mobilisation {_inr(cfg.get('mobilisationPerVisit'))}/visit · "
        f"Minor &lt; {cfg.get('minorMaxM3', '—')} m³ · Severe ≥ {cfg.get('severeMinM3', '—')} m³"
        + (" · <b>Prototype placeholder rates — replace with the authorised Schedule of Rates.</b>"
           if cfg.get("isPrototypeDefault") else ""), BODY))
    story.append(Paragraph(f"Model version(s): {', '.join(payload.get('modelVersions', [])) or '—'} · "
                           f"Formula: V = (π/4)·L·W·D; C = V·(Cmat + Clab) + Cmob per repair visit.", SMALL))
    for note in payload.get("notes", []):
        story.append(Paragraph(f"• {note}", SMALL))

    potholes = payload.get("potholes", [])
    if potholes:
        story.append(PageBreak())
        story.append(Paragraph(f"Pothole register ({len(potholes)})", H2))
        img_w, img_h = 42 * mm, 30 * mm
        for p in potholes:
            details = [
                f"<b>{p.get('code', '—')}</b> · {p.get('roadName') or 'Road not set'} · {p.get('locality') or '—'} · "
                f"Ward {p.get('ward') or '—'}",
                f"Detected {p.get('detectedAt', '—')} · Confidence {_num(p.get('confidence'), 2)} · "
                f"Model {p.get('modelVersion', '—')}",
                f"L {_num(p.get('lengthM'), 3, ' m')} · W {_num(p.get('widthM'), 3, ' m')} · D {_num(p.get('depthM'), 3, ' m')}"
                f" · V {_num(p.get('volumeM3'), 4, ' m³')}",
                f"Dimension source: {p.get('dimensionSource') or '—'} · Depth source: {p.get('depthSource') or '—'} · "
                f"Measurement: {p.get('measurementStatus', '—')}",
                f"Severity: <b>{p.get('severity') or 'Not classified'}</b>"
                + (f" (calculated {p.get('calculatedSeverity')}, verified {p.get('verifiedSeverity')})"
                   if p.get('verifiedSeverity') and p.get('verifiedSeverity') != p.get('calculatedSeverity') else ""),
                f"Material {_inr(p.get('materialCost'))} · Labour {_inr(p.get('labourCost'))} · "
                f"Single-visit total {_inr(p.get('singleVisitTotal'))}",
                f"Verification: {p.get('verificationStatus', '—')} · Repair status: {p.get('repairStatus', '—')}"
                + (f" · Location {p['lat']:.5f}, {p['lon']:.5f} ({p.get('locationSource')})" if p.get('lat') is not None else
                   " · No GPS location"),
            ]
            for n in p.get("notes", []):
                details.append(f"<font color='#b45309'>Note: {n}</font>")
            block = Table(
                [[_image(p.get("annotatedPath"), img_w, img_h), _image(p.get("cropPath"), img_w, img_h),
                  [Paragraph(d, CELL) for d in details]]],
                colWidths=[img_w + 4, img_w + 4, width - 2 * img_w - 8],
            )
            block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
            story.append(KeepTogether(block))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return {"path": output_rel, "sizeBytes": out.stat().st_size, "pages": doc.page}
