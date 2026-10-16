# Security policy

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Please include:

- a description of the issue and its impact;
- steps to reproduce, or a proof of concept;
- the version or commit you tested.

Konto is a personal project maintained in spare time: expect an acknowledgement within a couple of weeks. Once a fix is released, you'll be credited in the changelog unless you prefer otherwise.

## Scope

Konto is designed for a small group of trusted users on a private network (see [Security model](docs/security-model.md)). Reports are especially welcome about:

- one user accessing or modifying another user's data;
- authentication or session bypass;
- injection (SQL, XSS, CSV) or CSRF;
- secrets or personal data leaking through logs, exports or error messages.

Problems that need an attacker who already controls the server, its `.env` file or the instance owner's account are generally out of scope.
