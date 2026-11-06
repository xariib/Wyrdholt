# C3 — manuel batch-salvage

BULK-SALVAGE-009-reglen er eksplicit godkendt af brugeren i startmandatet
12. oktober 2026. Opgave, baseline og kriterier.

Kun eksplicit valgte og bekræftede instance-ID’er nedbrydes. Hvis én valgt kopi
ved bekræftelsen mangler, er låst, udstyret, kølagt eller har en ugyldig reward-quote,
afvises hele handlingen uden delvis nedbrydning eller belønning. Identiske
erstatningskopier må aldrig vælges automatisk.

Spilleren vælger manuelt i Gear → Manage copies. Valget følger sider og itemtyper
inden for samme gearslot; lukning/reload rydder det lokale valg uden salvage.
Preview viser items/antal, Gold pr. rarity, total og paginerede præcise copy-ID’er.
Cancel ændrer ingen ownership/reward/save; eksisterende Gear comparison review
kan fortsat ændre NEW før selection/preview, som i SALVAGE-008. Single-copy bevares.
Ingen select-all/automatisk valg eller auto-salvage.

Rewardreglen er uændret SALVAGE-008: Common/Uncommon/Rare/Epic/Legendary giver
5/15/50/100/200 Gold pr. kopi. Batchregel `wyrdholt-bulk-salvage-rules/1-test`
refererer hver kopis `wyrdholt-salvage-rules/1-test`, base-ID og Gold; core kontrollerer
alle quotes og total mod aktuelt inventory. Dublerede ID’er afvises. Gold-overflow
eller enhver fejl afviser hele batchen før mutation. Ingen tuning/valutaændring.

Session kopierer commandens bekræftede input, kloner hele profilen, anvender alle
removals og totalreward på kandidaten og bruger én eksisterende guarded
ownership/temp/main/readback-write før success. Concurrent muterende commands
blokeres; main-readback eller owner-fejl giver ingen falsk success. Recovery kan
læse hele før- eller efterprofilen; retry af forbrugte monotone IDs betaler aldrig
igen, også efter reload/Forge eller en identisk ny kopi. Ingen nyt save-domain,
receipts eller schema: schema 1/2/3/savepaths/recovery bevares.
Langsom save bevarer frame-time/carry med eksisterende online/offline-regler.
Andre kopiers NEW/locks/equipment/queue/counter og Forge-receipts bevares.

Særskilt godkendt PR31 er integreret ved `756e837`, 12. oktober 2026. Alle otte
aftalte webkriterier er verificeret på integreret kode med identisk tree/produkt/
preview-proof. Faktisk handoff står i opgaverecord/CURRENT_STATE. Native/human/
balance/aggregate releaseaccept følger ikke af regel- eller mergegodkendelsen.
