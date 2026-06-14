export function clampCoverPosition(position) {
  return Math.round(Math.max(0, Math.min(100, Number(position) || 0)));
}

export function coverPositionFromDrag(startPosition, deltaY, coverHeight) {
  if (!Number.isFinite(coverHeight) || coverHeight <= 0) {
    return clampCoverPosition(startPosition);
  }
  return clampCoverPosition(startPosition - (deltaY / coverHeight) * 100);
}
