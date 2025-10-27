# Security Policy

## Reporting a Vulnerability

Keeping user information safe and secure is a top priority and a core company value for us at Deepnote. We welcome the contribution of external security researchers and look forward to awarding them for their invaluable contribution to the security of all Deepnote users.

### Contact

If you discover a security vulnerability, please report it to:

- **Email**: security@deepnote.com
- **PGP Key**: https://deepnote.com/.well-known/pgp-key.txt

### Security Acknowledgments

We maintain a list of security researchers who have helped us improve our security:

- **Acknowledgments**: https://deepnote.com/.well-known/acknowledgments.txt

## Bug Bounty Program

### Rewards

Rewards are decided on a case-by-case basis based on impact, attack requirements and complexity, and the report's quality. The following table shows reward ranges based on severity along with example classes:

| Severity | Reward                   | Example                       |
| -------- | ------------------------ | ----------------------------- |
| Critical | $500 - $1000             | RCE, Unrestricted data access |
| High     | $250 - $500              | Stored XSS, IDOR              |
| Medium   | $100 - $250              | Reflected XSS, CSRF           |
| Low      | $0 (acknowledgment only) | Minor/best-practice issues    |

Higher rewards (potentially outside of the range) will be awarded to unique, unusually severe, or hard-to-find bugs. Vulnerabilities that require significant user interaction or have complex prerequisites might be awarded lower rewards. Theoretical vulnerabilities and missing best practices are not eligible for rewards.

### Demonstrating Impact

It is important to prove the impact of your finding as much as possible. When demonstrating the impact, please bear in mind some of our defense in depth measures:

- SSRF without access to Google metadata should have a very limited impact in our environment as we try to keep zero trust in our internal network.
- We use UUIDs as identifiers everywhere instead of sequential IDs, so the impact of any IDORs or CSRFs should be significantly reduced.
- RCE on the container that is designed for you to execute code is not considered a vulnerability.

If you are able to find a counter-example for any those defense in-depth measures, your bounty will be increased accordingly.

Our focus is on unauthorized access to user data. Logic bugs that allow an attacker to bypass limits on free accounts and get access to premium features are not something we prioritize and nor are they eligible for a bounty.

## Eligibility and Responsible Disclosure

To promote the discovery and reporting of vulnerabilities and increase user safety, we ask that you:

- Please be respectful of our applications. Spamming project creation and similar DoS issues will not result in any bounty or award since those are explicitly out of scope.
- Give us a reasonable time to respond to the issue before making any information about it public.
- Do not access or modify our data or our users' data without the explicit permission of the owner. Only interact with your own accounts or test accounts for security research purposes.
- Contact us immediately if you do inadvertently encounter user data. Do not view, alter, save, store, transfer, or otherwise access the data, and immediately purge any local information upon reporting the vulnerability to Deepnote.
- Act in good faith to avoid privacy violations, destruction of data, and interruption or degradation of our services (including denial of service).

We only reward the first reporter of a vulnerability. Public disclosure of the vulnerability prior to resolution will cancel a pending reward. We reserve the right to disqualify individuals from the program for disrespectful or disruptive behavior. We will not negotiate in response to duress or threats (e.g., we will not negotiate the payout amount under threat of withholding the vulnerability or threat of releasing the vulnerability or any exposed data to the public).

## Out-of-scope Vulnerabilities

The following issues are outside the scope of our rewards program:

- We are temporarily not accepting any reports of PII disclosure
- Any form of DoS
- Hyperlink execution or tabnabbing issues without significant impact
- Our policies on the presence/absence of SPF/DMARC records
- Password, email, and account policies, such as email id verification or reset link expiration
- Lack of CSRF tokens (unless there is evidence of actual exploitable CSRF)
- Login/logout CSRF
- Attacks requiring physical access to a user's device
- Missing best practices (we require evidence of a security vulnerability)
- Hosting malware/arbitrary content on Deepnote and causing downloads
- Self-XSS (we require evidence on how the XSS can be used to attack another Deepnote user)
- Host header injections unless you can show how they can lead to stealing user data
- Use of a known-vulnerable library (without evidence of exploitability)
- Reports from automated tools or scans
- Reports of spam (i.e., any report involving the ability to send emails without rate-limits)
- Vulnerabilities affecting users of outdated browsers or platforms
- Social engineering of Deepnote employees or contractors
- Any physical attempts against Deepnote property
- Presence of autocomplete attribute on web forms
- Missing cookie flags on non-sensitive cookies
- Reports of insecure SSL/TLS ciphers (unless you have a working proof of concept and not just a report from a scanner)
- Any report that discusses how you can learn whether a given username or an email address has a Deepnote account
- Email configuration issues (e.g. Spoofing vulnerabilities)
- Absence of rate-limiting, unless related to authentication
- Reflected File Download vulnerabilities or any vulnerabilities that let you start a download to the user's computer are out of scope
- IP/Port Scanning via Deepnote services unless you are able to hit private IPs or Deepnote servers
- Hyperlink injection or any link injection in emails we send
- Any 0-day vulnerabilities in third party applications/software and for 30 day period after vulnerability is fixed
- The community.deepnote.com domain, which is managed by a 3rd party vendor. We are happy to raise the issues with the vendor with your approval

## The Fine Print

Please note that to be eligible for a reward, you must provide an invoice for a given amount to us. You are responsible for paying any taxes associated with rewards. We may modify the terms of this program or terminate this program at any time. We won't apply any changes we make to these program terms retroactively. Reports from individuals who we are prohibited by law from paying are ineligible for rewards. Deepnote employees and their family members are not eligible for bounties.

In order to encourage the adoption of bug bounty programs and promote uniform security best practices across the industry, Deepnote reserves no rights in this bug bounty policy, and so you are free to copy and modify it for your own purposes. This policy was inspired by the policy of Dropbox (https://hackerone.com/dropbox).

This is v3.2 of the policy, valid as of 27/July/2022.

## Additional Resources

- **Hiring**: https://www.deepnote.com/work
- **Policy Expires**: 2026-02-24T23:59:59Z
