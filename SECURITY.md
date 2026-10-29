# Security policy

## Reporting a vulnerability

Please do not report exploitable vulnerabilities in a public issue. Contact the project maintainers privately through the repository's security advisory feature, or use the private contact channel listed by the repository owner.

Include the affected version, a concise impact description, and reproduction steps that do not expose real user data. Do not include credentials or private CAD/ECAD designs.

## Security notes

CADVoice is a static, local-first browser application. It has no application server, authentication system, or configured cloud model. Imported project files are parsed and structurally validated, but users should only open files from sources they trust. Generated code is for export and is not executed by the application.
