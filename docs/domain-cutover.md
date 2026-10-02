# Domain cutover: wordstudy → axiostools (prod)

Move prod from `wordstudy.teksnextdoor.com` to `axiostools.teksnextdoor.com` without replacing any Route 53 record, certificate, or stateful resource. This is future work, done in its own PR after the pipeline is green. Dev already runs on `axiostools-dev.teksnextdoor.com` and does not change.

## 1. Prerequisites

- The pipeline is green: the last `deploy.yml` run deployed dev and prod and both smoke tests passed.
- A recent on-demand backup: `aws dynamodb create-backup --table-name WordStudies --backup-name pre-cutover-$(date +%F)`.

## 2. The PR

All changes are in `infra/lib/stage-config.ts` plus one small stack change. No existing record is replaced or renamed.

1. Prod `aliasRecords` gains one entry. `SiteAliasRecord` stays exactly as is, so its logical ID (`SiteAliasRecord3C0AF5BF`) and record do not change:

   ```ts
   aliasRecords: {
     SiteAliasRecord: 'wordstudy.teksnextdoor.com',   // unchanged
     AxiosAliasRecord: 'axiostools.teksnextdoor.com', // new
   },
   ```

   Dev keeps `{ SiteAliasRecord: 'axiostools-dev.teksnextdoor.com' }`.

2. Prod `siteDomain` becomes `axiostools.teksnextdoor.com` (the primary: first CORS origin and the `SiteUrl` output). Add `StageConfig.additionalDomains: string[]` (`['wordstudy.teksnextdoor.com']` for prod, `[]` for dev).
3. The distribution uses `domainNames: [config.siteDomain, ...config.additionalDomains]`. The existing `WildcardCert` (`*.teksnextdoor.com`) covers both hosts, so the certificate does not change.
4. CORS lists both origins, `https://axiostools.teksnextdoor.com` first: `allowedOrigins = [siteDomain, ...additionalDomains].map(d => \`https://${d}\`)`plus`extraAllowedOrigins`.

Why not rename `SiteAliasRecord` or change its hostname: a record-name change replaces the record. In the same update CloudFormation would create the new record before deleting the old one; for a reused name Route 53 rejects the duplicate and the stack rolls back. Keying records by construct ID in stage config means a hostname's record ID never changes.

### Expected `cdk diff`

- Prod (`WordStudyToolStack`):
  - 1 added `AWS::Route53::RecordSet` (`AxiosAliasRecord…`).
  - In-place modifications: distribution `Aliases`; API CORS (OPTIONS methods plus a new `AWS::ApiGateway::Deployment`, which is normal); the 3 Lambdas' `ALLOWED_ORIGINS`; `config.json` content is unchanged (the API URL does not change); `SiteUrl` output.
  - No replacement. The stateful guard passes.
  - Any change to `SiteAliasRecord3C0AF5BF` means stop.
- Dev (`WordStudyTool-Dev`): no changes.

## 3. Cognito impact

None on the user pool. The app uses SRP sign-in with no hosted UI or callback URLs, so accounts and `sub` values are unchanged and saved studies (keyed by `sub`) stay attached. Amplify keeps tokens in per-origin `localStorage`, so each user signs in once on the new domain. Tell users before the switch.

## 4. Soak, then redirect

Keep both hosts live for a few weeks. Then either keep the old alias indefinitely (zero cost) or add a CloudFront Function on the old host that returns a 301 to `https://axiostools.teksnextdoor.com` with the same path.

## 5. Rollback

Revert the PR. The diff is the mirror image: `AxiosAliasRecord` is removed and the CORS/aliases change back in place. `SiteAliasRecord` was never touched, so the old host keeps working throughout.

## 6. Verification checklist

- [ ] PR diff comment: guard ✅; prod shows only the changes listed above; dev shows no changes.
- [ ] After deploy: smoke test against both hosts (`bash scripts/ci/smoke-test.sh https://axiostools.teksnextdoor.com <ApiUrl>` and the same for `https://wordstudy.teksnextdoor.com`).
- [ ] Sign in on the new host and open an existing saved study.
