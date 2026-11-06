# C3 — salvage af én gearkopi

SALVAGE-008-reglen er godkendt ved brugerens “Godkendt”, 12. oktober 2026.
Mandat, kriterier og status.
Implementation er integreret i master via særskilt godkendt PR30 ved `9c4967b`,
12. oktober 2026. Alle aftalte webkriterier er verificeret på den integrerede kode.
Dette er en godkendt testregel; human balanceaccept er åben.

Spilleren vælger én konkret ejet kopi fra Gear → Manage copies → Review salvage.
Bekræftelsen viser item, rarity, kopiens instance-ID og præcis Gold-belønning.
Cancel ændrer ingen ownership/reward/save. Confirm destruerer kun den viste kopi.
Ingen bulk-/auto-salvage eller automatisk valg af næste kopi.

| Rarity | Eksisterende Gold pr. kopi |
| --- | ---: |
| Common | 5 |
| Uncommon | 15 |
| Rare | 50 |
| Epic | 100 |
| Legendary | 200 |

De første fire er 25 % af Forge-prisen pr. inputkopi; Legendary fordobler Epic.
Spilleren opgiver gear/materialer til Forge til fordel for Gold. Der indføres
ingen valuta, og Forge-priser/odds, loot, kamp, klasse-/zone-/XP-/Mastery- og
progressionsregler ændres ikke. Regel-ID: `wyrdholt-salvage-rules/1-test`.

## Beskyttelse og stale kommandoer

Core-genvalidering afviser en kopi, der mangler, er låst, udstyret eller kølagt,
uanset hvad en tidligere preview viste. Unlock fjerner ikke equip/queue-beskyttelse.
Regel-ID og forventet belønning kontrolleres igen. Ugyldigt ID, ændret quote eller
Gold-overflow giver ingen mutation. UI afgør ikke reward og kan ikke omgå core.

Kopi-ID'er er monotone og genbruges aldrig. Efter consumption afvises samme ID;
retry giver ingen yderligere Gold, også efter reload eller en efterfølgende Forge.
Der vælges aldrig automatisk en identisk erstatningskopi. Andre kopiers NEW,
equipment/pending/locks og inventory counter bevares. Den eksisterende sammenligning
kan fortsat markere gruppen reviewed før salvage; det er uændret Gear-adfærd.
Forge-receipts og historiske retries bevares også når outputkopien salvages.

## Save-kontrakt

Session kloner profilen, anvender både removal og Gold på kandidaten og gemmer den
via den eksisterende guarded ownership/temp/main/readback-protokol. UI-resultat
og kandidat offentliggøres først efter verificeret main-readback. Samtidige item-
actions og andre muterende sessionkommandoer blokeres under arbejdet.

Save-fejl eller ændret ejer kan betyde, at bytes blev gemt uden success i UI.
Brug save recovery/reload; resultatet er enten hele førprofilen eller hele
efterprofilen. Er ID'et allerede væk, kan retry ikke betale igen. Ingen save-reset
eller reinstall bruges som recovery. Langsom save bevarer kamptid og bruger
eksisterende online/offline-settlement. Der tilføjes ingen vedvarende receipt-
domæne eller nyt schema: eksisterende schema 1/2/3 og savepaths bevares. Det tidligere
private preview kan fortsat læse samme schemas efter salvage og kan ikke genskabe
en destrueret kopi eller dens gamle Gold-saldo.
