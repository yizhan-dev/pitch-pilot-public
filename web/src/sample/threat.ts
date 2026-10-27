/** An illustrative surface made from a formula, not from match data or training.
 * It exists so the public source can exercise grid lookup and move accounting.
 * Its values are not calibrated scoring probabilities and must not be presented
 * as the production model's expected threat.
 */
export const sampleThreatGrid = Array.from({ length: 12 }, (_, row) =>
  Array.from({ length: 16 }, (_, col) =>
    0.01 + 0.02 * (col / 15) ** 2 * (1 - 0.5 * Math.abs((row - 5.5) / 5.5))));
