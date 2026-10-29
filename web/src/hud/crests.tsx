import { useId } from 'react';
import { TEAM_KIT, type Team } from '../three/coords';

// The two teams' crests (working names Pelicans and Wildcats): home a pelican in a shield (direction B
// of /review/team-crests/), away a roundel lettered WILDCATS FOOTBALL CLUB round crossed swords (direction D,
// the swords raised a little). Drawn by us, in the kit colours. Used as they are at every size, the score bug's
// 24 px included (no simplified versions). Both sit in a 100 x 120 box so they line up side by side.

const INK = '#f2f4f7', DARK = '#0d131d';
/** an id for the SVG's own references, from useId without the characters url(#…) and href may trip on */
const useSvgId = () => 'crest' + useId().replace(/[^A-Za-z0-9_-]/g, '');

/** a heater shield whose top rises gently to the middle, and the same inset by about 6 */
const SHIELD = 'M50 8 C62 13 77 14 90 11 L90 58 C90 86 72 104 50 115 C28 104 10 86 10 58 L10 11 C23 14 38 13 50 8 Z';
const SHIELD_IN = 'M50 15.5 C60 19.5 72 20.5 83.5 18.5 L83.5 58 C83.5 82 68 97.5 50 107.5 C32 97.5 16.5 82 16.5 58 L16.5 18.5 C28 20.5 40 19.5 50 15.5 Z';

/** the pelican, facing left: an S neck down into the chest, a wing on it, the head, the long bill and its pouch */
function Pelicans() {
  const clip = useSvgId();
  return (
    <>
      <defs><clipPath id={clip}><path d={SHIELD_IN} /></clipPath></defs>
      <path d={SHIELD} fill={TEAM_KIT.home.shirt} />
      <path d={SHIELD_IN} fill={DARK} />
      <g clipPath={`url(#${clip})`} fill={INK}>
        <path d="M42 120 C44 102 54 93 65 93 C79 93 86 105 86 120 Z" />
        <path d="M66 44 C71 58 54 64 58.5 84 L61 118" fill="none" stroke={INK} strokeWidth={11.5} strokeLinecap="round" />
        <path d="M60 120 C62 104 70 96 82 95 C76 102 72 110 72 120 Z" fill={DARK} fillOpacity={0.35} />
        <path d="M64 30 a9 8.2 0 1 0 0.01 0 Z" />
        <path d="M57.5 34 L23 51.5 Q20 53.5 22.8 55 L58.5 42 Z" />
        <path d="M58.5 41.6 L24.5 54.6 C31 63 47 61 57 50.5 Z" fill="#c9d6e8" />
        <circle cx={66.5} cy={36.5} r={1.9} fill={DARK} />
        <path d="M58 41.8 L24 54.6" stroke={DARK} strokeWidth={0.9} />
      </g>
    </>
  );
}

/** one sword, tip up at (0, 0) and 85 long: blade, a curved guard, grip, pommel */
const SWORD = [
  'M0 0 L4.2 9 L4.2 58 L-4.2 58 L-4.2 9 Z',
  'M-15 58 C-8 60.5 8 60.5 15 58 L15 62.5 C8 65 -8 65 -15 62.5 Z',
  'M-2.6 63 L2.6 63 L2.4 78 L-2.4 78 Z',
  'M0 77.9 a3.6 3.6 0 1 0 0.01 0 Z',
];

/** the roundel: the team colour's ring, the name round the top and FOOTBALL CLUB round the bottom, crossed swords in a
 *  tinted middle. The swords' mass sits 3 below the middle, so they are lifted 4 to sit slightly
 *  above it */
function Wildcats() {
  const id = useSvgId(), top = `${id}t`, bottom = `${id}b`, c = TEAM_KIT.away.shirt;
  return (
    <>
      <defs>
        <path id={top} d="M50 60 m-37 0 a37 37 0 1 1 74 0" />
        <path id={bottom} d="M50 60 m-37 0 a37 37 0 0 0 74 0" />
      </defs>
      <circle cx={50} cy={60} r={47} fill={DARK} stroke={c} strokeWidth={3} />
      <circle cx={50} cy={60} r={28.5} fill={c} fillOpacity={0.22} stroke={INK} strokeOpacity={0.5} strokeWidth={1} />
      <text fontFamily="Barlow Condensed" fontWeight={700} fontSize={11.5} letterSpacing={2.6} fill={INK}>
        <textPath href={`#${top}`} startOffset="50%" textAnchor="middle" dominantBaseline="middle">WILDCATS</textPath>
      </text>
      <text fontFamily="Barlow Condensed" fontWeight={600} fontSize={8.5} letterSpacing={2.4} fill={INK} fillOpacity={0.75}>
        <textPath href={`#${bottom}`} startOffset="50%" textAnchor="middle" dominantBaseline="middle">FOOTBALL CLUB</textPath>
      </text>
      <circle cx={13} cy={60} r={1.4} fill={c} />
      <circle cx={87} cy={60} r={1.4} fill={c} />
      <g transform="translate(50 56) scale(.5) translate(-50 -57)">
        {[-40, 40].map((a) => (
          <g key={a} transform={`translate(50 57) rotate(${a}) translate(0 -34)`}>
            {SWORD.map((d) => <path key={d} d={d} fill={INK} />)}
          </g>
        ))}
      </g>
    </>
  );
}

/** a team's crest, `size` px tall (the width follows, 5 : 6) */
export function Crest({ team, size = 24 }: { team: Team; size?: number }) {
  return (
    <svg className="hud-crest-art" viewBox="0 0 100 120" width={(size * 5) / 6} height={size} aria-hidden="true">
      {team === 'home' ? <Pelicans /> : <Wildcats />}
    </svg>
  );
}
