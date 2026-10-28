# Requirement and evidence map

This map distinguishes working product features, reproducible public examples and work still needed. It is not
an assertion that every event requirement is met.

| Judging area | Evidence | Limit |
|---|---|---|
| Technological implementation | React/three.js application source, typed interfaces, unit tests, static build | Licensed data and proprietary training are excluded; the default local scene is synthetic |
| Agentic design and innovation | Distinct Foundry roles, Agent Framework state and handoffs, checks, revision and call trace | Offline example uses scripted agents; live model and speech results need authorized services |
| Real-world impact | Replay, analysis, explanation and counterfactual interaction in one viewer | Prototype; no production SLA or verified live-ingestion pipeline |
| User experience and presentation | Four modes, cameras, on-pitch graphics and a live demo | Desktop/WebGL target; English only; What-if is beta |
| Challenge adherence | Interpretation, explanation, visualization and different depth of exploration | A synthetic fixture: licensed real-match movement, used with permission, with every identity invented |

## Five-stage challenge mapping

- **Ingest:** private preprocessing imports prerecorded events and tracking. Real-time synthetic ingestion is not implemented.
- **Interpret:** events and spatial analysis support passing, control and shot context.
- **Explain:** selected clips pair commentary with a directed visual explanation.
- **Render:** replay, subtitles and tactical overlays place insights on the pitch.
- **Personalize:** camera choice, selected-player views and different modes let viewers choose depth and perspective.
  Automated personalized language, club preferences and multilingual narration are not implemented.

## Submission checks requiring a person

- Confirm the final public repository URL and verify access while signed out.
- Verify the final demo video URL is public and satisfies the event's permitted hosting requirements.
  The portal's current embedded video was observed to play with a displayed duration of 1:59; the hosting URL and
  unrestricted access still need verification.
- Keep the working demo available through the judging period.
- Review the final project description so it does not imply a deployed private model service or live ingestion.

Official reference: [Microsoft Inside the Game rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).
