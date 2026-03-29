const SPEED_MULTIPLIER = 2

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms / SPEED_MULTIPLIER))
}
