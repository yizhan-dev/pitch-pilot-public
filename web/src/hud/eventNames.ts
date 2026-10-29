// The synced Opta event types as viewers read them (the UI is English only; the Chinese names were
// retired with the Chinese version), for the replay plate's lists and titles and the event toasts.
const EVENT_LABELS: Readonly<Record<string, string>> = {
  Pass: 'Pass', Carry: 'Carry', BallRecovery: 'Ball recovery', BallTouch: 'Touch', TakeOn: 'Take-on', Clearance: 'Clearance', Tackle: 'Tackle', Interception: 'Interception',
  MissedShots: 'Shot wide', SavedShot: 'Shot saved', Goal: 'Goal', Aerial: 'Aerial duel', Foul: 'Foul', Challenge: 'Challenge', Save: 'Save', BlockedPass: 'Pass blocked',
  Dispossessed: 'Dispossessed', KeeperPickup: 'Keeper pick-up', KeeperSweeper: 'Keeper sweeps', CornerAwarded: 'Corner', OffsideGiven: 'Offside', OffsidePass: 'Offside pass',
  'Offside provoked': 'Offside trap', Out: 'Out of play', 'Attempted tackle': 'Attempted tackle', 'Referee Drop Ball': 'Drop ball', 'Start delay': 'Stoppage', 'End delay': 'Play resumes',
  Card: 'Card', ShotOnPost: 'Hits the post', Start: 'Kick-off', SubstitutionOff: 'Sub off', SubstitutionOn: 'Sub on', 'Injury Time Announcement': 'Added time',
  PenaltyFaced: 'Penalty faced', 'Shield ball opp': 'Shields it out', EventType84: 'Other',
};

/** an event type's caption, or the type itself when it has none */
export const eventLabel = (type: string) => EVENT_LABELS[type] ?? type;
