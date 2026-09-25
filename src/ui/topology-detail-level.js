const OVERVIEW_MAX_SCALE = 0.6;
const COMPACT_MAX_SCALE = 0.85;

export function topologyDetailLevel(scale) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Topology scale must be finite and positive");
  }
  if (scale < OVERVIEW_MAX_SCALE) {
    return "overview";
  }
  if (scale < COMPACT_MAX_SCALE) {
    return "compact";
  }
  return "detailed";
}
