# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/donglin3800/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/donglin3800/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster, drop-in replacement for makefun-diff 1.0.0, make.fun's own line diff: byte-identical output on the practice set (4/4 cases), about twice as fast as the house baseline on this machine. Hand-written in one session: lines are interned to small integer ids, the Myers search keeps only integer x positions in one flat, reused Int32Array trace (no per-step path objects), and the edit script is recovered by walking that trace backwards, with the vendor's exact tie-break (deletion preferred on a tie, no edge pruning, snakes followed to the end).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=frrbny3y&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
