"""Azure AI Speech: one passage as SSML, synthesized to a 48 kHz mono WAV, with its spoken length.

The key and region come from the repository's .env (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION) and are never printed.
Without a key, AZURE_SPEECH_ENDPOINT with Entra ID (`az login`) is used instead.
"""
import hashlib
import json
import os
import re
from pathlib import Path
from xml.sax.saxutils import escape

from pitch_agents import paths  # noqa: F401  (loads .env)

PAUSE_MS = 350                  # a written "..." as a spoken pause


def available() -> bool:
    return bool(os.environ.get("AZURE_SPEECH_KEY") or os.environ.get("AZURE_SPEECH_ENDPOINT"))


def _config():
    import azure.cognitiveservices.speech as sdk
    key, region = os.environ.get("AZURE_SPEECH_KEY"), os.environ.get("AZURE_SPEECH_REGION")
    if key and region:
        cfg = sdk.SpeechConfig(subscription=key, region=region)
    else:
        from azure.identity import AzureCliCredential
        cfg = sdk.SpeechConfig(token_credential=AzureCliCredential(tenant_id=os.environ.get("AZURE_TENANT_ID")),
                               endpoint=os.environ["AZURE_SPEECH_ENDPOINT"])
    cfg.set_speech_synthesis_output_format(sdk.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm)
    return cfg


def ssml(text: str, voice: dict, energy: str = "calm") -> str:
    """the passage for the voice: "..." becomes a short break; an excited style for a "lift" passage if the voice has
    one. `voice`: {name, lang, style?, lift_style?, degree?, rate?, pitch?}"""
    body = escape(text.replace("…", "..."))
    body = re.sub(r"\s*\.\.\.\s*", f' <break time="{PAUSE_MS}ms"/> ', body).strip()
    prosody = {k: voice[k] for k in ("rate", "pitch") if voice.get(k)}
    if prosody:
        body = "<prosody " + " ".join(f'{k}="{v}"' for k, v in prosody.items()) + f">{body}</prosody>"
    style = voice.get("lift_style") if energy == "lift" and voice.get("lift_style") else voice.get("style")
    if style:
        deg = voice.get("degree", 1)
        body = f'<mstts:express-as style="{style}" styledegree="{deg}">{body}</mstts:express-as>'
    return ('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="{voice.get("lang", "en-US")}">'
            f'<voice name="{voice["name"]}">{body}</voice></speak>')


_synth = None


def synthesize(text: str, voice: dict, energy: str = "calm") -> tuple[bytes, float]:
    """(WAV bytes, spoken seconds)"""
    global _synth
    import azure.cognitiveservices.speech as sdk
    if _synth is None:
        _synth = sdk.SpeechSynthesizer(speech_config=_config(), audio_config=None)
    res = _synth.speak_ssml_async(ssml(text, voice, energy)).get()
    if res.reason != sdk.ResultReason.SynthesizingAudioCompleted:
        det = res.cancellation_details
        raise RuntimeError(f"speech synthesis failed: {det.reason} {det.error_details if det else ''}"[:300])
    data = bytes(res.audio_data)
    return data, spoken(data)


def spoken(wav: bytes) -> float:
    """the seconds between the first and the last sound, as passage_mix.py trims a take (-40 dB of the peak, 30 ms
    pads): the voice's leading and trailing silence is not part of the passage"""
    import array
    import io
    import wave
    with wave.open(io.BytesIO(wav)) as w:
        sr, a = w.getframerate(), array.array("h", w.readframes(w.getnframes()))
    if not a:
        return 0.0
    peak = max(abs(min(a)), max(a)) or 1
    th = peak * 0.01
    first = next(i for i, x in enumerate(a) if abs(x) > th)
    last = len(a) - next(i for i, x in enumerate(reversed(a)) if abs(x) > th)
    return round(min(len(a), last - first + int(0.06 * sr)) / sr, 3)


def voices(locale_prefix: str = "en-") -> list:
    """the voices this resource offers, with their styles"""
    import azure.cognitiveservices.speech as sdk
    syn = sdk.SpeechSynthesizer(speech_config=_config(), audio_config=None)
    res = syn.get_voices_async().get()
    return [{"name": v.short_name, "locale": v.locale, "gender": str(v.gender).split(".")[-1], "type": str(v.voice_type).split(".")[-1],
             "styles": list(v.style_list or [])} for v in res.voices if v.locale.startswith(locale_prefix)]


class Meter:
    """spoken lengths, cached by voice and text, so a passage the Editor passed is not measured twice"""

    def __init__(self, voice: dict, cache: Path, wps: float = 2.6):
        self.voice, self.cache, self.wps = voice, cache, wps
        self.known = json.loads(cache.read_text()) if cache.exists() else {}

    def key(self, text: str, energy: str) -> str:
        return hashlib.sha1(json.dumps([2, self.voice, text, energy]).encode()).hexdigest()[:16]   # 2: trimmed lengths

    def seconds(self, text: str, energy: str = "calm") -> tuple[float, str]:
        """(seconds, how it was measured: 'speech' or 'estimate')"""
        k = self.key(text, energy)
        if k in self.known:
            return self.known[k], "speech"
        if not available():
            words = len(re.findall(r"[\w%'-]+", text))
            return round(words / self.wps + text.count("...") * PAUSE_MS / 1000, 2), "estimate"
        _, s = synthesize(text, self.voice, energy)
        self.known[k] = round(s, 3)
        self.cache.parent.mkdir(parents=True, exist_ok=True)
        self.cache.write_text(json.dumps(self.known, indent=0))
        return self.known[k], "speech"
