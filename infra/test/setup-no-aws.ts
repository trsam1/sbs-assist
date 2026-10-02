/**
 * Runs before every infra test file. No test may reach AWS (Bedrock in particular):
 * drop any real credential sources and point the SDK at a dead local endpoint, so an
 * unmocked call fails fast with "connection refused" instead of using real keys.
 */
for (const name of ['AWS_PROFILE', 'AWS_SESSION_TOKEN', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ROLE_ARN']) {
  delete process.env[name];
}
process.env['AWS_ACCESS_KEY_ID'] = 'test-not-real';
process.env['AWS_SECRET_ACCESS_KEY'] = 'test-not-real';
process.env['AWS_REGION'] = 'us-east-1';
process.env['AWS_EC2_METADATA_DISABLED'] = 'true';
process.env['AWS_ENDPOINT_URL'] = 'http://127.0.0.1:9';
