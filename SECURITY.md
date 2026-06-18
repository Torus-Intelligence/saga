# Security

Report suspected vulnerabilities privately through GitHub security advisories
for this repository.

Do not open a public issue for:

- credential exposure;
- command injection;
- unsafe filesystem writes;
- unsafe outcome-adapter behavior;
- remote-code execution concerns;
- private data leakage from fixtures, trajectories, or persona sources.

Saga fixtures and trajectory files can contain application data. Treat them as
test artifacts and scrub sensitive content before sharing them publicly.
