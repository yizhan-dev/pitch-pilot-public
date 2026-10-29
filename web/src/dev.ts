// Developer hooks: the interface through which the headless tools (scripts/perfbench.mjs, scripts/ui_shot.mjs, the
// capture recorder) and a browser console drive and read the running app, as window.__<name>. Every module exposes
// its hooks through `hook` and reads another module's through `hooked`, so the names are declared once (HOOKS below,
// one line each) and no module casts the window itself. The names are an interface the tools depend on: they do not
// change without the tools.
//
// Some hooks also carry state between modules that have no import path between them (the camera's __camSet, the
// telestration's __teleNow, the recorder's __capture); those are part of the app and present in every build.

export type HookName =
  // the app's clock and clips (GameApp.tsx)
  | 'setT' | 'play' | 'view' | 'settings' | 'portraits' | 'toggleTactical' | 'replayIntro' | 'gotoClip' | 'swapPhase' | 'clipEnd' | 'capture'
  // the loader and its replay (loading-main.tsx, LoadingScene.tsx, boot.ts)
  | 'frames' | 'loadReplay' | 'replay' | 'loadState' | 'introSetT' | 'boot' | 'bootMain'
  // the camera (three/camera/Director.tsx, layers/VarReplay.tsx)
  | 'cam' | 'camSet' | 'camEye' | 'camCut' | 'camBlend' | 'camDrive' | 'camFollow' | 'camBodies' | 'camScripted' | 'setFree' | 'triangles' | 'hover' | 'glInfo' | 'tacZoom' | 'tacPan' | 'varState'
  // the line-up show and the quality system (lineup/LineupShow.tsx, three/quality.ts, AdaptiveQuality.tsx, PerfProbe.tsx, diag.ts)
  | 'lu' | 'length' | 'quality' | 'qualityFps' | 'perf' | 'perfShow' | 'diag' | 'blinklog'
  // the data (data.ts)
  | 'clean' | 'cleanSum'
  // the stadium (three/stadium/*)
  | 'buildMs' | 'crowdT' | 'screenT' | 'topMirror' | 'topRows' | 'meshes' | 'hide' | 'points' | 'look' | 'screen' | 'screenCam' | 'screenParams'
  // the stage (three/Stage.tsx)
  | 'ghosts' | 'players' | 'pitchMode' | 'looks'
  // the telestration and its sandbox (three/telestration/*)
  | 'teleNow' | 'teleExtra' | 'teleHide' | 'teleState' | 'teleLabels' | 'tele' | 'contact' | 'shotCam' | 'select' | 'pitchToScreen' | 'clipT'
  // the explain director and the orchestration board (explain/*, orchestrate/Board.tsx)
  | 'explainUse' | 'explainSet' | 'explainState' | 'screenOf' | 'plan' | 'cues' | 'beatFrame' | 'sketch' | 'people' | 'setN' | 'narrN' | 'nOf' | 'rateAt' | 'candFrame'
  // the what-if (whatif/*)
  | 'wi' | 'land' | 'wiOptions' | 'wiFinish' | 'wiBranch' | 'wiDebug' | 'wiDim' | 'wiNoCols' | 'wiNoLit' | 'wiHold' | 'wiForceLoft' | 'gaitOpts' | 'gaitLog'
  // the tour (tour/*)
  | 'tour' | 'tourResumed';

type Bag = Record<string, unknown>;
const bag = () => globalThis as unknown as Bag;

/** expose a value (a function, an object, a number) as window.__<name> */
export function hook(name: HookName, value: unknown): void { bag()[`__${name}`] = value; }
/** take a hook down (a component unmounting) */
export function unhook(name: HookName): void { delete bag()[`__${name}`]; }
/** read a hook another module or a tool set; undefined when nothing has */
export function hooked<T = unknown>(name: HookName): T | undefined { return bag()[`__${name}`] as T | undefined; }
