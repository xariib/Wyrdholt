# Observationsskema for C1, C2 og C3

Status før feedback: **NOT RUN** for alle humanpunkter. Guiden er klar, men der er
endnu ingen indsendte resultater. Brug [guiden](C3_HUMAN_GUIDE_DA.md) og dit eget
save i testbuildet; undlad rå save-data, loginoplysninger og private tokens.

Tester/dato (Europe/Copenhagen): ___
Android-playtest: REDMAGIC 11 Pro · Wyrdholt 0.2.1 · Android-version: ___
Build-ID hvis vist: ___ · browser/version ved separat webtest: ___
Klasse/alternativ: ___ · level/Mastery: ___ · zone/stage: ___ · Gold: ___
Save fortsat fra tidligere version: ja/nej/ukendt ___
Normale check-ins/dag og minutter pr. besøg: ___ · fravær før genbesøg: ___
Ingen reset/DEV grants anvendt: ___

| Punkt | PASS / FAIL / NOT RUN + årsag | Konkret observation |
| --- | --- | --- |
| Greenfields, Darkwood og Ashen Mountains | ___ | Første clear pr. zone, dag/tid, level, Mastery og manuel start af næste zone ___ |
| Push/nederlag/Farm og optjente rewards bevaret | ___ | Før/efter zone, stage, XP/Mastery/Gold/loot og tid ___ |
| Klassevalg og skift efter kamp | ___ | Active/Alternate, hvornår skiftet trådte i kraft og hvad der ændrede sig ___ |
| Monk, Mage, Warrior og Ranger | ___ | Én observation pr. testet klasse med zone, level, Mastery, gear og en mærkbar teknik ___ |
| Inventory/søgning/filtre/mange kopier | ___ | Filter, antal, item/effekt og overskuelighed ___ |
| Manage copies/NEW/exact comparison | ___ | Mål-ID/peer-ID; NEW før/efter ___ |
| Konkret equip/queue/sikker kampgrænse | ___ | Aktuelt/queued ID; hvornår ændringen trådte i kraft ___ |
| Lock/Unlock/Equipped/Queued-beskyttelse | ___ | ID/status/NEW; faktisk afvisning ___ |
| Forge Cancel/Confirm/output | ___ | Materiale-IDs, pris, Gold før/efter, output-ID/rarity ___ |
| Single salvage Cancel/Confirm | ___ | Item/rarity/ID, Gold før/efter og om ID forsvandt ___ |
| Batch/skjulte IDs/all-or-nothing | ___ | Præcise valgte/bekræftede IDs, total og afvisningsårsag ___ |
| Reload/lock/NEW/gear/Gold | ___ | Samme konkrete før-/efterværdier ___ |
| Naturligt opstået recovery (kun hvis observeret) | ___ | Fuld tekst, handlinger, resultat; ingen reset ___ |
| Fysisk enhed og offlinegenoptagelse | ___ | Model, OS, appversion, fravær, offlineafregning, aktivitet og eventuelle touchproblemer ___ |

For hver fejl: trin 1…n ___ · forventet ___ · faktisk ___ · gentagelighed ___ ·
berørt copy-ID ___ · skærmbillede uden private oplysninger, hvis relevant ___ ·
blokering/dataændring ja/nej/ukendt ___. Stop ved mulig dataskade og behold save.

Forståelighed 1–5 (1=uklar, 5=tydelig): effekter ___; NEW ___; låse/protection ___;
valg uden for filter ___; Forge-forbrug ___; salvage-belønning ___; recovery ___.
Buildvalget jeg traf og hvorfor: ___
Forge kontra salvage — mit valg og hvorfor: ___
Progression — konkret tid, zone/stage og oplevet barriere: ___
Bedste/værste øjeblik og én ønsket forbedring: ___

Humanaccept: **AFVENTER**. Testerens konklusion ___; åbne punkter ___; dato ___.
Webpreview-feedback gælder den testede browser/build. Native, fysisk installation,
OS-kill, klassebalance og samlet releaseaccept kræver deres egne faktiske resultater.

## C4 · Ashen King

Brug [Android-trinene](../design/C4_SOLO_BOSSES.md#android-playtest) og notér
enhed, appversion, klasse, level, Mastery og gear. Skriv PASS, FAIL eller NOT RUN
med årsag for hvert trin.

- Første Ashen Mountains-clear, tier og tid til første forsøg ___
- Appskift midt i kampen, fravær og tier/HP ved retur ___
- OS-lukning, fravær, offline-resultat, Farm og næste tier ___
- Crown-rank og Attack-bonus før og efter genstart ___
- Nederlag, boss-HP, ændret build og resultat af nyt forsøg ___
- Oplevet sværhedsgrad pr. tier og mærkbar effekt af Crown ___

## Webtest 6. november 2026

Testbuild `EMB-0.1.0-20261106.0904` fra den lokale webpreview på `main`
(`51b82b7`). Brave på Windows. De automatiske tests brugte samme Brave-program
med Chromium `157.0.8103.39`. Webpreviewen viste figurvalg, så jeg oprettede
Adventurer med Monk som Active og Mage som Alternate. Browserdata blev bevaret.
Der blev ikke brugt reset eller DEV grants på figuren.

| Punkt | Status | Observation |
| --- | --- | --- |
| C1 og C3 · første Push, nederlag og Farm | PASS for det observerede forløb | Start 15.18.21 dansk tid. Ved 15.19.38, cirka 1 min. 17 sek. efter start, viste spillet nederlag i Greenfields 4/10 med Monk L1/M1, startudstyr og 46/367 fjende-HP tilbage (12 % i forsøgshistorikken), én fjende stående. Spillet viste 20 XP, 7 Mastery XP, 14 Gold og 0 items beholdt. Headeren stod fortsat på 14 Gold efter valg af Keep farming, og Adventure viste Farming the trail, stage 1/10. |
| C1 · første clears, manuelt zoneskift, ændret retry og offlineafregning | NOT RUN | Ingen clear i det observerede forløb. Darkwood og Ashen Mountains stod låst. Første nederlag giver et udgangspunkt for en senere retry. En offlineafregning og udviklingen over daglige check-ins blev ikke observeret. |
| C2 · klassevalg og læsbarhed | DELVIST | Character forklarer delt level og separat Class Mastery. Monk viste Restoring Rhythm ved M1 og næste teknik Combo Strike ved M5. Mage beskrev Burn og viste Arcane Ward som næste teknik. Trigger, virkning og farver i kamp er beskrevet, men næste teknik og dens forklaring kræver scroll. |
| C2 · skift ved kampgrænse og sammenligning af de fire klasser | NOT RUN | Monk blev spillet på L1/M1 med startudstyr. Mage blev kun læst i Character. Warrior/Ranger-figuren blev ikke oprettet. Der er ingen målt sammenligning af tempo, skade eller overlevelse. |
| C3 · Inventory, konkret equip, låse, Forge, salvage og reload på den friske figur | NOT RUN | Den interaktive session sluttede før geargennemgangen. Se særskilt automatiseret kontrol nedenfor. Ingen naturlig recovery blev observeret. |
| Fysisk Android · REDMAGIC 11 Pro | NOT RUN | Ingen tilgængelig fysisk enhed i denne session. Android-version og installeret appversion blev ikke aflæst. Appskift, touch/scroll, offlineafregning og OS-lukning/genstart blev ikke afprøvet. |

Første nederlag var til at handle på. Figuren var L1 mod L2-fjender, havde 0 HP
ved slutningen og havde bragt den sidste fjende tæt på nederlag. Jeg valgte Farm
for at få et level eller en udstyrsopgradering før næste Push. Skærmen gav ikke
et grundlag for at afgøre, om skade eller overlevelse var den vigtigste forskel.
Stage 4 efter cirka 1 min. 17 sek. er den observerede barriere. Der er for lidt
spilletid til at vurdere tempoet for en første clear eller klassernes balance.
De viste klasseeffekter var forståelige. Overblik over kopier og skjulte valg
blev ikke vurderet på den friske figur. I de automatiske testdata gav Forge fem
Common våben og 100 Gold videre til ét Uncommon våben. Salvage gav 15 Gold for
ét Uncommon item. Et valg på en naturligt optjent beholdning blev ikke prøvet.

Observeret rytme var én åbning og cirka 1 min. 17 sek. til det registrerede
nederlag. Ved åbning af en separat adresse til Warrior/Ranger stoppede Computer
Use, fordi værktøjet ikke kunne fastslå browserens aktuelle URL med tilstrækkelig
sikkerhed. Derfor blev 30-minutters sessionen, geargennemgangen og genbesøget
ikke fuldført.

### Særskilt automatiseret browserkontrol

`npm run test:save:web` bestod med kontrolleret loot, Gold, clear og browserlagring.
Det er correctness-evidens for buildet. Testen observerede, at sammenligning af
kopi #139 bevarede NEW på #140, og at køen bevarede det aktive kampbuild. Forge
beholdt den låste #15, afbrød uden forbrug og brugte ved bekræftelse #23, #47,
#56, #64 og #86 samt 100 Gold til Uncommon Briar Edge #141. Single salvage af
#141 gav 15 Gold. Batchtesten bevarede de skjulte valg #122 og #123, afviste
samlet ved beskyttelse og gav i den godkendte handling 10 Gold. Reload og
recovery blev kontrolleret med særskilte fixtures, herunder injicerede fejl.
Den friske browserfigur indgik ikke i disse kontroller.

Typecheck, core purity, art og webkompatibilitet bestod. Vitest bestod
1.511 tests fordelt på 37 filer. Humanaccept afventer.
