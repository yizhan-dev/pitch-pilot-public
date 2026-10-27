"""Run the real Agent Framework workflow on a wholly invented fact sheet.

Default: scripted agents and estimated speech duration, with no cloud calls.
--mode foundry/local opts into live Foundry calls with the configured account.
"""
import argparse
import asyncio
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pitch_agents import team, workflow  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "commentary.json"


class EstimatedMeter:
    """Deliberately offline: never consults speech credentials or a service."""
    def seconds(self, text: str, energy: str = "calm"):
        return round(len(re.findall(r"[\w%'-]+", text)) / 2.6 + text.count("...") * 0.35, 2), "estimate"


async def run(sheet: dict, mode: str = "dry", rounds: int = 3):
    actors = team.DryTeam(2.6, sheet) if mode == "dry" else await team.FoundryTeam(2.6, hosted=mode == "foundry").start()
    graph = workflow.build(actors, EstimatedMeter(), sheet, {"other_clips": {}, "openers_used": []}, rounds=rounds)
    try:
        result = await graph.run(workflow.Job(clip=sheet["clip"]))
        outputs = result.get_outputs()
        if not outputs:
            raise RuntimeError("Workflow ended without a publishable result")
        return {"synthetic": True, "mode": mode, "duration_method": "estimate",
                **outputs[-1], "calls": actors.calls}
    finally:
        await actors.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["dry", "local", "foundry"], default="dry")
    parser.add_argument("--output", type=Path, default=Path("artifacts/agent-example.json"))
    args = parser.parse_args()
    sheet = json.loads(FIXTURE.read_text())
    result = asyncio.run(run(sheet, args.mode))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"{result['reason']}; {result['rounds']} rounds; {len(result['calls'])} calls; "
          f"{len(result['unresolved'])} unresolved; mode={args.mode}; output={args.output}")
    return 0 if not result["unresolved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
