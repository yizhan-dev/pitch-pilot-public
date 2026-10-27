"""The automatic checks between the Commentator and the Editor: what code can decide, so the Editor spends its
judgement on what it cannot.

Hard failures go back to the Commentator whatever the Editor says: a name that is not in the clip, a provider or
data word, a passage longer than its slot allows. Soft findings (a number the sheet does not obviously hold, a
judgement word, a long subtitle clause) go to the Editor to decide.
"""
import json
import re
from pathlib import Path

from pitch_agents.paths import REPO

WORDS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
         "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
         "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
         "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100, "half": 0.5}
HARD = [r"\bOpta\b", r"\bHawk-?Eye\b", r"\bStatsBomb\b", r"\btracking\b", r"\bprobes?\b", r"\balgorithm", r"\bfact sheet\b",
        r"\bthe model\b", r"\bdata\b", r"\bxG\b", r"…", r"\bxPass\b", r"\bdirector\b", r"\bperhaps\b"]
HEDGES = re.compile(r"\b(maybe|might|could|looks like|seems|probably|perhaps)\b", re.I)
SOFT = [r"\bbad\b", r"\bpoor\b", r"\bterrible\b", r"\bmistake\b", r"\bwrong\b", r"\bshould have\b", r"\bdeliberately\b",
        r"\bwanted to\b", r"\bawful\b", r"\bfail(ed|s)?\b"]
SENTENCE_START = re.compile(r"(^|[.!?:]\s+|\.\.\.\s*)$")
COMMON_CAPS = {"I", "Now", "And", "But", "So", "Then", "Look", "Watch", "Here", "There", "That", "This", "What", "From",
               "With", "Instead", "Still", "Back", "No", "Yes", "Maybe", "Perhaps", "Keep", "One", "Two", "Three",
               "Nobody", "Nearly", "Over", "Under", "Just", "If", "It", "He", "His", "They", "Their", "A", "An", "The",
               "VAR", "OK", "Do", "See", "Let", "Let's", "Not", "Only", "Even", "Again", "Right", "Left", "Into", "Out",
               "On", "In", "At", "As", "Who", "Why", "How", "When", "Where", "First", "Second", "Third", "Ten"}


def percents_in(text: str) -> list[float]:
    """the numbers said as percentages ("70%", "seventy percent")"""
    out = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)\s*(?:%|per ?cent)", text)]
    for m in re.finditer(r"\b(" + "|".join(WORDS) + r")(?:[- ](" + "|".join(WORDS) + r"))?\s+per ?cent", text.lower()):
        out.append(WORDS[m.group(1)] + WORDS.get(m.group(2) or "", 0))
    return out


def percent_grounded(n: float, vals: list[float]) -> bool:
    """a chance said as a percentage is the sheet's value rounded as the screen rounds it (0.0846 -> 8%), or to the
    nearest 5 or 10 when hedged (0.69 -> about 70%); never one off (0.0846 -> 9%)"""
    for v in vals:
        for p in ([v * 100] if 0 < v <= 1 else []) + ([v] if 1 < v <= 100 else []):
            if n in (round(p), round(p / 5) * 5, round(p / 10) * 10):
                return True
    return False


def numbers_in(text: str) -> list[float]:
    out = [float(x) for x in re.findall(r"(?<![\w.])\d+(?:\.\d+)?", text)]
    for m in re.finditer(r"\b(" + "|".join(WORDS) + r")(?:[- ](" + "|".join(WORDS) + r"))?\b", text.lower()):
        a = WORDS[m.group(1)]; b = WORDS.get(m.group(2) or "", 0)
        if m.group(1) == "half" and not re.search(r"\bhalf (a|of)\b", text.lower()):
            continue                                   # "the half-space", "the first half"
        out.append(a * 100 if b == 100 else a + b)
    return out


def sheet_numbers(sheet: dict) -> list[float]:
    vals = []

    def walk(o):
        if isinstance(o, bool):
            return
        if isinstance(o, (int, float)):
            vals.append(float(o))
        elif isinstance(o, str):
            vals.extend(float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", o))
        elif isinstance(o, dict):
            for k, v in o.items():
                if k not in ("budget", "clip_window", "anchor"):
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk({k: v for k, v in sheet.items() if k != "people"})
    vals += [len(sheet.get("events", []))]
    return vals


def grounded(n: float, vals: list[float]) -> bool:
    for v in vals:
        v = abs(v)
        cands = [v] + ([v * 100] if 0 < v <= 1 else [])
        for c in cands:
            if n <= 12 and float(n).is_integer():
                if round(c) == n or int(c) == n:
                    return True
            elif abs(n - c) <= max(1.0, 0.1 * c):
                return True
    return False


def names_known(sheet: dict) -> set[str]:
    parts = {sheet["teams"]["home"], sheet["teams"]["away"], sheet["teams"]["home"].rstrip("s"),
             sheet["teams"]["away"].rstrip("s")}
    for p in sheet["people"]:
        parts.update(p["name"].split())
    return parts


def real_names() -> list[str]:
    """the real clubs' names the release scrubs (checked locally, never sent anywhere)"""
    f = REPO / "web" / "scripts" / "release-scrub.json"
    if not f.exists():
        return []
    s = json.loads(f.read_text())
    return [a for a, _ in [*s.get("names", []), *s.get("dataOnly", [])] if a and a.isascii() and len(a) > 3]


def check(sheet: dict, draft: list[dict], meter) -> dict:
    """{id: {seconds, measured, hard: [...], soft: [...]}} for every passage of the draft"""
    vals, known, real = sheet_numbers(sheet), names_known(sheet), real_names()
    slots = {s["id"]: s for s in sheet["slots"]}
    out, seen = {}, {}
    for p in draft:
        sid, text = p["id"], p.get("text", "")
        hard, soft = [], []
        if sid not in slots:
            hard.append("no such slot")
            out[sid] = {"hard": hard, "soft": soft}; continue
        if not text.strip():
            hard.append("empty passage")
        b = slots[sid]["budget"]
        secs, how = meter.seconds(text, p.get("energy", "calm")) if text.strip() else (0.0, "none")
        words = len(re.findall(r"[\w%'-]+", text))
        if secs > b["max_s"] * 1.05:
            cut = max(1, words - int(words * b["max_s"] / max(secs, 0.1)))
            hard.append(f"too long: {secs:.1f} s spoken, the slot allows {b['max_s']} s: cut about {cut} of its {words} "
                        f"words (aim {b.get('target_words', '?')}, at most {b.get('max_words', '?')})")
        elif secs < b["target_s"] * 0.5 and b["target_s"] >= 2.5:
            soft.append(f"short: {secs:.1f} s spoken against a target of {b['target_s']} s")
        for pat in HARD:
            if re.search(pat, text, re.I if pat[0] != "…" else 0):
                hard.append(f"forbidden word: {re.search(pat, text, re.I).group(0)}")
        for name in real:
            if re.search(rf"\b{re.escape(name)}\b", text, re.I):
                hard.append("a real club's name")
        for pat in SOFT:
            m = re.search(pat, text, re.I)
            if m:
                soft.append(f"judgement word: '{m.group(0)}' (fine only if it is not a verdict on a person)")
        for m in re.finditer(r"\b[A-Z][a-z]+(?:'s)?\b", text):
            w = m.group(0).removesuffix("'s")
            if w in known or w in COMMON_CAPS:
                continue
            if SENTENCE_START.search(text[: m.start()]):
                continue
            hard.append(f"unknown name: {w}")
        pct = percents_in(text)
        for n in pct:
            if not percent_grounded(n, vals):
                hard.append(f"{n:g}% is not a chance in the fact sheet rounded as the screen shows it (round to the "
                            f"nearest whole percent, or to 5 or 10 with 'about')")
        for n in numbers_in(text):
            if n not in pct and not grounded(n, vals):
                soft.append(f"number {n:g} not found in the fact sheet")
        for clause in re.split(r"[,.!?:;]|\.\.\.", text):
            if len(clause.strip()) > 70:
                hard.append(f"subtitle clause of {len(clause.strip())} characters (at most 70 between punctuation): "
                            "split the sentence or add a comma where a speaker breathes")
            elif len(clause.strip()) > 60:
                soft.append(f"long subtitle clause ({len(clause.strip())} characters)")
        for phrase in re.findall(r"\b\w+ \w+ \w+ \w+\b", text.lower()):
            if phrase in seen and seen[phrase] != sid:
                soft.append(f"repeats '{phrase}' from {seen[phrase]}")
                break
        for phrase in re.findall(r"\b\w+ \w+ \w+ \w+\b", text.lower()):
            seen.setdefault(phrase, sid)
        out[sid] = {"seconds": secs, "words": words, "measured": how, "budget": b, "hard": sorted(set(hard)), "soft": soft}
    hedged = [p["id"] for p in draft if HEDGES.search(p.get("text", ""))]     # the clip's guesses, in order
    for sid in hedged[2:]:
        if sid in out:
            out[sid]["soft"].append(f"the clip already guesses in {', '.join(hedged[:2])}: at most two guesses a clip "
                                    "(one intention, one better option); say this one plainly or cut the guess")
    for sid in slots:
        if sid not in out:
            out[sid] = {"hard": ["missing passage"], "soft": []}
    return out
