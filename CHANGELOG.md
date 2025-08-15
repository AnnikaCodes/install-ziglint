## 0.1.7
- Use Zig version 0.14.1 to support ziglint 0.0.8.
## 0.1.6
- Cleans up better after building from source.
- Improves Windows compatibility.
## 0.1.5
- Now tries to build `ziglint` from source code if a release cannot be found.
## 0.1.4
- Another attempt to fix the `tool-cache` bug.
## 0.1.3
- A bug with `tool-cache` has been fixed
## 0.1.2
- Downloaded binaries are now cached in GitHub Actions. If the GitHub API is rate limited, it will use any cached version.
## 0.1.1
- API rate-limiting issues have been mitigated.
## 0.1.0
This is the first version of the `AnnikaCodes/install-ziglint` GitHub Action. It can install the latest version of `ziglint` under a user-specified a name.
