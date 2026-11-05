# Paxones legal and policy production review

Review basis: local source files in the Paxones repository, read on 4 November 2026.
Scope: source-text review only. This is not legal advice, jurisdictional clearance, or a regulatory classification.

## Documents inspected

- `src/app/terms/page.tsx` — Terms of Service, 616 lines, 67 numbered sections.
- `src/app/policy/page.tsx` — Privacy Notice.
- `src/app/privacy/page.tsx` — re-exports the Privacy Notice.

Both visible documents state an effective date of 1 January 2026 and a last-updated date of 9 September 2026. The privacy route is an alias of the policy page, not a distinct document.

## Findings requiring owner/legal sign-off

### 1. Operator identity and jurisdiction — launch blocker

The public documents refer to “Paxones” as the platform/service, but the inspected text does not provide a complete legal-operator identity, registration number, registered address, or a definite governing-law and competent-courts clause.

Required owner input:
- Full legal entity name (or the natural person/business legally operating the service).
- Place of incorporation/registration, registration number and registered office.
- Service and complaint contact details, including a monitored legal/privacy contact.
- Governing law, exclusive/non-exclusive courts, and dispute escalation approach.
- Countries/regions in which onboarding, custody, deposits, withdrawals and P2P activity are actually offered or prohibited.

Do not publish a guessed country, legal entity, licence number, regulator, address, or court.

### 2. Custody and money-flow disclosures — launch blocker

The Terms describe hosted/custodial wallet addresses, deposits, withdrawals, transfers, escrow locks and releases. They also state that Paxones is generally not the buyer or seller in P2P trades. Those statements need to match the real custody/control model.

Required owner/legal confirmation:
- Who controls private keys and can initiate withdrawals or sweeps.
- Whether assets are pooled, segregated, held in omnibus wallets, or held in user-specific wallets.
- How client assets are segregated from operating funds and what happens if the operator becomes insolvent.
- Whether Paxones acts as custodian, escrow agent/technical intermediary, broker, marketplace, payment service or another regulated role in each market.
- Who bears loss from chain congestion, failed/ambiguous broadcasts, bridge/token-contract errors, compromised keys, reorgs and provider outages.
- Exact escrow release/refund conditions, dispute handling, evidence review, time limits and appeal route.

### 3. AML, sanctions and financial-crime controls — launch blocker

The Privacy Notice says information may be used to detect suspicious activity and meet KYC/AML requirements. The inspected public text does not identify the actual programme or its geographic scope.

Required owner/legal confirmation:
- Whether AML/KYC obligations apply to the operator and in which jurisdictions.
- Risk-based customer due diligence, enhanced due diligence, sanctions/PEP screening, wallet/address screening and ongoing monitoring policies.
- Suspicious-activity escalation/reporting responsibility and lawful disclosure procedures.
- Restricted countries, prohibited persons, prohibited assets, and escalation/appeal handling.
- Merchant onboarding, source-of-funds checks, transaction monitoring thresholds and record retention.
- Do not claim a licence, registration, AML approval or regulatory supervision unless independently verified.

### 4. Privacy controller and contact details — launch blocker

The Privacy Notice lists a broad range of personal, identity, biometric, KYC, profile, wallet, transaction, trade-chat and attachment data. Its Data Controller section says the controller's identity and contact details may be provided through services or upon request; it does not identify a named controller in the inspected text.

Required owner input:
- Named controller and contact address/email.
- Privacy/DPO contact where legally required.
- Data-protection complaint process and relevant supervisory authority, based on actual establishment and user markets.
- Data processors/sub-processors (identity provider, cloud/database, object storage, email, analytics, support and hosting), their purposes and transfer locations.
- Applicable international-transfer mechanism and user-facing explanation where required.

### 5. Data retention and deletion schedule — launch blocker

The Privacy Notice gives a broad “as long as reasonably necessary” retention statement and explains that some records may remain after account closure. It does not provide a concrete category-by-category retention schedule in the inspected text.

Required owner/legal input:
- Retention periods or objective criteria for identity documents, biometric/liveness results, KYC decisions, addresses, user profiles, support records, trade messages, trade attachments, dispute evidence, financial ledgers, security logs and marketing/analytics data.
- Account closure/deletion workflow, legal holds, deletion exceptions and user notification.
- Backups, replicas, object-storage versions, signed URLs, cached media and third-party processor deletion.
- Public blockchain data is immutable; explain that deleting a Paxones account cannot remove on-chain records.
- Minimise storing raw ID/document numbers and security answers; ensure no plaintext secrets or unnecessary identity payloads enter logs.

### 6. Biometric and identity processing

The Terms and Privacy Notice refer to facial/identity-verification images, liveness and other identity-verification information. Before launch, verify:
- Which provider handles each biometric/KYC action and the exact data categories sent.
- Whether biometric data is processed as sensitive/special-category data under each applicable law.
- Required notice, legal basis/consent, retention/deletion, subprocessors and cross-border transfer safeguards.
- Human review, false rejection/appeal route and a process for users who cannot complete a particular verification method.

### 7. Fees, limits, reversals and dispute service levels

The Terms discuss fee disclosure, refunds, chargebacks, payment reversals and limits, but ensure the public wording matches the live product configuration and actual database-enforced fees/limits:
- P2P fee and who pays it.
- Internal-transfer fee and net amount.
- Withdrawal network fee, platform fee, gas-funding cost and fee-change rules.
- Minimums, maximums, daily/rolling limits, KYC tiers, administrative approval thresholds and holds.
- Whether off-chain internal transfers, on-chain withdrawals and escrow transfers can be reversed.
- Evidence deadlines, dispute response times, finality, appeal process and consequences of bank/payment reversals.

### 8. Date and version management

Both documents still show “Last Updated: September 9, 2026” in a review performed on November 4, 2026. Do not change the date merely to make the page look current. Change it only after counsel/owner approves substantive content, and preserve a version/effective-date history and user notice where required.

## No automatic legal edits made

No governing law, company name, licence, regulator, jurisdiction, retention period, privacy contact, complaint deadline or custody promise has been invented or inserted. The current files should be reviewed and approved by qualified counsel for the actual operator and its intended markets before enabling launch.
