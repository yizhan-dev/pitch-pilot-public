/** Mutable playback clock shared by the 3D loop and the UI. Seconds from the start of the package. */
export interface Clock { t: number; playing: boolean; rate: number; }
export const makeClock = (): Clock => ({ t: 0, playing: false, rate: 1 });
