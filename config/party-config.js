// =======================================================
// FOTO-MISSION TEMPLATE – ZENTRALE KONFIGURATION
// =======================================================
//
// Am einfachsten richtest du das Template mit `npm run setup` ein.
// Das Formular aktualisiert die wichtigsten Werte in dieser Datei automatisch.
//
// Kurz-Anleitung:
//   1. Ersetze alle Platzhalter in eckigen Klammern, z. B. [NAME DES GEBURTSTAGSKINDES].
//   2. Trage unten bei "supabase" deine Projekt-URL und deinen Anon-Key ein.
//   3. Missionen kannst du beliebig aendern, ergaenzen oder mit "active: false" abschalten.
//
// WICHTIG: Hier gehoert NIEMALS ein Service-Role-Key oder ein Passwort hinein.
// Diese Datei wird auf den Webserver hochgeladen und ist damit oeffentlich lesbar.
// Der Supabase-Anon-Key darf hier stehen (siehe README, Abschnitt "Warum darf der
// Anon-Key oeffentlich sein?").

export const PARTY_CONFIG = {
  // -----------------------------------------------------
  // 1. JUBELPAAR UND FEIER
  // -----------------------------------------------------
  party: {
    // Vorname, der ueberall in der App auftaucht.
    birthdayPersonName: 'Britta & Lutz',
    // Wird hier als Jubilaeumszahl im Design verwendet.
    age: 25,
    // Freie Bezeichnung der Feier, erscheint auf der Druckseite.
    partyTitle: 'Silberhochzeit von Britta & Lutz Barmbold',
    // Datum der Feier, erscheint auf der Druckseite und im Album.
    partyDate: '2026',
    // Kleiner Hinweis ganz unten auf jeder Seite.
    giftedBy: '',
    // Oeffentliche Adresse der App. Aus GENAU dieser URL wird der QR-Code erzeugt.
    // WICHTIG: Der abschliessende Schraegstrich gehoert dazu.
    publicUrl: 'https://silberhochzeit-barmbold.ulhorn-webdesign.de/',
  },

  // -----------------------------------------------------
  // 2. TEXTE DER APP
  // -----------------------------------------------------
  // {name} wird automatisch durch den Namen des Jubelpaares ersetzt.
  // {age} wird automatisch durch die Jubilaeumszahl ersetzt.
  texts: {
    appTitle: '{age} JAHRE – FOTO-MISSION',
    heroSubline: 'Schenkt Britta & Lutz Erinnerungen in Bildern.',
    heroExplanation:
      'Zieh eine Mission, halte einen besonderen Moment fest und werde Teil ihres Silberhochzeits-Albums.',
    nameLabel: 'Wie heißt du?',
    namePlaceholder: 'Dein Name',
    startButton: 'Mission ziehen',

    drawTitle: 'Deine Mission wird gemischt …',
    drawHint: 'Gleich weißt du, was du fotografieren sollst.',
    acceptButton: 'Mission annehmen',
    redrawButton: 'Andere Mission ziehen',
    redrawUsedHint: 'Du hast zweimal gewechselt – diese Mission gilt.',

    captureTitle: 'Auf geht’s!',
    captureButton: 'Foto aufnehmen',
    chooseButton: 'Foto aus der Galerie wählen',
    captureHint: 'Kein Kamerazugriff? Du kannst auch ein vorhandenes Foto auswählen.',

    previewTitle: 'Sieht das gut aus?',
    usePhotoButton: 'Dieses Foto verwenden',
    retakeButton: 'Neu aufnehmen',
    cancelMissionButton: 'Mission abbrechen',

    confirmTitle: 'Letzter Blick',
    uploadButton: 'Foto ins Album hochladen',
    uploadingLabel: 'Foto wird entwickelt …',
    slowConnectionHint:
      'Die Verbindung ist gerade langsam. Bitte lass die Seite offen – der Upload läuft weiter.',

    successTitle: 'Mission erfüllt!',
    successText: 'Dein Foto ist jetzt Teil des Silberhochzeits-Albums von Britta & Lutz.',
    nextMissionButton: 'Nächste Mission ziehen',
    bonusButton: 'Bonus-Mission ziehen',
    // Freiwillige Zusatz-Mission, nachdem Pflicht- und Bonus-Mission erledigt sind.
    extraMissionButton: 'Noch eine Mission ziehen',
    galleryButton: 'Zur Galerie',
    doneButton: 'Fertig',
    finishedTitle: 'Danke dir!',
    finishedText:
      'Du hast deine Foto-Mission abgeschlossen. Schau dir in der Galerie an, was die anderen Gäste eingefangen haben – ' +
      'und wenn du magst, zieh einfach noch eine Mission.',

    alreadyDoneTitle: 'Du warst schon dabei',
    alreadyDoneText:
      'Deine Missionen sind bereits im Album gelandet. Du kannst jederzeit noch eine Mission ziehen ' +
      'oder in der Galerie stöbern.',
  },

  // -----------------------------------------------------
  // 3. DATENSCHUTZ
  // -----------------------------------------------------
  privacy: {
    notice:
      'Dein Name und dein Foto werden für das Silberhochzeits-Album gespeichert. ' +
      'Die Bilder sind in der öffentlichen Galerie dieser Seite sichtbar und können dort von Gästen bewertet werden. ' +
      'Nach der Feier können sie durch die Administration gelöscht werden.',
    // Steht direkt neben dem Haken vor dem Hochladen. Bewusst kurz und in
    // eigener Sprache - er soll wirklich gelesen werden.
    consentLabel:
      'Ja, mein Foto darf ins Silberhochzeits-Album und in die öffentliche Galerie – ' +
      'alle abgebildeten Personen sind einverstanden.',
    // Kleiner Zusatz unter dem Haken.
    consentHint:
      'Bitte frag im Zweifel kurz nach, bevor du ein Foto mit anderen Gästen hochlädst.',
    peopleNotice:
      'Bitte stelle sicher, dass die abgebildeten Personen mit dem Foto einverstanden sind.',
    // Gilt fuer den privaten Bereich "Fuer Britta & Lutz".
    memoriesNotice:
      'Die privaten Erinnerungen werden unverändert gespeichert (also einschließlich der ' +
      'Aufnahmedaten der Kamera) und ausschließlich Britta und Lutz übergeben. ' +
      'Sie erscheinen niemals in der öffentlichen Galerie.',
  },

  // -----------------------------------------------------
  // 4. WIE VIELE FOTOS DARF EIN GERAET HOCHLADEN?
  // -----------------------------------------------------
  limits: {
    // Regulaere Missionen pro Geraet.
    regularMissionsPerDevice: 2,
    // Zusaetzliche Bonus-Missionen pro Geraet (Standard: 1). 0 = keine Bonus-Mission.
    bonusMissionsPerDevice: 1,
    // Danach ist Schluss? Nein: Wer mag, darf freiwillig immer weitermachen.
    // Auf false setzen, wenn nach Pflicht- und Bonus-Mission wirklich Schluss sein soll.
    allowExtraMissions: true,
    // Zweimal darf gewechselt werden; die dritte gezogene Mission gilt.
    redrawsPerMission: 2,
    // Groesse der Datei, die das Handy liefert (vor der Verkleinerung).
    maxInputFileBytes: 40 * 1024 * 1024, // 40 MB
    // Groesse der fertig verkleinerten Datei, die hochgeladen wird.
    maxUploadBytes: 6 * 1024 * 1024, // 6 MB
    // Erlaubte Dateitypen. SVG, HTML und ausfuehrbare Dateien sind bewusst NICHT erlaubt.
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/avif',
    ],
    // Name (min./max. Laenge)
    minNameLength: 2,
    maxNameLength: 40,
  },

  // -----------------------------------------------------
  // 4b. PRIVATE ERINNERUNGEN ("Fuer Britta & Lutz")
  // -----------------------------------------------------
  // Ein zweiter, voellig getrennter Weg: Gaeste laden hier Fotos und kurze
  // Videos hoch, die NIEMALS oeffentlich erscheinen. Sie landen in einem
  // eigenen privaten Speicher und sind nur im Adminbereich sichtbar.
  //
  // Wichtig: Diese Dateien werden bewusst NICHT verkleinert. Britta und Lutz
  // sollen die Aufnahmen in Originalqualitaet bekommen.
  memories: {
    // Auf false setzen, um den ganzen Bereich auszublenden.
    enabled: true,
    // Beschriftung des Menuepunktes.
    tabLabel: 'Für Britta & Lutz',

    limits: {
      // Pro Upload-Vorgang. Diese Zahlen stehen auch in der Datenbank
      // (siehe supabase/private-memories.sql) - beides muss zusammenpassen.
      maxPhotos: 20,
      maxVideos: 5,
      maxPhotoBytes: 15 * 1024 * 1024, // 15 MB
      maxVideoBytes: 45 * 1024 * 1024, // 45 MB
      // Ab dieser Groesse wird der unterbrechbare Upload (TUS) versucht.
      resumableFromBytes: 6 * 1024 * 1024, // 6 MB
      // Empfehlung fuer die Videolaenge (nur ein Hinweis, keine harte Grenze:
      // die Laenge laesst sich im Browser nicht zuverlaessig pruefen).
      videoSecondsHint: 30,
      // Laenge der persoenlichen Nachricht.
      maxMessageLength: 1000,
      photoMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
      videoMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      // Manche Handys liefern gar keinen oder einen falschen MIME-Typ mit.
      // Dann entscheidet die Dateiendung.
      photoExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
      videoExtensions: ['mp4', 'mov', 'm4v', 'webm'],
    },

    texts: {
      title: 'Eine Erinnerung an diesen Abend',
      intro:
        'Habt ihr einen schönen Moment festgehalten? Dann ladet hier gerne eure Fotos oder ' +
        'kurze Videos für Britta und Lutz hoch. Die Aufnahmen werden nicht öffentlich angezeigt, ' +
        'sondern den beiden nach der Feier als persönliches Erinnerungsalbum übergeben.',
      privateBadge: 'Privater Upload – nur Britta und Lutz erhalten diese Aufnahmen.',
      nameLabel: 'Wie heißt du?',
      namePlaceholder: 'Dein Name',
      nameHint: 'Dein Name wird gebraucht, damit die Aufnahmen später zugeordnet werden können.',
      messageLabel: 'Persönliche Nachricht an Britta und Lutz (optional)',
      messagePlaceholder: 'Ein paar Zeilen, wenn du magst …',
      photoBoxTitle: 'Fotos hinzufügen',
      videoBoxTitle: 'Videos hinzufügen',
      videoHint: 'Bitte möglichst kurze Videos – etwa bis 30 Sekunden.',
      uploadButton: 'Erinnerung hochladen',
      successTitle: 'Vielen Dank!',
      successText:
        'Deine Erinnerungen wurden gespeichert und werden Britta und Lutz nach der Feier übergeben.',
      moreButton: 'Weitere Erinnerungen hochladen',
      // Hinweis am Ende der Foto-Mission.
      missionHint:
        'Habt ihr noch weitere schöne Momente aufgenommen? Ladet sie gerne privat für Britta und Lutz hoch.',
      missionHintButton: 'Erinnerungen hochladen',
    },
  },

  // -----------------------------------------------------
  // 5. BILDVERARBEITUNG (Kompression im Browser)
  // -----------------------------------------------------
  image: {
    // Laengste Bildkante nach dem Verkleinern. Seitenverhaeltnis bleibt erhalten.
    maxDimension: 2048,
    // Qualitaet zwischen 0 und 1. 0.82 ist ein guter Kompromiss.
    quality: 0.82,
    // WebP ist kleiner. Wenn der Browser es nicht kann, wird automatisch JPEG genutzt.
    preferWebp: true,
  },

  // -----------------------------------------------------
  // 6. SUPABASE (Datenbank + Foto-Speicher + Admin-Login)
  // -----------------------------------------------------
  // Diese beiden Werte findest du in Supabase unter:
  //   Project Settings -> API -> "Project URL" und "anon public"
  // Solange hier Platzhalter stehen, laeuft die App im Demo-Modus:
  // Alles bis zur Foto-Vorschau funktioniert, aber es wird NICHTS hochgeladen
  // und es wird auch KEIN falscher Erfolg angezeigt.
  supabase: {
    url: 'https://kdxycggkdfiuqwuhueab.supabase.co', // z. B. https://abcdefghijklm.supabase.co
    anonKey: 'sb_publishable_8hUHbxyv1Nr_q6iyAnPwvA_sAa9lYDX', // oeffentlicher Anon-/Publishable-Key
    bucket: 'party-photos',
    table: 'photo_submissions',
    // Wie lange sind die Bild-Links im privaten Album gueltig (in Sekunden)?
    signedUrlTtlSeconds: 600, // 10 Minuten

    // --- Privater Bereich "Fuer Britta & Lutz" ---------------------------
    // Eigener, streng privater Speicher. Der Bucket der Foto-Mission bleibt
    // davon voellig unberuehrt.
    memoriesBucket: 'private-memories',
    memoriesTable: 'private_memory_uploads',
    memoriesFilesTable: 'private_memory_files',
  },

  // -----------------------------------------------------
  // 7. DESIGN (Farben und Effekte)
  // -----------------------------------------------------
  theme: {
    colors: {
      background: '#151719',
      backgroundDeep: '#090a0b',
      indigo: '#34383d',
      violet: '#555b62',
      magenta: '#a98d6c',
      gold: '#c8ccd0',
      goldSoft: '#f2eee5',
      text: '#f7f5ef',
      textMuted: '#b9bdc1',
      danger: '#ff6b6b',
      success: '#5ee0a8',
    },
    effects: {
      grain: true, // animierte Filmkoernung
      particles: true, // dezente Lichtpunkte
      confetti: true, // Lichtpartikel am Ende
      bigNumber: true, // grosse Jubilaeumszahl im Hintergrund
    },
    // Kurzer Sound (im Browser erzeugt, keine Musikdatei, keine Rechte noetig).
    // Wird ausschliesslich nach einem Tippen des Gastes abgespielt.
    sound: {
      enabled: true,
    },
  },

  // -----------------------------------------------------
  // 8. TESTMODUS
  // -----------------------------------------------------
  test: {
    // Aufruf ueber: https://silberhochzeit-barmbold.ulhorn-webdesign.de/?test=1
    queryParam: 'test',
    // Im Testmodus wird standardmaessig NICHT hochgeladen.
    // Der Gast/Tester muss den Schalter "Test-Upload erlauben" bewusst aktivieren.
    allowUploadByDefault: false,
    bannerText: 'TESTMODUS – Uploads sind standardmäßig deaktiviert',
    // Praefix fuer Testdaten, damit sie im Album eindeutig erkennbar sind.
    guestNamePrefix: '[TEST] ',
  },

  // -----------------------------------------------------
  // 9. FOTO-MISSIONEN
  // -----------------------------------------------------
  // Aufbau einer Mission:
  //   id          eindeutig, wird in der Datenbank gespeichert  (nicht nachtraeglich aendern)
  //   title       kurze Ueberschrift
  //   description was genau fotografiert werden soll
  //   category    Jubelpaar | Menschen | Momente | Kreativ | Lustig | Gruppe | Erinnerung
  //   icon        camera | users | heart | sparkles | star | film | music | gift |
  //               cake | moon | zap | clock | eye | smile | aperture | compass
  //   difficulty  leicht | mittel | schwer
  //   active      true = wird gezogen, false = wird uebersprungen
  //
  // Eine Mission abschalten: einfach "active: false" setzen.
  // Eine Mission ergaenzen: den ganzen Block kopieren und eine neue id vergeben.
  missions: [
    {
      id: 'mission-01',
      title: 'Das schönste Lachen',
      description: 'Halte einen Moment fest, in dem Britta oder Lutz von Herzen lachen.',
      category: 'Momente',
      icon: 'smile',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-02',
      title: 'Mit dem Jubelpaar',
      description: 'Mach ein gemeinsames Foto mit Britta & Lutz – klassisch oder kreativ.',
      category: 'Jubelpaar',
      icon: 'zap',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-03',
      title: 'Ein Blick zwischen zwei Menschen',
      description: 'Fange einen liebevollen Blick zwischen Britta & Lutz ein.',
      category: 'Jubelpaar',
      icon: 'gift',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-04',
      title: 'Typisch Britta & Lutz',
      description: 'Fotografiere einen Moment oder ein Detail, das einfach typisch für die beiden ist.',
      category: 'Jubelpaar',
      icon: 'heart',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-05',
      title: 'Die große Gratulantenrunde',
      description: 'Versammle mindestens fünf Gäste für ein fröhliches Gruppenfoto.',
      category: 'Gruppe',
      icon: 'users',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-06',
      title: 'Familie trifft Freunde',
      description: 'Fotografiere zwei Gäste, die Britta & Lutz aus ganz unterschiedlichen Zeiten kennen.',
      category: 'Menschen',
      icon: 'compass',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-07',
      title: 'Ein Hauch von Silber',
      description: 'Finde das schönste silberne Detail auf der Feier und setze es in Szene.',
      category: 'Kreativ',
      icon: 'eye',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-08',
      title: 'Wie vor 25 Jahren',
      description:
        'Stellt mit Gästen eine klassische Hochzeitsfoto-Pose nach – gern mit einem Augenzwinkern.',
      category: 'Lustig',
      icon: 'moon',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-09',
      title: 'Tanzfläche frei',
      description: 'Fotografiere den schönsten oder schwungvollsten Tanzmoment des Abends.',
      category: 'Momente',
      icon: 'music',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-10',
      title: 'Drei Generationen',
      description: 'Bring drei Generationen für ein gemeinsames Erinnerungsfoto zusammen.',
      category: 'Menschen',
      icon: 'users',
      difficulty: 'schwer',
      active: true,
    },
    {
      id: 'mission-11',
      title: 'Festlich herausgeputzt',
      description: 'Fotografiere ein besonders festliches Outfit oder ein schönes Accessoire.',
      category: 'Menschen',
      icon: 'star',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-12',
      title: 'Das Jubiläumscover',
      description: 'Inszeniere ein Foto, das als Titelbild für das Silberhochzeits-Album taugt.',
      category: 'Kreativ',
      icon: 'music',
      difficulty: 'schwer',
      active: true,
    },
    {
      id: 'mission-13',
      title: 'Ein stiller Moment',
      description:
        'Fange zwischen all dem Feiern einen ruhigen, innigen Augenblick ein.',
      category: 'Erinnerung',
      icon: 'clock',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-14',
      title: 'Lange nicht gesehen',
      description: 'Mach ein Wiedersehensfoto mit jemandem, den du lange nicht gesehen hast.',
      category: 'Menschen',
      icon: 'heart',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-15',
      title: 'Für die nächsten 25 Jahre',
      description: 'Fotografiere einen Moment, an den sich Britta & Lutz noch lange erinnern sollen.',
      category: 'Erinnerung',
      icon: 'star',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-16',
      title: 'Festtafel als Stillleben',
      description:
        'Fotografiere Tischschmuck, Gläser oder Ringe so, als wäre die Szene ein Gemälde.',
      category: 'Kreativ',
      icon: 'aperture',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-17',
      title: 'Im schönsten Licht',
      description: 'Finde das schönste Licht auf der Feier und fotografiere Britta, Lutz oder einen Gast darin.',
      category: 'Kreativ',
      icon: 'sparkles',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-18',
      title: 'Die helfende Hand',
      description:
        'Fotografiere jemanden, der heute im Hintergrund dafür sorgt, dass alles läuft.',
      category: 'Menschen',
      icon: 'star',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-19',
      title: 'Zwei, die zusammengehören',
      description: 'Fotografiere ein Paar oder zwei Menschen, die schon viel miteinander erlebt haben.',
      category: 'Menschen',
      icon: 'heart',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-20',
      title: '25 mit Händen',
      description: 'Stellt gemeinsam die Zahl 25 dar – mit Händen, Menschen oder Dingen.',
      category: 'Kreativ',
      icon: 'eye',
      difficulty: 'mittel',
      active: true,
    },
  ],

  // -----------------------------------------------------
  // 10. BONUS-MISSIONEN
  // -----------------------------------------------------
  // Werden nur nach einem erfolgreichen regulaeren Upload angeboten.
  bonusMissions: [
    {
      id: 'bonus-01',
      title: 'Bonus: Ringe & Hände',
      description:
        'Fotografiere Hände oder Ringe so, dass man 25 gemeinsame Jahre darin erahnen kann.',
      category: 'Erinnerung',
      icon: 'eye',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'bonus-02',
      title: 'Bonus: Selfie fürs Jubelpaar',
      description: 'Mach ein fröhliches Selfie mit mindestens drei anderen Gästen als Gruß an Britta & Lutz.',
      category: 'Gruppe',
      icon: 'camera',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'bonus-03',
      title: 'Bonus: 25 Jahre in einem Bild',
      description: 'Finde ein Motiv, das für dich 25 Jahre Zusammenhalt erzählt.',
      category: 'Erinnerung',
      icon: 'clock',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'bonus-04',
      title: 'Bonus: Ein Blick für Britta & Lutz',
      description: 'Fotografiere etwas, das die beiden während der Feier vielleicht selbst nicht sehen.',
      category: 'Jubelpaar',
      icon: 'gift',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'bonus-05',
      title: 'Bonus: Bewegung im Glück',
      description:
        'Mach bewusst ein leicht unscharfes Bewegungsfoto – Hauptsache, die Feierlaune ist zu spüren.',
      category: 'Kreativ',
      icon: 'aperture',
      difficulty: 'schwer',
      active: true,
    },
  ],
};

export default PARTY_CONFIG;
