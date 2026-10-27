import { useState } from 'react';
import { DEFAULT_FACADE, type FacadeParams } from '../src/three/stadium/Facade';
import { DEFAULT_CRYSTAL, type CrystalParams } from '../src/three/stadium/crystalParams';
import { CAMS, TIMES, PRESETS, CRYSTAL_PRESETS, type StudioState, type TimeOfDay } from './config';

type NumKey = { [K in keyof FacadeParams]: FacadeParams[K] extends number ? K : never }[keyof FacadeParams];
type Slider = { key: NumKey; label: string; min: number; max: number; step: number; unit?: string };
const ROOF_SLIDERS: Slider[] = [
  { key: 'roofAmp', label: '屋顶起伏高度', min: 0, max: 24, step: 0.5, unit: 'm' },
  { key: 'roofWaves', label: '起伏峰数（2 = 马鞍）', min: 0, max: 8, step: 1 },
  { key: 'roofPhase', label: '起伏相位', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'plateau', label: '平台宽度（0 尖峰，大 = 梯形）', min: 0, max: 0.9, step: 0.05 },
  { key: 'fold', label: '折叠度（0 曲线，1 折面）', min: 0, max: 1, step: 0.05 },
  { key: 'facets', label: '折面数', min: 4, max: 40, step: 1 },
  { key: 'jag', label: '折面不规则度', min: 0, max: 1, step: 0.05 },
  { key: 'bulge', label: '屋面拱起', min: -2, max: 10, step: 0.25, unit: 'm' },
  { key: 'eave', label: '屋檐圆角', min: 0, max: 12, step: 0.5, unit: 'm' },
  { key: 'inset', label: '外壳底部内收', min: 0, max: 12, step: 0.1, unit: 'm' },
];
const ASYM_SLIDERS: Slider[] = [
  { key: 'tilt', label: '整体倾斜（一侧高起）', min: 0, max: 16, step: 0.5, unit: 'm' },
  { key: 'tiltPhase', label: '倾斜方向', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'facetJitter', label: '折面宽窄不一', min: 0, max: 1, step: 0.05 },
  { key: 'foldVar', label: '硬软过渡（一侧硬一侧软）', min: 0, max: 1, step: 0.05 },
  { key: 'foldPhase', label: '最硬的方向', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'leanVar', label: '折面外墙倾角变化', min: 0, max: 8, step: 0.25, unit: 'm' },
  { key: 'prow', label: '船首外挑', min: 0, max: 20, step: 0.5, unit: 'm' },
  { key: 'prowPhase', label: '船首方向', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'prowWidth', label: '船首宽度', min: 6, max: 90, step: 1, unit: '°' },
];
const FIN_SLIDERS: Slider[] = [
  { key: 'finStep', label: '鳍片间距', min: 0.8, max: 5, step: 0.1, unit: 'm' },
  { key: 'angle', label: '最大转角', min: 0, max: 90, step: 1, unit: '°' },
  { key: 'waves', label: '转角波数（绕一圈）', min: 0, max: 16, step: 1 },
  { key: 'twist', label: '沿鳍片扭转', min: 0, max: 1.5, step: 0.05, unit: '圈' },
  { key: 'depthMin', label: '鳍片最浅', min: 0.2, max: 4, step: 0.1, unit: 'm' },
  { key: 'depthMax', label: '鳍片最深', min: 0.2, max: 6, step: 0.1, unit: 'm' },
  { key: 'depthWaves', label: '深度波数', min: 0, max: 24, step: 1 },
  { key: 'ribs', label: '翻上屋顶的长度', min: 0, max: 40, step: 0.5, unit: 'm' },
  { key: 'lift', label: '离地（悬浮底座）', min: 0, max: 14, step: 0.5, unit: 'm' },
  { key: 'finChaos', label: '鳍片波纹不规则', min: 0, max: 1, step: 0.05 },
];
/** starting points for the main directions; every slider stays live afterwards */
const LIGHT_SLIDERS: Slider[] = [
  { key: 'glow', label: '室内灯光', min: 0, max: 2, step: 0.05 },
  { key: 'ledSpeed', label: 'LED 光波速度', min: 0, max: 0.3, step: 0.01 },
  { key: 'ledGain', label: 'LED 亮度', min: 0, max: 2, step: 0.05 },
];

type CKey = { [K in keyof CrystalParams]: CrystalParams[K] extends number ? K : never }[keyof CrystalParams];
type CSlider = { key: CKey; label: string; min: number; max: number; step: number; unit?: string };
const CRYSTAL_GROUPS: [string, CSlider[]][] = [
  ['平面', [
    { key: 'cutMain', label: '主看台侧切角', min: 0.05, max: 1, step: 0.05 },
    { key: 'cutOther', label: '另一侧切角', min: 0.05, max: 1, step: 0.05 },
  ]],
  ['梯形屋脊', [
    { key: 'low', label: '两端檐口高度', min: 29, max: 42, step: 0.5, unit: 'm' },
    { key: 'rise', label: '长边高出两端', min: 0, max: 22, step: 0.5, unit: 'm' },
    { key: 'mainRise', label: '主看台再高出', min: 0, max: 12, step: 0.5, unit: 'm' },
    { key: 'skew', label: '两端高差', min: 0, max: 8, step: 0.5, unit: 'm' },
  ]],
  ['立面', [
    { key: 'lean', label: '墙面倾角（正 = 外挑，负 = 内收）', min: -12, max: 20, step: 0.5, unit: '°' },
    { key: 'mainLean', label: '主看台额外倾角', min: -8, max: 15, step: 0.5, unit: '°' },
    { key: 'lift', label: '悬浮高度', min: 0, max: 14, step: 0.5, unit: 'm' },
    { key: 'podInset', label: '玻璃底座后退', min: 1, max: 16, step: 0.5, unit: 'm' },
    { key: 'podSlant', label: '玻璃底座内斜', min: 0, max: 6, step: 0.25, unit: 'm' },
    { key: 'legIn', label: '柱脚离挑檐边', min: 0.5, max: 10, step: 0.25, unit: 'm' },
    { key: 'legs', label: '支撑间距（0 = 只在四角）', min: 0, max: 40, step: 1, unit: 'm' },
  ]],
  ['曲线', [
    { key: 'fillet', label: '屋脊圆肩长度（0 = 尖角）', min: 0, max: 70, step: 1, unit: 'm' },
    { key: 'crown', label: '长边檐口上拱', min: 0, max: 6, step: 0.25, unit: 'm' },
    { key: 'archMain', label: '主入口拱高', min: 0, max: 18, step: 0.5, unit: 'm' },
    { key: 'archLong', label: '对面长边拱高', min: 0, max: 18, step: 0.5, unit: 'm' },
    { key: 'archEnd', label: '两端拱高', min: 0, max: 14, step: 0.5, unit: 'm' },
    { key: 'archPow', label: '拱形饱满度（小 = 更饱满）', min: 0.3, max: 1.5, step: 0.05 },
    { key: 'edgeHard', label: '分界线硬朗度（0 曲线，1 折线）', min: 0, max: 1, step: 0.05 },
    { key: 'sag', label: '屋面下垂', min: 0, max: 10, step: 0.25, unit: 'm' },
    { key: 'eaveR', label: '檐口圆角（打磨顶边）', min: 0, max: 16, step: 0.25, unit: 'm' },
    { key: 'cornerR', label: '折角圆角（打磨竖边）', min: 0, max: 24, step: 0.5, unit: 'm' },
    { key: 'bowLong', label: '长边外鼓', min: 0, max: 12, step: 0.25, unit: 'm' },
    { key: 'bowEnd', label: '球门端外鼓', min: 0, max: 12, step: 0.25, unit: 'm' },
  ]],
  ['三七分', [
    { key: 'split', label: '最高点位置（0.5 = 居中）', min: 0.15, max: 0.85, step: 0.01 },
    { key: 'peak', label: '长边屋脊升高', min: 0, max: 14, step: 0.25, unit: 'm' },
    { key: 'tail', label: '东端切角（1 = 和西端一样）', min: 0.1, max: 1, step: 0.05 },
  ]],
  ['对角圆角', [
    { key: 'roundCut', label: '圆角一对的切角', min: 0.3, max: 1, step: 0.05 },
    { key: 'roundR', label: '圆角一对的圆角半径', min: 4, max: 30, step: 0.5, unit: 'm' },
    { key: 'sharpCut', label: '锋利一对的切角', min: 0.05, max: 1, step: 0.05 },
    { key: 'sharpR', label: '锋利一对的圆角半径', min: 0, max: 30, step: 0.5, unit: 'm' },
    { key: 'eaveRSharp', label: '锋利一对的檐口圆肩', min: 0, max: 16, step: 0.25, unit: 'm' },
  ]],
  ['屋面黑带', [
    { key: 'rimW', label: '檐口白边宽', min: 2, max: 20, step: 0.5, unit: 'm' },
    { key: 'lipW', label: '开口白环宽', min: 2, max: 20, step: 0.5, unit: 'm' },
  ]],
  ['柔和的开口', [
    { key: 'openInset', label: '屋面宽度（开口内缩）', min: 16, max: 40, step: 0.5, unit: 'm' },
    { key: 'openN', label: '开口方圆度（小 = 圆，大 = 方）', min: 2.4, max: 6, step: 0.1 },
    { key: 'inDrop', label: '开口低于檐口', min: 1, max: 10, step: 0.5, unit: 'm' },
  ]],
  ['表面与灯光', [
    { key: 'finStep', label: '鳍片间距', min: 0.8, max: 4, step: 0.1, unit: 'm' },
    { key: 'finDepth', label: '鳍片深度', min: 0.3, max: 3, step: 0.1, unit: 'm' },
    { key: 'finThick', label: '鳍片厚度', min: 0.05, max: 0.8, step: 0.01, unit: 'm' },
    { key: 'finUp', label: '鳍片爬上圆肩（0 = 停在圆肩下）', min: 0, max: 1, step: 0.05 },
    { key: 'finWave', label: '鳍片律动：深浅变化', min: 0, max: 0.8, step: 0.05 },
    { key: 'finWaves', label: '鳍片律动：波数', min: 1, max: 8, step: 1 },
    { key: 'finYaw', label: '鳍片律动：转角', min: 0, max: 45, step: 1, unit: '°' },
    { key: 'glow', label: '室内灯光', min: 0, max: 2, step: 0.05 },
  ]],
];

export function Panel({ state, setState, reset }: { state: StudioState; setState: (f: (s: StudioState) => StudioState) => void; reset: () => void }) {
  const [toast, setToast] = useState('');
  const setF = <K extends keyof FacadeParams>(k: K, v: FacadeParams[K]) => setState((s) => ({ ...s, facade: { ...s.facade, [k]: v } }));
  const row = (sl: Slider) => (
    <div className="row" key={sl.key}>
      <label htmlFor={sl.key}>{sl.label}</label>
      <output>{state.facade[sl.key]}{sl.unit ?? ''}</output>
      <input id={sl.key} type="range" min={sl.min} max={sl.max} step={sl.step} value={state.facade[sl.key]}
        onChange={(e) => setF(sl.key, +e.target.value)} />
    </div>
  );
  const setC = <K extends keyof CrystalParams>(k: K, v: CrystalParams[K]) => setState((s) => ({ ...s, crystal: { ...s.crystal, [k]: v } }));
  const rowC = (sl: CSlider) => (
    <div className="row" key={sl.key}>
      <label htmlFor={'c-' + sl.key}>{sl.label}</label>
      <output>{state.crystal[sl.key]}{sl.unit ?? ''}</output>
      <input id={'c-' + sl.key} type="range" min={sl.min} max={sl.max} step={sl.step} value={state.crystal[sl.key]}
        onChange={(e) => setC(sl.key, +e.target.value)} />
    </div>
  );
  const copy = async () => {
    const text = JSON.stringify(state, null, 1);
    try { await navigator.clipboard.writeText(text); setToast('参数已复制，可以直接贴给 Claude'); } catch { setToast('复制失败：直接把网址发给 Claude 也行'); }
    setTimeout(() => setToast(''), 3000);
  };
  return (
    <aside className="studio-panel">
      <h1>Stadium Studio</h1>
      <p className="sub">参数实时写进网址。</p>

      <h2>时间</h2>
      <div className="seg">
        {(Object.keys(TIMES) as TimeOfDay[]).map((t) => (
          <button key={t} className={state.time === t ? 'on' : ''} onClick={() => setState((s) => ({ ...s, time: t }))}>{TIMES[t].label}</button>
        ))}
      </div>

      <h2>机位</h2>
      <div className="seg">
        {Object.entries(CAMS).map(([k, c]) => (
          <button key={k} className={state.cam === k ? 'on' : ''} onClick={() => setState((s) => ({ ...s, cam: k }))}>{c.label}</button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={state.spin} onChange={(e) => setState((s) => ({ ...s, spin: e.target.checked }))} />自动旋转</label>
      <label className="check"><input type="checkbox" checked={state.interior} onChange={(e) => setState((s) => ({ ...s, interior: e.target.checked }))} />显示看台、观众和球场</label>

      <h2>外壳形式</h2>
      <div className="seg">
        <button className={state.form === 'crystal' ? 'on' : ''} onClick={() => setState((s) => ({ ...s, form: 'crystal' }))}>利落晶体</button>
        <button className={state.form === 'sweep' ? 'on' : ''} onClick={() => setState((s) => ({ ...s, form: 'sweep' }))}>扫掠外壳（A–H）</button>
      </div>

      {state.form === 'crystal' ? <>
      <h2>预设</h2>
      <div className="seg">
        {CRYSTAL_PRESETS.map((pr) => (
          <button key={pr.key} title={pr.note} onClick={() => setState((s) => ({ ...s, crystal: { ...DEFAULT_CRYSTAL, ...pr.crystal } }))}>{pr.label}</button>
        ))}
      </div>
      {CRYSTAL_GROUPS.map(([title, rows]) => (
        <div key={title}><h2>{title}</h2>{rows.map(rowC)}</div>
      ))}
      <label className="check"><input type="checkbox" checked={state.crystal.diag > 0.5} onChange={(e) => setC('diag', e.target.checked ? 1 : 0)} />对角圆角（一条对角线圆，另一条尖）</label>
      <label className="check"><input type="checkbox" checked={state.crystal.diagFlip > 0.5} onChange={(e) => setC('diagFlip', e.target.checked ? 1 : 0)} />换另一条对角线</label>
      <label className="check"><input type="checkbox" checked={state.crystal.crestTwist > 0.5} onChange={(e) => setC('crestTwist', e.target.checked ? 1 : 0)} />屋脊绕中心对称（对面在东端最高）</label>
      <label className="check"><input type="checkbox" checked={state.crystal.band > 0.5} onChange={(e) => setC('band', e.target.checked ? 1 : 0)} />屋面黑色玻璃带</label>
      <h2>YIZHAN 标识</h2>
      <label className="check"><input type="checkbox" checked={state.crystal.smoothShell > 0.5} onChange={(e) => setC('smoothShell', e.target.checked ? 1 : 0)} />圆肩和屋面光滑（无网格纹）</label>
      <label className="check"><input type="checkbox" checked={state.crystal.signStyle > 0.5} onChange={(e) => setC('signStyle', e.target.checked ? 1 : 0)} />显示标识</label>
      <label className="check"><input type="checkbox" checked={state.crystal.signCenter > 0.5} onChange={(e) => setC('signCenter', e.target.checked ? 1 : 0)} />长边字标居中（否则在三七分点）</label>
      <label className="check"><input type="checkbox" checked={state.crystal.signWordPanel > 0.5} onChange={(e) => setC('signWordPanel', e.target.checked ? 1 : 0)} />长边字标加黑底</label>
      <label className="check"><input type="checkbox" checked={state.crystal.signEnds > 0.5} onChange={(e) => setC('signEnds', e.target.checked ? 1 : 0)} />球门两端放符号</label>
      <label className="check"><input type="checkbox" checked={state.crystal.signSymbolPanel > 0.5} onChange={(e) => setC('signSymbolPanel', e.target.checked ? 1 : 0)} />符号加黑底</label>
      {([
        { key: 'signWordRise', label: '长边字标高度', min: 0, max: 1, step: 0.02 },
        { key: 'signSymbolRise', label: '东端符号高度', min: 0, max: 1, step: 0.02 },
        { key: 'signSymbolRiseWest', label: '西端符号高度', min: 0, max: 1, step: 0.02 },
      ] as CSlider[]).map(rowC)}

      <h2>台基与广场</h2>
      <label className="check"><input type="checkbox" checked={state.crystal.landscape > 0.5} onChange={(e) => setC('landscape', e.target.checked ? 1 : 0)} />石阶台基</label>
      <label className="check"><input type="checkbox" checked={state.crystal.stepLed > 0.5} onChange={(e) => setC('stepLed', e.target.checked ? 1 : 0)} />台阶灯带</label>
      <label className="check"><input type="checkbox" checked={state.crystal.ground > 0.5} onChange={(e) => setC('ground', e.target.checked ? 1 : 0)} />八边形地面和路灯</label>
      <label className="check"><input type="checkbox" checked={state.crystal.plaza > 0.5} onChange={(e) => setC('plaza', e.target.checked ? 1 : 0)} />放射纹铺装</label>
      <label className="check"><input type="checkbox" checked={state.crystal.fountain > 0.5} onChange={(e) => setC('fountain', e.target.checked ? 1 : 0)} />水池和喷泉</label>
      {([
        { key: 'deckH', label: '台基高度', min: 0.6, max: 4.2, step: 0.3, unit: 'm' },
        { key: 'deckOut', label: '台基伸出车身', min: 1, max: 16, step: 0.5, unit: 'm' },
        { key: 'stepT', label: '踏步深度', min: 0.4, max: 2, step: 0.05, unit: 'm' },
        { key: 'groundD', label: '八边形地面外扩', min: 20, max: 90, step: 1, unit: 'm' },
        { key: 'groundStyle', label: '地面材质 0石板 1浅灰 2抛光 3环线', min: 0, max: 3, step: 1, unit: '' },
        { key: 'lampStep', label: '路灯间距', min: 8, max: 40, step: 1, unit: 'm' },
        { key: 'plazaW', label: '放射纹铺装宽度', min: 20, max: 90, step: 1, unit: 'm' },
      ] as CSlider[]).map(rowC)}
      <h2>支撑</h2>
      <div className="seg">
        {([[1, 'V 形柱廊'], [2, '树形柱'], [3, '竖直柱廊'], [5, '巨柱'], [4, '悬浮'], [0, '墙脚斜柱（旧）']] as [number, string][]).map(([v, label]) => (
          <button key={v} className={Math.round(state.crystal.legStyle) === v ? 'on' : ''} onClick={() => setC('legStyle', v)}>{label}</button>
        ))}
      </div>
      <h2>表面</h2>
      <div className="seg">
        {([[0, '玻璃 + 鳍片'], [2, '网膜 + 鳍片'], [1, '只有网膜']] as [number, string][]).map(([v, label]) => (
          <button key={v} className={Math.round(state.crystal.skin) === v ? 'on' : ''} onClick={() => setC('skin', v)}>{label}</button>
        ))}
      </div>
      <h2>颜色</h2>
      <div className="row"><label>立面</label><input type="color" value={state.crystal.faceColor} onChange={(e) => setC('faceColor', e.target.value)} /></div>
      <div className="row"><label>屋面</label><input type="color" value={state.crystal.roofColor} onChange={(e) => setC('roofColor', e.target.value)} /></div>
      <div className="row"><label>黑带</label><input type="color" value={state.crystal.bandColor} onChange={(e) => setC('bandColor', e.target.value)} /></div>

      </> : <>
      {PRESETS.length > 0 && <h2>预设</h2>}
      <div className="seg">
        {PRESETS.map((pr) => (
          <button key={pr.key} title={pr.note} onClick={() => setState((s) => ({ ...s, facade: { ...DEFAULT_FACADE, ...pr.facade } }))}>{pr.label}</button>
        ))}
      </div>

      <h2>屋顶与外壳</h2>
      {ROOF_SLIDERS.map(row)}
      <h2>打破对称</h2>
      {ASYM_SLIDERS.map(row)}
      <h2>鳍片</h2>
      {FIN_SLIDERS.map(row)}
      <h2>灯光</h2>
      {LIGHT_SLIDERS.map(row)}

      <h2>表面</h2>
      <div className="seg">
        {([[0, '玻璃 + 鳍片'], [2, '网膜 + 鳍片'], [1, '只有网膜']] as [number, string][]).map(([v, label]) => (
          <button key={v} className={Math.round(state.facade.skin) === v ? 'on' : ''} onClick={() => setF('skin', v)}>{label}</button>
        ))}
      </div>

      <h2>颜色</h2>
      <div className="row"><label>鳍片</label><input type="color" value={state.facade.finColor} onChange={(e) => setF('finColor', e.target.value)} /></div>
      <div className="row"><label>屋面网膜</label><input type="color" value={state.facade.roofColor} onChange={(e) => setF('roofColor', e.target.value)} /></div>
      <div className="row"><label>LED</label><input type="color" value={state.facade.ledColor} onChange={(e) => setF('ledColor', e.target.value)} /></div>

      </>}

      <div className="actions">
        <button onClick={copy}>复制参数</button>
        <button onClick={reset}>恢复默认</button>
      </div>
      <div className="toast">{toast}</div>
    </aside>
  );
}
