"""The commentary of one clip as a Microsoft Agent Framework workflow.

    analyst -> commentator -> voice check -> editor --(sent back)--> commentator
                                                    \\--(approved, or out of rounds)--> publisher

Shared state (the workflow's own `State`, visible to every executor):
  sheet    the clip's fact sheet (factsheet.py), the only facts any agent sees
  series   the other clips' openers and closers, so the four clips never sound like one template
  plan     the Analyst's talking points per slot
  drafts   the Commentator's passages, one entry per round
  checks   the voice check's measured spoken lengths and automatic findings, per round
  reviews  the Editor's verdicts, per round
The publisher writes the passages (anchors from the director's slots, words from the agents) and the whole trace.

Recovery: every agent call retries on service errors and resends an invalid answer with the parser's error (team.py);
a passage that fails a hard check goes back even if the Editor passed it; after the last round, each passage is
the version with the fewest hard failures, and anything unresolved is listed in the trace for a person to look at.
"""
import time
from dataclasses import dataclass, field

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler
from typing_extensions import Never

from pitch_agents import checks


@dataclass
class Job:
    clip: str


@dataclass
class Write:
    round: int
    back: list[str] = field(default_factory=list)       # the passages to rewrite; empty on the first round


@dataclass
class Measure:
    round: int


@dataclass
class Edit:
    round: int


@dataclass
class Publish:
    round: int
    reason: str


def _log(ctx, event: str, **kw):
    trace = ctx.get_state("events", [])
    trace.append({"t": round(time.time(), 2), "event": event, **kw})
    ctx.set_state("events", trace)


class Analyst(Executor):
    def __init__(self, team):
        super().__init__(id="analyst")
        self.team = team

    @handler
    async def plan(self, job: Job, ctx: WorkflowContext[Write]) -> None:
        sheet, series = ctx.get_state("sheet"), ctx.get_state("series")
        plan = await self.team.ask("analyst", {"task": "Plan the commentary of this clip.", "series": series,
                                               "fact_sheet": sheet}, tag="plan")
        ctx.set_state("plan", plan.model_dump())
        _log(ctx, "planned", story=plan.story, opener=plan.opener)
        await ctx.send_message(Write(round=1))


class Commentator(Executor):
    def __init__(self, team):
        super().__init__(id="commentator")
        self.team = team

    @handler
    async def write(self, msg: Write, ctx: WorkflowContext[Measure]) -> None:
        sheet, plan, drafts = ctx.get_state("sheet"), ctx.get_state("plan"), ctx.get_state("drafts", [])
        payload = {"task": "Write the passages." if msg.round == 1 else
                   f"Revise the passages listed in `rewrite`; return every other passage word for word.",
                   "series": ctx.get_state("series"), "fact_sheet": sheet, "plan": plan}
        prev = {}
        if msg.round > 1:
            prev = {p["id"]: p for p in drafts[-1]}
            payload.update(previous_draft=drafts[-1], rewrite=msg.back,
                           checks={k: v for k, v in ctx.get_state("checks")[-1].items() if k in msg.back},
                           editor=[v for v in ctx.get_state("reviews")[-1]["verdicts"] if v["id"] in msg.back])
            notes = ctx.get_state("reviewer_notes", {})
            if notes:
                payload["reviewer_notes"] = {k: v for k, v in notes.items() if k in msg.back}
        draft = await self.team.ask("commentator", payload, tag=f"round {msg.round}")
        got = {p.id: p.model_dump() for p in draft.passages}
        out = []
        for s in sheet["slots"]:
            if s["id"] in prev and s["id"] not in msg.back:
                out.append(prev[s["id"]])                      # passed passages stay as they were
            else:
                out.append(got.get(s["id"]) or prev.get(s["id"]) or {"id": s["id"], "text": "", "energy": "calm"})
        ctx.set_state("drafts", drafts + [out])
        _log(ctx, "drafted", round=msg.round, rewritten=msg.back or [s["id"] for s in sheet["slots"]])
        await ctx.send_message(Measure(round=msg.round))


class VoiceCheck(Executor):
    """not an agent: the spoken length of every passage, measured with the real voice, and the automatic checks"""

    def __init__(self, meter):
        super().__init__(id="voice_check")
        self.meter = meter

    @handler
    async def measure(self, msg: Measure, ctx: WorkflowContext[Edit]) -> None:
        res = checks.check(ctx.get_state("sheet"), ctx.get_state("drafts")[-1], self.meter)
        ctx.set_state("checks", ctx.get_state("checks", []) + [res])
        hard = {k: v["hard"] for k, v in res.items() if v["hard"]}
        _log(ctx, "checked", round=msg.round, hard=hard, measured=sorted({v.get("measured") for v in res.values()} - {None}))
        await ctx.send_message(Edit(round=msg.round))


class Editor(Executor):
    def __init__(self, team, rounds: int):
        super().__init__(id="editor")
        self.team, self.rounds = team, rounds

    @handler
    async def review(self, msg: Edit, ctx: WorkflowContext[Write | Publish]) -> None:
        sheet, draft, chk = ctx.get_state("sheet"), ctx.get_state("drafts")[-1], ctx.get_state("checks")[-1]
        payload = {"task": "Review this draft.", "series": ctx.get_state("series"), "fact_sheet": sheet,
                   "plan": ctx.get_state("plan"), "draft": draft, "checks": chk}
        notes = ctx.get_state("reviewer_notes", {})
        if notes:
            payload["task"] = ("Review this draft. A person reviewed the published commentary: `reviewer_notes` lists "
                               "their notes; pass a noted passage only if the note is fully addressed.")
            payload["reviewer_notes"] = notes
        rev = await self.team.ask("editor", payload, tag=f"round {msg.round}")
        verdicts = {v.id: v.model_dump() for v in rev.verdicts}
        for sid, c in chk.items():                              # a hard failure goes back whatever the Editor said
            if c["hard"]:
                v = verdicts.setdefault(sid, {"id": sid, "ok": False, "problems": [], "fix": ""})
                v["ok"] = False
                v["problems"] = list(dict.fromkeys(v["problems"] + c["hard"]))
                v["fix"] = v["fix"] or "; ".join(c["hard"])
        for s in sheet["slots"]:
            verdicts.setdefault(s["id"], {"id": s["id"], "ok": True, "problems": [], "fix": ""})
        if notes:                                               # a revision rewrites only what the person noted
            for sid, v in verdicts.items():
                if sid not in notes and not v["ok"]:
                    v.update(ok=True, problems=[], fix="", note="not in the person's notes: left as published")
        ctx.set_state("reviews", ctx.get_state("reviews", []) + [{"overall": rev.overall, "verdicts": list(verdicts.values())}])
        back = [s["id"] for s in sheet["slots"] if not verdicts[s["id"]]["ok"]]
        _log(ctx, "reviewed", round=msg.round, sent_back=back, overall=rev.overall)
        if not back:
            await ctx.send_message(Publish(round=msg.round, reason="approved"))
        elif msg.round >= self.rounds:
            await ctx.send_message(Publish(round=msg.round, reason=f"out of rounds; {len(back)} passage(s) unresolved"))
        else:
            await ctx.send_message(Write(round=msg.round + 1, back=back))


class Publisher(Executor):
    def __init__(self):
        super().__init__(id="publisher")

    @handler
    async def publish(self, msg: Publish, ctx: WorkflowContext[Never, dict]) -> None:
        sheet, drafts, chks, revs = (ctx.get_state(k) for k in ("sheet", "drafts", "checks", "reviews"))
        final, unresolved = [], []
        for s in sheet["slots"]:
            sid = s["id"]
            ok_rounds = [i for i, r in enumerate(revs) if any(v["id"] == sid and v["ok"] for v in r["verdicts"])]
            if ok_rounds:
                i = ok_rounds[-1]
            else:                                               # the version with the fewest hard failures
                i = min(range(len(drafts)), key=lambda i: (len(chks[i][sid]["hard"]), -i))
                unresolved.append({"id": sid, "round": i + 1, "problems": next(v["problems"] for v in revs[-1]["verdicts"] if v["id"] == sid)})
            p = next(x for x in drafts[i] if x["id"] == sid)
            final.append({**p, "round": i + 1, "seconds": chks[i][sid].get("seconds"), "measured": chks[i][sid].get("measured")})
        _log(ctx, "published", reason=msg.reason, unresolved=[u["id"] for u in unresolved])
        await ctx.yield_output({"clip": sheet["clip"], "reason": msg.reason, "rounds": msg.round, "passages": final,
                                "unresolved": unresolved, "plan": ctx.get_state("plan"), "drafts": drafts,
                                "checks": chks, "reviews": revs, "events": ctx.get_state("events", [])})


class Seed(Executor):
    """puts the clip's fact sheet and the series memory into the shared state, then starts the Analyst; on a
    revision, it puts the published commentary in as round 1 with a person's notes as that round's review, and
    sends the noted passages straight back to the Commentator"""

    def __init__(self, sheet: dict, series: dict, revise: dict | None = None):
        super().__init__(id="seed")
        self.sheet, self.series, self.revise = sheet, series, revise

    @handler
    async def seed(self, job: Job, ctx: WorkflowContext[Job | Write]) -> None:
        ctx.set_state("sheet", self.sheet)
        ctx.set_state("series", self.series)
        _log(ctx, "started", clip=job.clip, slots=len(self.sheet["slots"]))
        if not self.revise:
            await ctx.send_message(job)
            return
        r = self.revise
        notes = r["notes"]
        ctx.set_state("plan", r["plan"])
        ctx.set_state("reviewer_notes", notes)
        ctx.set_state("drafts", [r["passages"]])
        ctx.set_state("checks", [r["checks"]])
        ctx.set_state("reviews", [{"overall": "a person's review of the published commentary",
                                   "verdicts": [{"id": s["id"], "ok": s["id"] not in notes,
                                                 "problems": [f"a person's review: {notes[s['id']]}"] if s["id"] in notes else [],
                                                 "fix": notes.get(s["id"], "")} for s in self.sheet["slots"]]}])
        back = [s["id"] for s in self.sheet["slots"] if s["id"] in notes]
        _log(ctx, "reviewed", round=1, sent_back=back, overall="a person's review")
        await ctx.send_message(Write(round=2, back=back))


def build(team, meter, sheet: dict, series: dict, rounds: int = 3, revise: dict | None = None):
    """`revise`: {passages, checks, plan, notes: {id: note}} to start from a published commentary and a person's
    notes; `rounds` then counts the published version as round 1"""
    seed, analyst, commentator = Seed(sheet, series, revise), Analyst(team), Commentator(team)
    voice, editor, publisher = VoiceCheck(meter), Editor(team, rounds), Publisher()
    return (WorkflowBuilder(start_executor=seed, name="pitch-pilot-explain-commentary", max_iterations=8 + 4 * rounds,
                            description="Analyst, Commentator and Editor agents write a clip's Explain commentary")
            .add_edge(seed, analyst, condition=lambda m: isinstance(m, Job))
            .add_edge(seed, commentator, condition=lambda m: isinstance(m, Write))
            .add_edge(analyst, commentator)
            .add_edge(commentator, voice)
            .add_edge(voice, editor)
            .add_edge(editor, commentator, condition=lambda m: isinstance(m, Write))
            .add_edge(editor, publisher, condition=lambda m: isinstance(m, Publish))
            .build())
