"""The three agents behind one call, `ask(role, payload, schema)`, with retries and a record of every call.

Each role can run on its own model deployment (AZURE_AI_MODEL_ANALYST / _COMMENTATOR / _EDITOR, else
AZURE_AI_MODEL_DEPLOYMENT): the writers on a model with a good voice, the Editor on a fast, careful one.

- `foundry`: the agents live in the Microsoft Foundry project as prompt agents (one version per run, visible in the
  Foundry portal) and are called through Agent Framework's `FoundryAgent`.
- `local`: the same agents built in-process with Agent Framework (`Agent` over `FoundryChatClient`), on the same
  Foundry model deployment; the fallback if publishing the prompt agents is not allowed.
- `dry`: no service at all; scripted answers, to test the workflow's wiring.

Signs in with Entra ID (`az login`; the Foundry Agent Service takes no API keys). The endpoint and the model
deployment come from .env: AZURE_AI_PROJECT_ENDPOINT, AZURE_AI_MODEL_DEPLOYMENT.
"""
import asyncio
import json
import os
import re
import time
from pathlib import Path

from pydantic import BaseModel, ValidationError

from pitch_agents import roles

NAMES = {"analyst": "pitch-pilot-analyst", "commentator": "pitch-pilot-commentator", "editor": "pitch-pilot-editor"}
ROLE_TEXT = {"analyst": roles.ANALYST, "commentator": roles.COMMENTATOR, "editor": roles.EDITOR}
SCHEMA = {"analyst": roles.Plan, "commentator": roles.Draft, "editor": roles.Review}
DESCRIPTION = {"analyst": "Pitch Pilot Explain commentary: plans each passage's talking points from the clip's fact sheet",
               "commentator": "Pitch Pilot Explain commentary: writes the passages to each slot's time budget and the house rules",
               "editor": "Pitch Pilot Explain commentary: checks every passage against the fact sheet, the length and the tone"}


def instructions(role: str, wps: float) -> str:
    return roles.STYLE.replace("{wps}", f"{wps:.1f}") + "\n\n# Your role\n\n" + ROLE_TEXT[role]


def parse(text: str, schema: type[BaseModel]) -> BaseModel:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    return schema.model_validate_json(t)


class Team:
    mode = "base"

    def __init__(self, wps: float):
        self.wps = wps
        self.calls: list[dict] = []
        self.agents: dict[str, dict] = {}
        self.model = os.environ.get("AZURE_AI_MODEL_DEPLOYMENT", "")
        self.models = {r: os.environ.get(f"AZURE_AI_MODEL_{r.upper()}") or self.model for r in ("analyst", "commentator", "editor")}

    async def _run(self, role: str, prompt: str):
        raise NotImplementedError

    async def ask(self, role: str, payload: dict, tag: str) -> BaseModel:
        """one agent call: up to 4 attempts; a service error waits and retries, an answer that is not the JSON asked
        for is sent back once with the parser's error"""
        schema = SCHEMA[role]
        prompt = json.dumps(payload, ensure_ascii=False)
        last = None
        for attempt in range(4):
            t0 = time.time()
            rec = {"role": role, "tag": tag, "attempt": attempt + 1, "agent": self.agents.get(role), "model": self.models[role],
                   "prompt_chars": len(prompt)}
            try:
                text, usage = await self._run(role, prompt)
                rec.update(seconds=round(time.time() - t0, 2), answer_chars=len(text), usage=usage)
                out = parse(text, schema)
                rec["ok"] = True
                self.calls.append(rec)
                return out
            except ValidationError as e:
                rec.update(ok=False, error=f"invalid answer: {str(e)[:300]}", answer_head=text[:600],
                           seconds=round(time.time() - t0, 2))
                self.calls.append(rec)
                last = e
                prompt = json.dumps({**payload, "your_last_answer_was_invalid": str(e)[:1500]}, ensure_ascii=False)
            except Exception as e:  # noqa: BLE001 - a service error: wait and retry
                rec.update(ok=False, error=f"{type(e).__name__}: {str(e)[:300]}", seconds=round(time.time() - t0, 2))
                self.calls.append(rec)
                last = e
                await asyncio.sleep(2 ** attempt * 3)
        raise RuntimeError(f"{role} failed after 4 attempts: {last}; last answer: {self.calls[-1].get('answer_head', '')[:400]}")

    async def close(self):
        pass


def _usage(resp) -> dict:
    u = getattr(resp, "usage_details", None) or {}
    return {k: v for k, v in dict(u).items() if isinstance(v, int)}


class FoundryTeam(Team):
    """the agents published to the Foundry project (`foundry`) or built in-process on its model (`local`)"""

    def __init__(self, wps: float, hosted: bool = True):
        super().__init__(wps)
        self.mode = "foundry" if hosted else "local"
        self.hosted = hosted
        self.run_agents = {}

    async def start(self):
        from agent_framework import Agent
        from agent_framework_foundry import FoundryAgent, FoundryChatClient, to_prompt_agent
        from azure.ai.projects.aio import AIProjectClient
        from azure.core.exceptions import ResourceExistsError
        from azure.identity.aio import AzureCliCredential
        az = os.environ.get("AZURE_CLI_BIN")                                # where `az` is, if not on PATH (.env)
        if az and Path(az).exists() and az not in os.environ.get("PATH", ""):
            os.environ["PATH"] = f"{az}:{os.environ.get('PATH', '')}"          # AzureCliCredential calls `az`
        self.cred = AzureCliCredential(tenant_id=os.environ.get("AZURE_TENANT_ID"))
        self.project = AIProjectClient(endpoint=os.environ["AZURE_AI_PROJECT_ENDPOINT"], credential=self.cred)
        for role in NAMES:
            client = FoundryChatClient(project_client=self.project, model=self.models[role])
            local = Agent(client=client, instructions=instructions(role, self.wps), name=NAMES[role],
                          description=DESCRIPTION[role], default_options={"response_format": SCHEMA[role]})
            if not self.hosted:
                self.run_agents[role] = local
                self.agents[role] = {"name": NAMES[role], "model": self.models[role], "kind": "agent-framework Agent on FoundryChatClient"}
                continue
            definition = to_prompt_agent(local)
            for attempt in range(5):                    # two runs publishing the same agent at once: retry
                try:
                    v = await self.project.agents.create_version(agent_name=NAMES[role], definition=definition,
                                                                 description=DESCRIPTION[role],
                                                                 metadata={"product": "Pitch Pilot", "part": "Explain commentary"})
                    break
                except ResourceExistsError:
                    if attempt == 4:
                        raise
                    await asyncio.sleep(2 + 3 * attempt)
            self.agents[role] = {"name": NAMES[role], "version": str(v.version), "model": self.models[role], "kind": "Foundry prompt agent"}
            self.run_agents[role] = FoundryAgent(project_client=self.project, agent_name=NAMES[role],
                                                 agent_version=str(v.version))
        return self

    async def _run(self, role, prompt):
        resp = await self.run_agents[role].run(prompt)
        return resp.text, _usage(resp)

    async def close(self):
        await self.project.close()
        await self.cred.close()


class DryTeam(Team):
    """no service: the Analyst plans each slot's first note, the Commentator writes the reference words (or a
    placeholder), the Editor sends every passage that fails a hard check back once, then approves"""
    mode = "dry"

    def __init__(self, wps: float, sheet: dict):
        super().__init__(wps)
        self.sheet = sheet
        self.agents = {r: {"name": NAMES[r], "kind": "dry run"} for r in NAMES}

    async def _run(self, role, prompt):
        p = json.loads(prompt)
        if role == "analyst":
            out = {"story": ["dry run"], "opener": "dry", "closer": "dry",
                   "slots": [{"id": s["id"], "points": [{"say": (s["notes"] or ["-"])[0][:80], "facts": []}], "name": "",
                              "intention": "", "avoid": []} for s in self.sheet["slots"]]}
        elif role == "commentator":
            prev = {x["id"]: x for x in (p.get("previous_draft") or [])}
            back = set(p.get("rewrite") or [])
            out = {"passages": []}
            for s in self.sheet["slots"]:
                text = s.get("reference") or f"Placeholder for {s['id']}."
                if s["id"] in prev and s["id"] not in back:
                    text = prev[s["id"]]["text"]
                elif s["id"] in back:
                    text = re.split(r"(?<=[.!?])\s+", text)[0]           # the dry fix: keep the first sentence
                out["passages"].append({"id": s["id"], "text": text, "energy": "calm"})
        else:
            checks = p["checks"]
            out = {"verdicts": [{"id": k, "ok": not v["hard"], "problems": v["hard"], "fix": "shorten" if v["hard"] else ""}
                                for k, v in checks.items()], "overall": "dry run"}
        return json.dumps(out), {}
