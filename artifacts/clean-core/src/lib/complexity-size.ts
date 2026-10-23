/** Single source for displayed/exported complexity. Raw engine metrics stay untouched. */
export type ComplexitySize = "XS" | "S" | "M" | "L" | "XL" | "XXL";
export const COMPLEXITY_SIZES: ComplexitySize[] = ["XS", "S", "M", "L", "XL", "XXL"];
export const UNASSESSED = "Unassessed";

/** XS <=5, S <=10, M <=20, L <=30, XL <=40, XXL >40. Explicit sizes are respected; anything else is null. */
export function complexitySize(value: unknown): ComplexitySize | null {
  if (typeof value === "string") {
    const s = value.trim().toUpperCase();
    // Only known sizes (case-insensitive); numeric strings are invalid, matching the backend.
    return (COMPLEXITY_SIZES as string[]).includes(s) ? s as ComplexitySize : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value <= 5) return "XS";
  if (value <= 10) return "S";
  if (value <= 20) return "M";
  if (value <= 30) return "L";
  if (value <= 40) return "XL";
  return "XXL";
}
export function complexityLabel(value: unknown): string { return complexitySize(value) ?? UNASSESSED; }

/** Engine-emitted complexitySize wins (explicit null = unassessed); legacy numeric only when the property is absent. */
export function itemComplexitySize(item: any): ComplexitySize | null {
  if (item && Object.prototype.hasOwnProperty.call(item, "complexitySize")) return complexitySize(item.complexitySize);
  return complexitySize(item?.complexity);
}
export function itemComplexityLabel(item: any): string { return itemComplexitySize(item) ?? UNASSESSED; }
