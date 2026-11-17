# Security reports

Do not include credentials, personal databases, resumes or inbox bodies in public issues. For a security vulnerability, use [private vulnerability reporting](https://github.com/VioletN22/aplyd-community/security/advisories/new). Describe the issue without posting exploit details or personal data publicly.

The current community prerelease is the supported version. Review fixes before upgrading a provider CLI beyond the documented adapter version. Integration code must not scrape login tokens, fall back to plaintext credential storage or allow untrusted email/job text to execute shell commands.

The source hygiene script is a release check, not a general secret scanner or guarantee. If a real secret is ever committed, revoke it at its provider; deleting the file is insufficient.
