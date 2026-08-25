export interface Env {
  appOrigin: string;
  apiOrigin: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  pdfRendererUrl: string;
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
  };
}
