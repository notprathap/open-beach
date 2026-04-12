// Bounding-box locale table: [minLat, maxLat, minLng, maxLng, countryCode, language]
// Ordered so smaller/overlapping regions come before larger ones
const COORD_TABLE = [
  // Austria (before Germany - overlapping southern latitudes)
  [46.4, 49.1, 9.5, 17.2, 'at', 'de'],
  // Switzerland (before France/Italy)
  [45.8, 47.8, 5.9, 10.5, 'ch', 'de'],
  // Germany
  [47.3, 55.1, 5.9, 15.1, 'de', 'de'],
  // Netherlands
  [50.8, 53.6, 3.3, 7.3, 'nl', 'nl'],
  // Belgium
  [49.5, 51.5, 2.5, 6.4, 'be', 'fr'],
  // Portugal (before Spain — overlapping western coast)
  [36.8, 42.2, -9.5, -6.2, 'pt', 'pt'],
  // Spain (before France — southern overlap zone is mostly Spain)
  [35.9, 43.8, -9.3, 4.3, 'es', 'es'],
  // Italy (before France — western boundary set east of Nice to avoid overlap)
  [36.6, 47.1, 7.5, 18.5, 'it', 'it'],
  // France
  [41.3, 51.1, -5.2, 9.6, 'fr', 'fr'],
  // Poland
  [49.0, 54.9, 14.1, 24.2, 'pl', 'pl'],
  // Czech Republic
  [48.6, 51.1, 12.1, 18.9, 'cz', 'cs'],
  // Denmark
  [54.6, 57.8, 8.1, 15.2, 'dk', 'da'],
  // Finland (before Sweden/Norway to avoid being swallowed by Norway's wide bbox)
  [59.8, 70.1, 20.0, 31.6, 'fi', 'fi'],
  // Sweden
  [55.3, 69.1, 11.1, 24.2, 'se', 'sv'],
  // Norway (wide bbox is safe because Finland and Sweden are matched first)
  [57.9, 71.2, 4.6, 31.1, 'no', 'no'],
  // Greece
  [34.8, 41.7, 19.4, 29.6, 'gr', 'el'],
  // Turkey
  [36.0, 42.1, 26.0, 44.8, 'tr', 'tr'],
  // Brazil
  [-33.8, 5.3, -73.9, -34.8, 'br', 'pt'],
  // Australia
  [-43.7, -10.7, 113.3, 153.7, 'au', 'en'],
  // Japan
  [30.0, 45.6, 129.5, 145.8, 'jp', 'ja'],
  // UK
  [49.9, 60.9, -8.2, 1.8, 'gb', 'en'],
  // USA (contiguous)
  [24.5, 49.4, -125.0, -66.9, 'us', 'en'],
];

// Maps language code to Serper gl/hl and local search terms
const LANGUAGE_CONFIG = {
  de: {
    openplay: [
      'Beachvolleyball mitspielen',
      'Beach Volleyball offenes Spiel',
      'Beachvolleyball freies Spiel',
      'Beachvolleyball open play',
    ],
    tournaments: [
      'Beachvolleyball Turnier',
      'Beach Volleyball Meisterschaft',
      'Beachvolleyball Wettbewerb',
    ],
  },
  fr: {
    openplay: [
      'beach volley jeu libre',
      'beach volley session ouverte',
      'beach volley entrainement libre',
    ],
    tournaments: [
      'tournoi beach volley',
      'compétition beach volley',
      'championnat beach volley',
    ],
  },
  es: {
    openplay: [
      'voley playa juego abierto',
      'voley playa pickup',
      'voley playa sesión libre',
    ],
    tournaments: [
      'torneo voley playa',
      'campeonato voley playa',
      'competición vóley playa',
    ],
  },
  it: {
    openplay: [
      'beach volley gioco libero',
      'beach volley partita aperta',
      'beach volley sessione aperta',
    ],
    tournaments: [
      'torneo beach volley',
      'campionato beach volley',
      'gara beach volley',
    ],
  },
  nl: {
    openplay: [
      'beachvolleybal open spel',
      'beachvolleybal inspelen',
      'beachvolleybal vrij spelen',
    ],
    tournaments: [
      'beachvolleybal toernooi',
      'beachvolleybal competitie',
      'beachvolleybal kampioenschap',
    ],
  },
  pt: {
    openplay: [
      'vôlei de praia jogo aberto',
      'vôlei de praia pickup',
      'voleibol de praia sessão livre',
    ],
    tournaments: [
      'torneio vôlei de praia',
      'campeonato vôlei de praia',
      'competição vôlei de praia',
    ],
  },
  ja: {
    openplay: [
      'ビーチバレー オープンプレー',
      'ビーチバレー 参加自由',
    ],
    tournaments: [
      'ビーチバレー 大会',
      'ビーチバレー トーナメント',
    ],
  },
  el: {
    openplay: [
      'beach volley ελεύθερο παιχνίδι',
      'beach volley ανοιχτό παιχνίδι',
    ],
    tournaments: [
      'τουρνουά beach volley',
      'αγώνες beach volley',
    ],
  },
  pl: {
    openplay: [
      'siatkówka plażowa otwarta gra',
      'siatkówka plażowa wolna gra',
    ],
    tournaments: [
      'turniej siatkówki plażowej',
      'mistrzostwa siatkówka plażowa',
    ],
  },
  tr: {
    openplay: [
      'plaj voleybolu açık oyun',
      'plaj voleybolu serbest oyun',
    ],
    tournaments: [
      'plaj voleybolu turnuva',
      'plaj voleybolu şampiyona',
    ],
  },
  no: {
    openplay: [
      'sandvolleyball åpent spill',
      'beachvolleyball fri spilling',
    ],
    tournaments: [
      'sandvolleyball turnering',
      'beachvolleyball konkurranse',
    ],
  },
  fi: {
    openplay: [
      'beach volley avoin peli',
      'rantalentopallo vapaa peli',
    ],
    tournaments: [
      'beach volley turnaus',
      'rantalentopallo kilpailu',
    ],
  },
  da: {
    openplay: [
      'beachvolley åbent spil',
      'beachvolley fri leg',
    ],
    tournaments: [
      'beachvolley turnering',
      'beachvolley stævne',
    ],
  },
  sv: {
    openplay: [
      'beachvolley öppet spel',
      'beachvolley fri spel',
    ],
    tournaments: [
      'beachvolley turnering',
      'beachvolley tävling',
    ],
  },
  cs: {
    openplay: [
      'plážový volejbal volná hra',
      'plážový volejbal open play',
    ],
    tournaments: [
      'turnaj plážový volejbal',
      'soutěž plážový volejbal',
    ],
  },
};

function localeFromCoords(lat, lng) {
  if (lat == null || lng == null) return null;
  for (const [minLat, maxLat, minLng, maxLng, countryCode, language] of COORD_TABLE) {
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
      return { countryCode, language, gl: countryCode, hl: language };
    }
  }
  return null;
}

function getLocalQueries(type, locale) {
  if (!locale || locale.language === 'en') return [];
  const terms = LANGUAGE_CONFIG[locale.language];
  if (!terms) return [];
  return terms[type] || [];
}

module.exports = { localeFromCoords, getLocalQueries, LANGUAGE_CONFIG };
