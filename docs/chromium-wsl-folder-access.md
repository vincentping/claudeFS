# Chromium blocking WSL folder access (issue 573422635)

- Issue: https://issues.chromium.org/issues/573422635 (Fixed, Verified)
- Root cause: https://issues.chromium.org/issues/553114097 (CVE-2026-103626)
- Recorded: 2026-11-04

## Timeline

| Date | Event |
|---|---|
| Early Oct 2026 | Chrome M155 (CL 8341352, `bc5a321c`) fixed 553114097 by blocking every path under `\\wsl.localhost\` and `\\wsl$\`. `showDirectoryPicker()` shows "Can't open this folder / contains system files" and rejects with `AbortError`. Edge is affected too. |
| 2026-10-14 | Filed 573422635, proposing that ordinary subfolders under the WSL home directory be allowed again. |
| Mid Oct 2026 | Google's first two reproduction attempts failed: the first test folder was created on a Windows drive, and the second report said "no error" although the recording showed the error. After a point-by-point reply, Google reproduced the bug, bisected it to `bc5a321c`, marked it as an M158 release blocker and raised it to P0. |
| 2026-10-29 | Fix landed on main: CL 8669680, `23722d5c`, "[FSA] Allow subfolders of WSL home directories". |
| 2026-10-30 – 11-02 | Merged to M158 (branch 8127), M156 (8078) and M157 (8103). |
| 2026-11-02 – 11-04 | Google verified the fix in 156.0.8078.88, 157.0.8103.41, 158.0.8127.18 and 159.0.8132.0. |
| 2026-11-04 | Verified locally: claudeFS connects to a WSL project folder in Chrome 157.0.8103.39. |

## Rules after the fix

Allowed: `\\wsl.localhost\<distro>\home\<user>\<child>\...`

Still blocked:
- The home directory itself (`\\wsl.localhost\<distro>\home\<user>`)
- Every dot entry in the home directory (`.ssh`, `.config`, `.bashrc`, ...)
- `~/bin`
- The distribution root, `/home`, `/root`, system directories and `/mnt/*`
- The legacy `\\wsl$\` alias
- Paths containing `..`, or with names ending in a space or ` .`
- Allowed paths still go through the other rules; for example, writes to `.git/hooks` are blocked

The exemption is controlled by the `FileSystemAccessAllowWslHomeSubfolders` feature (enabled by default). Google can turn it off remotely through Finch, which would bring back the blanket block.

## Impact on claudeFS

- Projects must be in a subfolder under `\\wsl.localhost\<distro>\home\<user>\`, and the browser must be recent enough. For M156 that means 156.0.8078.88 or later; for M157, 157.0.8103.39 has been tested and works.
- Users who run WSL as root and keep projects under `/root` still cannot connect.
- Writes to `.git/hooks` fail. This is expected.
- Not yet confirmed: whether mapped drive letters (`net use W: \\wsl.localhost\Ubuntu`) are allowed, and when Edge picks up the fix.
- If a user reports that WSL folders fail again, check the browser version and whether the path uses `\\wsl$\`. After that, consider whether Google has turned the Finch feature off.
