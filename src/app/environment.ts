/** Runtime configuration served by each stage at /config.json (written by CDK). */
export interface RuntimeConfig {
  /** Base URL for the API Gateway endpoint (no trailing slash). */
  apiUrl: string;
  /** Cognito User Pool ID. */
  cognitoUserPoolId: string;
  /** Cognito User Pool Client ID. */
  cognitoUserPoolClientId: string;
  /** AWS region for Cognito. */
  cognitoRegion: string;
}

/**
 * Populated at startup from /config.json (see runtime-config.ts). Empty until then.
 * Local dev: copy public/config.example.json to public/config.json (gitignored) and fill
 * in the dev stack outputs.
 */
export const environment: RuntimeConfig = {
  apiUrl: '',
  cognitoUserPoolId: '',
  cognitoUserPoolClientId: '',
  cognitoRegion: '',
};
