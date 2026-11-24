# Plans and admin grants

The server computes what an account may use from its subscription rows. A person uses their own rows for personal items. An organization uses its own rows for organization items, seats, single sign-on, directory sync and trusted-device approval.

Office is available only when the organization's base plan is `office` and enterprise single sign-on is configured. A personal account never receives it from an organization membership.

## Decision allowances

The base plan carries the daily Decision allowance: Free 300, Family 1,000, and Business 5,000 requests per UTC day. The Hosted Agent add-on carries a separate monthly allowance: 3,000 requests per month per pack, at the starter default quantity in code. The monthly bucket never adds to the daily one. A request spends the daily allowance first, then the monthly Hosted Agent allowance, then purchased credits. The daily bucket resets each UTC day, the monthly bucket resets each UTC month, and neither rollover spends purchased credits. Cancelling the Hosted Agent add-on removes the unused monthly entitlement; purchased credits remain. `GET /api/billing/entitlement` sends both `decisionPerDay` and `decisionPerMonth`, with `usedToday` and `usedThisMonth`.

## Granting a plan without payment

The admin panel shows the current plan on each user and organization. Grant plan writes one row with no payment provider:

- One admin-granted base plan is active for an owner. Granting another replaces that row.
- Extra storage and hosted agent are added beside the base plan. Granting the same add-on again updates its quantity.
- A subscription created by the payment provider is left unchanged. The grant does not record a payment.
- Business belongs to an organization. Use trialing for a free adoption and active when the grant should count immediately.
- Quantity is the seat count for Business. For extra storage and hosted agent it is the number of packs.

The same action is `POST /admin/users/<id>/plan` or `POST /admin/organizations/<id>/plan`, with the admin session and `{"plan_code","quantity","status"}`. `status` is `active` or `trialing`.
