/**
 * Decimal rounding that is immune to binary floating-point artefacts (e.g. 1.005 → 1.01).
 * Shifting by a decimal exponent in the string form avoids 1.005 * 100 = 100.49999….
 */
function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const shifted = Math.round(Number(`${Math.abs(value)}e${digits}`));
  return sign * Number(`${shifted}e-${digits}`);
}

/** Money is kept in rupees with 2 decimal places (paise), rounding half away from zero. */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

/** Volumes are kept at 6 decimal places (cm³ resolution). */
export function roundVolume(value: number): number {
  return roundTo(value, 6);
}
