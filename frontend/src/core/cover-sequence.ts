/** A full-library shuffle, without repeats until every candidate has had a turn. */
export function coverSequence(ids: readonly string[], last = '', random = Math.random) {
  const source = [...new Set(ids)];
  let remaining: string[] = [];
  return (excluded: ReadonlySet<string> = new Set(), displayed = last): string | undefined => {
    const eligible = source.filter(id => !excluded.has(id));
    if (!eligible.length) return;
    remaining = remaining.filter(id => !excluded.has(id));
    if (!remaining.length) {
      remaining = [...eligible];
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      // The next draw is from the end. Avoid a repeat at a cycle boundary.
      if (remaining.length > 1 && remaining.at(-1) === displayed) {
        const j = Math.floor(random() * (remaining.length - 1));
        [remaining[j], remaining[remaining.length - 1]] = [remaining[remaining.length - 1], remaining[j]];
      }
    }
    last = remaining.pop()!;
    return last;
  };
}
