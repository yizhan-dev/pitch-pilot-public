import { fullGroups, type Role, type StatEntry, type StatKey } from './playerStats';
import { tr } from '../i18n';

// The full stats (全部数据) inside the expanded player card, one page below the portrait and the eight default entries
// Four groups of four, by what the player is doing: 跑动 (his body), 持球 (on the ball), 进攻 (making
// chances and finishing), 防守 (winning the ball back); keepers get 门将 in place of 进攻 (playerStats.fullGroups).
// Sixteen entries fit the height of the portrait page, so the card keeps its size when the page scrolls. Parked for the
// post-match report: speed bands, crosses, long balls for outfield players, blocks, fouls. Example values for now (see
// docs/plans/hud-notes.md), except 失球, from the score.

/** FM-style arrows beside an entry: up to three, green up when he stands out for his role, red down when he falls short;
 *  the slot keeps its width when empty, so the labels line up */
export function Trend({ n }: { n: number }) {
  const k = Math.min(3, Math.abs(n));
  return (
    <span className={`hud-trend${n > 0 ? ' up' : n < 0 ? ' down' : ''}`} aria-label={k ? tr(`${n > 0 ? '高于' : '低于'}同位置常规 ${k} 级`, `${k} ${k === 1 ? 'step' : 'steps'} ${n > 0 ? 'above' : 'below'} the usual for the position`) : undefined}>
      {k > 0 && (
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {Array.from({ length: k }, (_, i) => {
            const y = 7 - (k - 1) * 2 + i * 4;      // stacked, 4 units apart, centred on the row
            return <path key={i} d={n > 0 ? `M1 ${y + 1.5} L4 ${y - 1.5} L7 ${y + 1.5}` : `M1 ${y - 1.5} L4 ${y + 1.5} L7 ${y - 1.5}`} />;
          })}
        </svg>
      )}
    </span>
  );
}

/** one entry: arrows, label, value with its unit */
export function StatRow({ e }: { e: StatEntry }) {
  return <div><Trend n={e.trend} /><dt>{e.label}</dt><dd>{e.value}{e.unit && <small>{e.unit}</small>}</dd></div>;
}

export function FullStats({ role, entries }: { role: Role; entries: Record<StatKey, StatEntry> }) {
  return (
    <div className="hud-full">
      <div className="hud-full-grid">
        {fullGroups(role).map((g) => (
          <section className="hud-full-group" key={g.title}>
            <h3>{g.title}</h3>
            <dl>{g.keys.map((k) => <StatRow key={k} e={entries[k]} />)}</dl>
          </section>
        ))}
      </div>
    </div>
  );
}
