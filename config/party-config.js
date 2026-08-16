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
  // 1. GEBURTSTAGSKIND UND FEIER
  // -----------------------------------------------------
  party: {
    // Vorname, der ueberall in der App auftaucht.
    birthdayPersonName: '[NAME DES GEBURTSTAGSKINDES]',
    // Wird u. a. fuer die grosse Zahl im Design verwendet.
    age: 18,
    // Freie Bezeichnung der Feier, erscheint auf der Druckseite.
    partyTitle: '[TITEL DER FEIER]',
    // Datum der Feier, erscheint auf der Druckseite und im Album.
    partyDate: '[DATUM DER FEIER]',
    // Kleiner Hinweis ganz unten auf jeder Seite.
    giftedBy: '',
    // Oeffentliche Adresse der App. Aus GENAU dieser URL wird der QR-Code erzeugt.
    // WICHTIG: Der abschliessende Schraegstrich gehoert dazu.
    publicUrl: 'https://example.com/',
  },

  // -----------------------------------------------------
  // 2. TEXTE DER APP
  // -----------------------------------------------------
  // {name} wird automatisch durch den Namen des Geburtstagskindes ersetzt.
  // {age} wird automatisch durch das Alter ersetzt.
  texts: {
    appTitle: 'LEVEL {age} – FOTO-MISSION',
    heroSubline: 'Halte einen Moment fest, den {name} nicht vergessen soll.',
    heroExplanation:
      'Zieh eine zufällige Aufgabe, nimm ein Foto auf und werde Teil des Party-Albums.',
    nameLabel: 'Wie heißt du?',
    namePlaceholder: 'Dein Name',
    nameHelp: 'Nur damit {name} später weiß, von wem das Foto ist.',
    startButton: 'Mission ziehen',

    drawTitle: 'Deine Mission wird gemischt …',
    drawHint: 'Gleich weißt du, was du fotografieren sollst.',
    acceptButton: 'Mission annehmen',
    redrawButton: 'Andere Mission ziehen',
    redrawUsedHint: 'Du hast deinen Tausch bereits genutzt – diese Mission gilt.',

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
    successText: 'Dein Foto ist jetzt Teil von {name}s Party-Album.',
    bonusButton: 'Bonus-Mission ziehen',
    doneButton: 'Fertig',
    finishedTitle: 'Danke dir!',
    finishedText:
      'Du hast deine Foto-Mission abgeschlossen. Genieß den Abend – und mach ruhig weiter Fotos für dich selbst.',

    alreadyDoneTitle: 'Du warst schon dabei',
    alreadyDoneText: 'Deine Mission ist bereits im Album gelandet.',
  },

  // -----------------------------------------------------
  // 3. DATENSCHUTZ
  // -----------------------------------------------------
  privacy: {
    notice:
      'Dein Name und dein Foto werden ausschließlich für das private Geburtstagsalbum gespeichert. ' +
      'Die Bilder sind nicht öffentlich sichtbar und können nach der Feier gelöscht werden.',
    consentLabel:
      'Ich bin damit einverstanden, dass dieses Foto im privaten Geburtstagsalbum gespeichert wird.',
    peopleNotice:
      'Bitte stelle sicher, dass die abgebildeten Personen mit dem Foto einverstanden sind.',
  },

  // -----------------------------------------------------
  // 4. WIE VIELE FOTOS DARF EIN GERAET HOCHLADEN?
  // -----------------------------------------------------
  limits: {
    // Regulaere Missionen pro Geraet (Standard: 1).
    regularMissionsPerDevice: 1,
    // Zusaetzliche Bonus-Missionen pro Geraet (Standard: 1). 0 = keine Bonus-Mission.
    bonusMissionsPerDevice: 1,
    // Wie oft darf vor dem Annehmen getauscht werden? (Standard: 1)
    redrawsPerMission: 1,
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
    url: '[SUPABASE PROJECT URL]', // z. B. https://abcdefghijklm.supabase.co
    anonKey: '[SUPABASE ANON KEY]', // oeffentlicher Anon-/Publishable-Key
    bucket: 'party-photos',
    table: 'photo_submissions',
    // Wie lange sind die Bild-Links im privaten Album gueltig (in Sekunden)?
    signedUrlTtlSeconds: 600, // 10 Minuten
  },

  // -----------------------------------------------------
  // 7. DESIGN (Farben und Effekte)
  // -----------------------------------------------------
  theme: {
    colors: {
      background: '#07060f',
      backgroundDeep: '#04030a',
      indigo: '#1b1147',
      violet: '#4c1d95',
      magenta: '#c026d3',
      gold: '#e9c877',
      goldSoft: '#f6e2b0',
      text: '#f4f1ff',
      textMuted: '#a9a3c8',
      danger: '#ff6b6b',
      success: '#5ee0a8',
    },
    effects: {
      grain: true, // animierte Filmkoernung
      particles: true, // dezente Lichtpunkte
      confetti: true, // Lichtpartikel am Ende
      bigNumber: true, // grosse "30" im Hintergrund
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
    // Aufruf ueber: https://deine-domain.example/foto-mission/?test=1
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
  //   category    Menschen | Momente | Kreativ | Lustig | Geburtstag | Gruppe | Erinnerung
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
      title: 'Der echte Lachmoment',
      description: 'Halte einen Moment fest, in dem jemand wirklich lachen muss.',
      category: 'Momente',
      icon: 'smile',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-02',
      title: 'Der lustigste Moment',
      description: 'Fotografiere den lustigsten Moment des Abends.',
      category: 'Lustig',
      icon: 'zap',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-03',
      title: 'Gemeinsam mit dem Geburtstagskind',
      description: 'Mache ein kreatives Foto mit {name}.',
      category: 'Geburtstag',
      icon: 'gift',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-04',
      title: 'Typisch {name}',
      description: 'Fotografiere etwas, das typisch für {name} ist.',
      category: 'Geburtstag',
      icon: 'heart',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-05',
      title: 'Die große Runde',
      description: 'Mache ein Gruppenfoto mit mindestens fünf Personen.',
      category: 'Gruppe',
      icon: 'users',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-06',
      title: 'Neu kennengelernt',
      description: 'Fotografiere jemanden, den du heute neu kennengelernt hast.',
      category: 'Menschen',
      icon: 'compass',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-07',
      title: 'Das seltsamste Ding',
      description: 'Fotografiere den ungewöhnlichsten Gegenstand auf der Feier.',
      category: 'Kreativ',
      icon: 'eye',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-08',
      title: 'Unerklärlich',
      description:
        'Halte einen Moment fest, den morgen vermutlich niemand mehr erklären kann.',
      category: 'Lustig',
      icon: 'moon',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-09',
      title: 'Die beste Bewegung',
      description: 'Fotografiere die beste Tanzbewegung des Abends.',
      category: 'Momente',
      icon: 'music',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-10',
      title: 'Drei Generationen',
      description: 'Mache ein Bild, auf dem drei Generationen zu sehen sind.',
      category: 'Menschen',
      icon: 'users',
      difficulty: 'schwer',
      active: true,
    },
    {
      id: 'mission-11',
      title: 'Best Dressed',
      description: 'Fotografiere das beste Outfit des Abends.',
      category: 'Menschen',
      icon: 'star',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-12',
      title: 'Albumcover',
      description: 'Mache ein Foto, das aussieht wie das Cover eines Musikalbums.',
      category: 'Kreativ',
      icon: 'music',
      difficulty: 'schwer',
      active: true,
    },
    {
      id: 'mission-13',
      title: 'Vorher ist noch alles ruhig',
      description:
        'Fotografiere einen Moment, bevor es richtig losgeht – wenn noch alles ruhig ist.',
      category: 'Erinnerung',
      icon: 'clock',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-14',
      title: 'Lange nicht gesehen',
      description: 'Mache ein Foto mit jemandem, den du lange nicht gesehen hast.',
      category: 'Menschen',
      icon: 'heart',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-15',
      title: 'Das muss bleiben',
      description: 'Fotografiere etwas, das unbedingt in Erinnerung bleiben sollte.',
      category: 'Erinnerung',
      icon: 'star',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-16',
      title: 'Der Tisch als Stillleben',
      description:
        'Fotografiere einen Tisch so, als wäre es ein Gemälde.',
      category: 'Kreativ',
      icon: 'aperture',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-17',
      title: 'Licht und Schatten',
      description: 'Finde das schönste Licht auf der Feier und fotografiere jemanden darin.',
      category: 'Kreativ',
      icon: 'sparkles',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'mission-18',
      title: 'Der heimliche Held',
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
      description: 'Fotografiere zwei Menschen, die offensichtlich zusammengehören.',
      category: 'Menschen',
      icon: 'heart',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'mission-20',
      title: 'Der Blick von oben',
      description: 'Mache ein Foto von oben herab.',
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
      title: 'Bonus: Das Detail',
      description:
        'Fotografiere ein winziges Detail, das sonst niemand bemerkt – aber vieles über den Abend sagt.',
      category: 'Erinnerung',
      icon: 'eye',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'bonus-02',
      title: 'Bonus: Selbstauslöser',
      description: 'Mach ein Selfie mit mindestens drei anderen Gästen. Ja, wirklich alle drauf.',
      category: 'Gruppe',
      icon: 'camera',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'bonus-03',
      title: 'Bonus: Der Beweis',
      description: 'Fotografiere etwas, das beweist, dass dieser Abend wirklich stattgefunden hat.',
      category: 'Erinnerung',
      icon: 'clock',
      difficulty: 'leicht',
      active: true,
    },
    {
      id: 'bonus-04',
      title: 'Bonus: Ein Blick für {name}',
      description: 'Fotografiere etwas, von dem du glaubst, dass {name} es später sehen möchte.',
      category: 'Geburtstag',
      icon: 'gift',
      difficulty: 'mittel',
      active: true,
    },
    {
      id: 'bonus-05',
      title: 'Bonus: Unscharf, aber richtig',
      description:
        'Mach bewusst ein leicht unscharfes Bewegungsfoto – Hauptsache die Stimmung passt.',
      category: 'Kreativ',
      icon: 'aperture',
      difficulty: 'schwer',
      active: true,
    },
  ],
};

export default PARTY_CONFIG;
