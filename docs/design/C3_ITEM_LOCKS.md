# C3 — spillerlåse på individuelle gearkopier

Krav og regel godkendt i ITEM-LOCKS-007-ejerchatten. Schema-3-migrationen er
særskilt godkendt ved brugerens “Godkendt”. Implementation er integreret i master
via godkendt PR23 ved `bb770a4`, efter særskilt PR22-integration. Verificeret web-
feature, ikke generel native/human releaseaccept.

En spillerlås beskytter én ejet kopi, identificeret ved dens monotone instance-ID,
mod forbrug i Forge. Samme base-item kan have både låste og ulåste kopier. Låst
gear kan udstyres, køes og bruges i kamp med samme stats og effekter. Oplåsning
ophæver kun spillerlåsen: equipped/queued gear er fortsat reserveret.

Lås/oplås ændrer ikke NEW. De eksisterende regler gælder stadig: åbning af en
gruppecomparison reviewer dens kopier; selection af en præcis kopi reviewer
kun den kopi; equip reviewer den udstyrede kopi. Manage copies alene reviewer
ingen kopier. En afsluttet Forge-retry returnerer den oprindelige receipt uden
nyt forbrug, også hvis output senere låses eller udstyres.

Core `eligibleForgeIds` udelukker låste/reserverede ID'er. `fuse` validerer hvert
valgt materiale igen før enhver inventory/guld/receipt-mutation; direkte eller
stale kommandoer afvises uden forbrug. DEV-cleanup bevarer også låste kopier.
UI er en præsentation af denne beskyttelse, ikke dens eneste håndhævelse.

Gear viser ID, Locked/Unlocked, Equipped/Queued og NEW pr. kopi. Copy selection
fører det præcise ID til equip; Forge-resultatcomparison beholder output-ID.
Låseknappen får først gemt succes efter guarded main-file readback. Samtidige
Forge-/lock-handlinger, lifecycle, commands og autosave bruger samme sessiongate.
Fejl viser save-recovery; ingen falsk succes eller reset-workaround.
Lock-save holder mutation stille, men bevarer live frame-time og carry; næste
frame afregner ventetid med eksisterende online/offline-kerneregler. Langsom
lagring eller gentagne locks må ikke fjerne kamp/progressionstid.

Schema 1/2 indlæses uden automatisk upgrade. Første gyldige låsning opretter
`itemLocks: { version: 1, lockedInstanceIds: [...] }` og schema 3. Listen er
sorteret/unik og refererer kun til ejede ID'er. Tom liste efter sidste oplåsning
beholder schema 3. Det kompakte inventoryformat er uændret. Schema 3 med og
uden Forge valideres; fejl/downgrade af låsedata afvises uden at fjerne låse.
Gamle læsere afviser schema 3 og eksisterende SaveGuard bevarer alle rå slots.

Combat rules `emberbound-rules/0.3.0`, ITEM-EFFECTS-006-content, Forge rules/config,
loot/pacing/stats/priser/odds og gamle receipts er uændrede. Ingen salvage eller
belønninger. Native/OS-kill/human/aggregate releaseaccept er fortsat separate.

Mandat, kriterier og handoff,
konkret migration.
