# Security contact

The build's default contact is `security@vowkey.com`, following the existing server domain. The owner chooses the live domain and mailbox; set `SITE_ORIGIN` and `SECURITY_CONTACT` when running `node scripts/build-site.mjs` in `vowkey-growth`. The generated `site/.well-known/security.txt` publishes the contact, launch languages, policy and an expiry one calendar year out. `scripts/check-security-txt.sh` fails when fewer than 60 days remain. Run that check daily, and rebuild to renew after confirming the mailbox is still monitored.

The inbox is not created by this repo. Create it where the domain's mail is hosted, give it to the people who can ship a fix, and confirm a message from outside arrives. The disclosure page promises a reply in 3 days, an assessment in 10, and a fix or a mitigation aimed at 90. Those clocks start when the inbox is read, so the mailbox needs a person, not a filter that files it as bulk.

There is no paid bounty and no commissioned audit. Do not add either to the security page until the owner has actually opened one. A report is answered from this inbox either way.

## Private vulnerability reporting on GitHub

Turn this on for each public Vowkey repository. GitHub keeps the initial report private to repository maintainers and invited collaborators. Configure GitHub security notifications for the people monitoring the security inbox; an email address printed on the site does not subscribe it to GitHub reports.

1. Open the repository, then Settings, then Advanced Security (Code security and analysis on older GitHub).
2. Under Private vulnerability reporting, choose Enable. The button is available to an admin of a public repository.
3. Repeat for the other public repositories. A fork does not inherit the setting from the repository it was forked from.
4. Test the Report a vulnerability entry on the repository's Security tab from a second account. Confirm maintainers receive the notification and can read the report. Close the test without publishing an advisory.
5. Give the responder the least GitHub role that permits the needed advisory work; do not grant repository admin merely to receive mail. Keep one owner able to change the reporting setting.

To close one, reply in the thread, publish a fix, and ask GitHub to disclose only when the fix is out. The disclosure page already tells a reporter they may publish after the fix, or after 90 days.

References: [privately reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability), [configuring reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository).
