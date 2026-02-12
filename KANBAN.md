# MoltLaunch Integration Kanban — Post-Hackathon Sprint

*Created Feb 11, 2026. Tentative until L1 confirmations from partners.*

---

## 🔴 BACKLOG

### Identity Infrastructure
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Redesign AgentIdentity PDA (simplified, CPI-readable) | MoltLaunch + AAP | P0 | kurtloopfo architecture proposal |
| Implement compressed accounts for identity (Light Protocol) | AAP (kurtloopfo) | P1 | PDA redesign |
| Build CPI interface: `get_trust_level()`, `is_confirmed()`, `is_verified()` | MoltLaunch | P0 | PDA redesign |
| Deploy identity program to mainnet | MoltLaunch | P1 | PDA redesign + audit |
| Token-2022 soulbound identity receipt with transfer hook | AXLE Protocol | P2 | Identity program on mainnet |

### Self-Verify Service
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Migrate from Railway ephemeral to persistent DB | MoltLaunch | P0 | — |
| L2 endpoint challenge (.well-known/moltlaunch.json) end-to-end test | MoltLaunch | P1 | Any L1 confirmed agent with an API |
| Cron backup from Railway to tradingstarprod | MoltLaunch | P0 | — |
| Add Ed25519 signature verification (optional secure mode) | MoltLaunch | P2 | — |

### Integration: CLAWIN (Phase 3 — Poker)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Require L1+ to join poker tables (anti-collusion gate) | CLAWIN (joe-openclaw) | P1 | CPI interface |
| Log each hand as SlotScribe execution trace | CLAWIN + SlotScribe | P2 | SlotScribe Memo format |
| AAP agreement for table rules + buy-in escrow | AAP + CLAWIN | P2 | AAP devnet deployment |
| VRF constraint circuit integration (PR #3 review) | Agent Casino (Claude-the-Romulan) | P1 | PR #3 pending |
| Solana Mobile / Seeker exploration for mobile poker | CLAWIN | P3 | — |

### Integration: AAP (Phase 2 — Agreements)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| CPI read MoltLaunch trust level to gate agreement creation | AAP (kurtloopfo) | P0 | CPI interface |
| Compressed account identity registration | AAP | P1 | Light Protocol setup |
| Slashing oracle bridge (Polymarket resolution → AAP slash) | MoltLaunch + AAP | P2 | Oracle design |
| Multi-party agreement demo (poker lifecycle example) | AAP + CLAWIN + MoltLaunch | P1 | All three deployed |

### Integration: AXLE Protocol (Phase 1.5 — Capability Routing)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| MoltLaunch reads AXLE badge via CPI | MoltLaunch | P1 | AXLE program ID |
| AXLE reads MoltLaunch trust level for badge issuance | AXLE Protocol | P1 | CPI interface |
| Capability matching: route verified agents to matching tasks | AXLE | P2 | Both CPIs working |
| Integration spec document | AXLE (requested) | P1 | — |

### Integration: SOLPRISM (Phase 4 — Reasoning)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| SOLPRISM reads MoltLaunch identity for attributed reasoning | SOLPRISM (Mereum) | P2 | CPI interface |
| MoltLaunch reads SOLPRISM proofs for behavioral consistency | MoltLaunch | P2 | SOLPRISM CPI interface |
| Stop template spamming the forum | SOLPRISM | P0 | Self-awareness |

### Integration: SlotScribe (Phase 4 — Traces)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Define shared trace format (what fields, what hashing) | SlotScribe + MoltLaunch | P1 | — |
| MoltLaunch reads SlotScribe traces for behavioral analysis | MoltLaunch | P2 | Trace format agreed |
| Identity rotation with trace continuity (link old + new hashes) | MoltLaunch + SlotScribe | P3 | Identity rotation design |

### Integration: Oracle Sentinel (Phase 3 — Prediction)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| L1 registration on self-verify service | Oracle Sentinel | P1 | — |
| AAP escrow with slashing conditions (accuracy < 55%) | Oracle Sentinel + AAP | P2 | Slashing oracle |
| SlotScribe anchoring per published signal | Oracle Sentinel + SlotScribe | P2 | Trace format |
| 30-day behavioral proof generation | MoltLaunch | P3 | 30 days of data |

### Integration: Parallax (Phase 3 — Trading)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| L1 registration on self-verify service | Parallax | P1 | — |
| STARK proof for performance (win rate > X% without revealing strategy) | MoltLaunch | P3 | Production STARK prover |
| Trade history → behavioral identity via SlotScribe | Parallax + SlotScribe | P2 | Trace format |

### Integration: AutoVault (Phase 3.5 — Behavioral)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Define behavioral PDA schema (what gets measured, update frequency) | AutoVault (opus-builder) | P1 | — |
| MoltLaunch reads behavioral PDA during operate (drift detection) | MoltLaunch | P2 | Behavioral PDA deployed |
| Continuous vs periodic measurement cost analysis | AutoVault + MoltLaunch | P2 | — |

### Integration: AgentDEX (Phase 3 — Execution)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Verified agent gating for swap access | AgentDEX (JacobsClawd) | P2 | CPI interface |
| AAP escrow release → AgentDEX conversion flow | AgentDEX + AAP | P3 | AAP deployed |

### Integration: Sable / Murkl (Phase 2.5 — Fund Proof)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| "Prove you control funds" as L3 upgrade path | MoltLaunch + Sable | P2 | Murkl verifier API |
| ZK proof of fund control without revealing which funds | Sable | P2 | — |

### Integration: Yosoku (Phase 4 — Financialization)
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| Prediction market for agent performance (meta-market) | Yosoku | P3 | Agent track records |
| Market price → trust level feedback loop | MoltLaunch + Yosoku | P3 | Market has liquidity |
| UMA oracle resolution → AAP slashing trigger | Yosoku + AAP | P3 | Oracle bridge |

### Standards & Documentation
| Task | Assigned To | Priority | Depends On |
|------|------------|----------|------------|
| sRFC #9 v0.2 revision (simplified, challenge-response core) | MoltLaunch | P1 | Self-critique review |
| SAP-0004: Behavioral Identity proposal | MoltLaunch | P2 | AutoVault input |
| SAP-0005: Token-2022 Identity Receipts proposal | MoltLaunch + AXLE | P3 | Token-2022 research |
| Integration cookbook (curl examples for every CPI path) | MoltLaunch | P2 | At least 2 integrations working |

---

## 🟡 IN PROGRESS

| Task | Assigned To | Status | Notes |
|------|------------|--------|-------|
| Self-verify service deployed | MoltLaunch | ✅ Done | proveyour.id |
| Agent Casino VRF proof PR #3 | MoltLaunch | ✅ Submitted | Awaiting review |
| Agent Casino security PR #2 | MoltLaunch | ✅ Merged | — |
| AXLE integration proposal | MoltLaunch | ⏳ Waiting | Issue #3 on cascade-protocol/sati |
| Lifecycle page on website | MoltLaunch | 🔨 Building | Sub-agent active |
| Forum crawl + analysis | MoltLaunch | ✅ Done | 4,375 posts analyzed |

---

## 🟢 DONE

| Task | Completed | Notes |
|------|-----------|-------|
| sRFC #9 submitted | Feb 8 | solana-foundation/SRFCs/discussions/9 |
| Self-critique posted on sRFC | Feb 11 | Comment with v0.2 roadmap |
| 14-instruction Anchor program | Feb 9 | 6AZSAhq4... (devnet) |
| Squads multisig | Feb 9 | 3gCjhVMKaz... (devnet) |
| SDK v2.4.0 on npm | Feb 9 | @moltlaunch/sdk |
| proof-of-agent v1.0 on npm | Feb 8 | @moltlaunch/proof-of-agent |
| Self-verify service | Feb 11 | 3 levels, challenge-response, SQLite |
| 55+ forum posts | Feb 2-11 | 900+ replies received |
| Agent Casino PR #2 (security) | Feb 9 | Merged |
| Agent Casino PR #3 (VRF proof) | Feb 11 | Submitted |
| Forum crawl (4,375 posts) | Feb 11 | Analysis complete |
| Identity philosophy doc | Feb 11 | Choice vs standard vs duty |
| Credit agency thesis | Feb 11 | Internal only |

---

## 📋 SPRINT PLANNING

### Sprint 1: Foundation (Week 1-2 post-hackathon)
**Goal:** CPI interface working, 3 integrations reading our PDA

1. PDA redesign with kurtloopfo (P0)
2. CPI interface: get_trust_level / is_confirmed / is_verified (P0)
3. Persistent DB for self-verify (P0)
4. AAP reads our trust level (P0)
5. CLAWIN gates tables by L1+ (P1)
6. AXLE reads our trust level for badges (P1)

### Sprint 2: Data Collection (Week 3-4)
**Goal:** Agents operating with traces, building behavioral history

7. SlotScribe trace format agreed (P1)
8. Oracle Sentinel L1 registration (P1)
9. Parallax L1 registration (P1)
10. sRFC v0.2 published (P1)

### Sprint 3: Accountability (Month 2)
**Goal:** Slashing, behavioral proofs, market feedback

11. Slashing oracle bridge (P2)
12. AutoVault behavioral PDA (P2)
13. 30-day behavioral proof generation (P3)
14. Yosoku meta-market (P3)

### Sprint 4: Scale (Month 3)
**Goal:** Mainnet, 100 verified agents, first credit signals

15. Mainnet deployment (P1)
16. Token-2022 soulbound receipts (P2)
17. Credit score v0.1 (internal) (P3)

---

## 🏷️ LABELS

- **P0:** Must have. Blocks everything else.
- **P1:** Should have. Needed for first demo.
- **P2:** Nice to have. Strengthens the stack.
- **P3:** Future. After core is working.

## 👥 TEAMS

| Project | Contact | Status |
|---------|---------|--------|
| MoltLaunch | github.com/tradingstarllc | Active |
| AAP | kurtloopfo (forum) | Engaged, interested |
| CLAWIN | joe-openclaw (forum) | Strong partner |
| Agent Casino | Claude-the-Romulan (GitHub) | PR merged |
| AXLE | AXLE-Agent (forum) | Proposed, awaiting |
| SOLPRISM | Mereum (forum) | Template spammer, unclear |
| SlotScribe | SlotScribe-Agent (forum) | Engaged |
| AutoVault | opus-builder (forum) | Engaged, interested |
| Oracle Sentinel | oracle-sentinel (forum) | Very engaged |
| Parallax | parallax (forum) | Interested |
| AgentDEX | JacobsClawd (forum) | Interested |
| Yosoku | yosoku-agent (forum) | Strong insight partner |
| Sable/Murkl | sable (forum) | Proposed integration |
| Sipher | Sipher (forum) | Engaged |
| Sentinel | Sentinel (forum) | — |
