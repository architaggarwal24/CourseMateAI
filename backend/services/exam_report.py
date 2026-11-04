"""The downloadable PDF score report of a graded exam (reportlab, A4).

Calm and readable, like the Study screens: the score, accuracy and time; a per-concept table with a bar for
each concept (weakest first); the per-difficulty split; then every missed question with the right answer and why.
"""
import io
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
LINE = colors.HexColor("#e2e8f0")
ACCENT = colors.HexColor("#4f46e5")
GOOD = colors.HexColor("#16a34a")
WARN = colors.HexColor("#d97706")
BAD = colors.HexColor("#dc2626")
PANEL = colors.HexColor("#f8fafc")

_base = dict(fontName="Helvetica", textColor=INK, alignment=TA_LEFT)
H1 = ParagraphStyle("h1", **{**_base, "fontName": "Helvetica-Bold"}, fontSize=20, leading=24, spaceAfter=2)
SUB = ParagraphStyle("sub", **{**_base, "textColor": MUTED}, fontSize=10, leading=14)
H2 = ParagraphStyle("h2", **{**_base, "fontName": "Helvetica-Bold"}, fontSize=12.5, leading=16, spaceBefore=10, spaceAfter=6)
BODY = ParagraphStyle("body", **_base, fontSize=9.5, leading=13)
SMALL = ParagraphStyle("small", **{**_base, "textColor": MUTED}, fontSize=8.5, leading=11)
BIG = ParagraphStyle("big", **{**_base, "fontName": "Helvetica-Bold"}, fontSize=26, leading=30)


def _tone(acc: float):
    return GOOD if acc >= 0.8 else WARN if acc >= 0.6 else BAD


def _p(text, style=BODY) -> Paragraph:
    return Paragraph(escape(str(text if text is not None else "")), style)


class Bar(Flowable):
    """A filled share bar (accuracy), coloured by how good it is."""
    def __init__(self, share: float, width: float = 46 * mm, height: float = 3.2 * mm):
        super().__init__()
        self.share, self.width, self.height = max(0.0, min(1.0, share)), width, height

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(LINE)
        c.roundRect(0, 0, self.width, self.height, 1.5, stroke=0, fill=1)
        if self.share > 0:
            c.setFillColor(_tone(self.share))
            c.roundRect(0, 0, max(self.height, self.width * self.share), self.height, 1.5, stroke=0, fill=1)


def _mmss(seconds) -> str:
    s = int(seconds or 0)
    return f"{s // 60}:{s % 60:02d}"


def _date(iso) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%d %b %Y, %H:%M UTC")
    except (TypeError, ValueError):
        return ""


def render_exam_report(exam: dict, student: str = "") -> bytes:
    """PDF bytes for a graded exam (the dict ExamService.get() returns)."""
    r = exam["result"]
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm,
                            bottomMargin=16 * mm, title=f"Exam report - {exam['doc_name']}", author="CourseMateAI")
    acc = float(r["accuracy"] or 0)
    story = [
        _p("Exam score report", H1),
        _p(f"{exam['doc_name']}  ·  {exam['difficulty'].title()}  ·  {exam['total']} questions"
           + (f"  ·  {student}" if student else "") + f"  ·  {_date(r.get('submitted_at'))}", SUB),
        Spacer(1, 8 * mm),
    ]
    tiles = Table([[
        [_p("Score", SMALL), Paragraph(f'<font color="{_tone(acc).hexval()}">{r["score"]}</font>'
                                        f'<font size="13" color="#64748b"> / {r["total"]}</font>', BIG)],
        [_p("Accuracy", SMALL), _p(f"{round(acc * 100)}%", BIG)],
        [_p("Time used", SMALL), Paragraph(f'{_mmss(r["time_used_s"])}'
                                            f'<font size="13" color="#64748b"> / {_mmss(exam["time_limit_s"])}</font>', BIG)],
    ]], colWidths=[58 * mm] * 3)
    tiles.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEAFTER", (0, 0), (1, 0), 0.6, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(tiles)
    notes = []
    if r.get("unanswered"):
        notes.append(f"{r['unanswered']} question(s) left unanswered.")
    if r.get("auto_submitted"):
        notes.append("Submitted automatically when the time ran out.")
    if notes:
        story += [Spacer(1, 3 * mm), _p(" ".join(notes), SMALL)]

    # per concept
    story.append(_p("By concept (weakest first)", H2))
    rows = [[_p("Concept", SMALL), _p("Right", SMALL), _p("Accuracy", SMALL), ""]]
    for c in r.get("concepts", []):
        rows.append([_p(c["concept"]), _p(f"{c['correct']} / {c['total']}"), _p(f"{round(c['accuracy'] * 100)}%"), Bar(c["accuracy"])])
    t = Table(rows, colWidths=[78 * mm, 22 * mm, 22 * mm, 52 * mm], repeatRows=1)
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story.append(t)

    story.append(_p("By difficulty", H2))
    rows = [[_p("Level", SMALL), _p("Right", SMALL), _p("Accuracy", SMALL), ""]]
    for d in r.get("difficulties", []):
        rows.append([_p(d["difficulty"].title()), _p(f"{d['correct']} / {d['total']}"),
                     _p(f"{round(d['accuracy'] * 100)}%"), Bar(d["accuracy"])])
    t = Table(rows, colWidths=[78 * mm, 22 * mm, 22 * mm, 52 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story.append(t)

    if r.get("weak_concepts"):
        story += [Spacer(1, 4 * mm),
                  _p("Study next: " + ", ".join(r["weak_concepts"]) + ". The missed questions are in your review queue.", BODY)]

    missed = [q for q in exam["questions"] if not q.get("correct")]
    story.append(_p(f"Questions to review ({len(missed)})" if missed else "Every question right. Well done.", H2))
    for q in missed:
        block = [
            _p(f"{q['index'] + 1}. {q['question']}", ParagraphStyle("q", parent=BODY, fontName="Helvetica-Bold")),
            _p(f"Your answer: {q['answer'] if q['answer'] is not None else '(no answer)'}", SMALL),
            Paragraph(f'<font color="#16a34a">Correct answer:</font> {escape(str(q["correct_answer"]))}', BODY),
        ]
        if q.get("explanation"):
            block.append(_p(q["explanation"], SMALL))
        block.append(_p(f"Concept: {q.get('concept', '')}  ·  {str(q.get('difficulty', '')).title()}", SMALL))
        block.append(Spacer(1, 4 * mm))
        story.append(KeepTogether(block))

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 9 * mm, "CourseMateAI · exam score report")
        canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
