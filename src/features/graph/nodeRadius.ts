export const MIN_RADIUS = 3;
export const MAX_RADIUS = 14;

/**
 * A node's drawn radius, from its degree.
 *
 * `√degree`, so AREA scales with degree rather than radius — a linear radius
 * turns a 14-link hub into a blob that eats its own neighbourhood.
 *
 * Shared by `layoutGraph` (as the collision radius) and `GraphCanvas` (as the
 * drawn one) on purpose: if they disagree, nodes either overlap or float in
 * gaps the size of the difference.
 */
export function nodeRadius(degree: number): number {
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(degree) * 2.2);
}
