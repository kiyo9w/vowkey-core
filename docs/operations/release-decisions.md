# Release decisions

The implementation supports local verification without settling these commercial and publication choices. Set the chosen values before enabling the corresponding public service.

| Decision | Current implementation | Owner action |
| --- | --- | --- |
| Legal seller | Provider-neutral billing with a Paddle adapter | Confirm Paddle eligibility and payouts in writing, or choose another seller structure before accepting money |
| App consent wording | Separate usage-count and crash-report switches, both initially off | Approve the final consent and legal wording |
| iPhone identity choices | Apple provider implemented beside configurable Google sign-in | Choose whether iPhone presents Apple and Google or email/password only; provision the real Apple identifiers and key for the enabled path |
| Domain | Hosts and site origin are configuration; defaults follow `vowkey.com` | Choose the product domain, provision mailboxes and publish its DNS |
| Independent audit | Public security description and disclosure policy; no commissioned audit or paid bounty is claimed | Choose an audit budget and commission the review before publishing an audit claim |
| Prices and paid allowance | Paddle catalog owns monetary amounts; base daily allowances and a separate monthly Hosted Agent bucket are implemented | Approve plans, allowance quantities, billing intervals and credit packs, then configure real catalog price ids |

Legal payment/refund text remains a draft until the seller, consent wording and domain are chosen. Existing drafts are preserved rather than filled with an invented company, address or approval.

## Independent audit scope

Request quotes for Vowkey's changes relative to its pinned Bitwarden/Vaultwarden bases: accountless key custody and attachment migration; passkey wrapping and assertion lifecycle; Apple and enterprise identity callbacks; trusted-device approvals and SCIM authorization; local agent references, destination policies and fills; Decision relay payload boundaries; billing entitlement enforcement; and opt-in measurement/crash reduction.

Give the auditor the source revisions, build instructions and a disposable deployment with synthetic vaults. Agree the report publication and remediation review in the engagement. Publish the resulting report and the exact reviewed revisions on the security page after the audit is complete. Existing upstream reports remain upstream reports, not evidence that Vowkey's modifications were independently reviewed.

## External actions

The owner creates vendor/store accounts, signing identities, mail and push credentials, the production VM, DNS, Better Stack monitors, affiliate campaigns and Search Console properties. The service runbooks name their required values. Local mocks, signed fixture webhooks and simulator notifications do not substitute for a vendor inbox delivery, a real phone push, an Apple identity callback or a Paddle sandbox purchase; record those separately when their credentials are available.
