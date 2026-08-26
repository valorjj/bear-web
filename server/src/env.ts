export interface Env {
  appOrigin: string;
  apiOrigin: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  pdfRendererUrl: string;
  /**
   * Where image bytes are written.
   *
   * A real filesystem path on the host, NOT a Docker volume: the API runs as a
   * launchd service (`com.markflowing.api`) and only MariaDB and the PDF
   * renderer are containers. Two constraints follow, and both have bitten this
   * project before:
   *
   * - It must live OUTSIDE the repo, or a `git clean` throws away every image.
   * - It must not be under `~/Documents`, `~/Desktop` or `~/Downloads`. Those
   *   are TCC-protected, and a launchd job reading one does not fail — it
   *   HANGS, forever, with an empty log (CLAUDE.md).
   *
   * Defaulted so local development needs no configuration to boot.
   */
  imageRoot: string;
}

type Source = Record<string, string | undefined>;

function require_(source: Source, key: string): string {
  const value = source[key];
  if (value === undefined || value === '') throw new Error(`missing env: ${key}`);
  return value;
}

/**
 * Validates the whole environment once, at boot.
 *
 * Every value is read here rather than at its point of use, so a
 * misconfiguration is a startup failure naming the key instead of a runtime
 * failure inside an OAuth callback, where the only visible symptom is a
 * provider error page the user cannot act on.
 */
export function readEnv(source: Source): Env {
  return {
    appOrigin: require_(source, 'APP_ORIGIN'),
    apiOrigin: require_(source, 'API_ORIGIN'),
    databaseUrl: require_(source, 'DATABASE_URL'),
    googleClientId: require_(source, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: require_(source, 'GOOGLE_CLIENT_SECRET'),
    pdfRendererUrl: require_(source, 'PDF_RENDERER_URL'),
    imageRoot: source.IMAGE_ROOT ?? './data/images',
  };
}
