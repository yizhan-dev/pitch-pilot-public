"""Public agent runtime configuration; no private data adapters are imported."""
from pathlib import Path
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
load_dotenv(REPO / ".env")
