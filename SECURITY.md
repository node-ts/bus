# Security policy

## Reporting a vulnerability

Please don't report security vulnerabilities in public issues, discussions or pull requests.

Report them privately through GitHub instead: on the repo's **Security** tab, click **Report a vulnerability**, or go straight to [the new advisory form](https://github.com/node-ts/bus/security/advisories/new). Only you and the maintainers can see the report. There's no email address for security reports.

Include as much of this as you can:

- the affected package or packages, and their versions
- what the vulnerability is and what an attacker could do with it
- steps to reproduce it, or a proof of concept
- a suggested fix, if you have one

## What happens next

- The maintainer looks at reports as time allows. There's no guaranteed response or fix time.
- If the report is confirmed, the fix is worked on in the advisory's private fork and released as a new version of each affected package. The advisory is then published, with a CVE where one applies, and credits you unless you'd rather not be named.
- If the report is declined, the reason is given in the advisory.
- Please allow a reasonable time for a fix to be released before you disclose the vulnerability publicly.

## Supported versions

Fixes are made on `master` and released in the next version of the affected `@node-ts/bus-*` packages. Older release lines aren't patched: once 2.0 is released, 1.x and earlier don't get security fixes.

## Scope

This policy covers the packages in this repository. Report a vulnerability in one of their dependencies to that dependency's maintainers. Once there's an advisory and a fixed version, Renovate opens a PR here to update it, without waiting for its weekly schedule.
