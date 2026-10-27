"""Local-only prototype boundary for a separately held private backend."""


class BackendUnavailable(Exception):
    """A private adapter can raise this when its backend cannot serve a request."""
