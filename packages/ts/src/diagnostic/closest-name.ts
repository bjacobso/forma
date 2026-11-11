/** Rank names by edit distance, breaking ties consistently by spelling. */
export function nearestNames(name: string, candidates: readonly string[]): readonly {name: string; distance: number}[] {
  const distance = (other: string) => {
    let row = Array.from({length: other.length + 1}, (_, i) => i);
    for (let i = 1; i <= name.length; i++) {
      const next = [i];
      for (let j = 1; j <= other.length; j++) next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (name[i - 1] === other[j - 1] ? 0 : 1));
      row = next;
    }
    return row[other.length]!;
  };
  return [...new Set(candidates)].map(name => ({name, distance: distance(name)}))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}

/** Suggest a nearby name without making unrelated names look like corrections. */
export function closestName(name: string, candidates: readonly string[]): string | undefined {
  const best = nearestNames(name, candidates)[0];
  return best && best.distance <= Math.max(2, Math.floor(Math.max(name.length, best.name.length) / 3)) ? best.name : undefined;
}
