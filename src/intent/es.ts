/**
 * Spanish, because the product was unusable for the person who owns it.
 *
 * Every keyword and every mood trigger was English. Typing "haz que llueva" — the most
 * obvious sentence its owner could write — was rejected, and so was every other
 * Spanish phrase tried: 2 of 32 ordinary utterances resolved, and the two that did
 * were the ones written in English.
 *
 * This is not a translation layer in any serious sense. It maps Spanish words onto the
 * catalogue's existing keywords before matching, so a Spanish utterance reaches exactly
 * the same primitives, the same contracts and the same oracles as an English one. A
 * hosted model handles either language natively; this is the floor doing its job in
 * both.
 */
const LEXICON: Readonly<Record<string, string>> = {
  // Function words, mapped rather than listed as filler. FILLER is English and already
  // holds `the`, `of`, `with`; translating into it means one list rather than two, and
  // the one that exists is the one already being maintained.
  el: 'the', la: 'the', los: 'the', las: 'the', un: 'a', una: 'a', unos: 'a', unas: 'a',
  de: 'of', del: 'of', en: 'in', con: 'with', y: 'and', o: 'or',
  sobre: 'over', para: 'for', por: 'for', muy: 'very', más: 'more', mas: 'more',
  quiero: 'make', quiere: 'make', hazlo: 'make', haz: 'make', pon: 'put', ponle: 'put',
  ver: 'see', mira: 'see', dame: 'give',
  // weather
  lluvia: 'rain', llueva: 'rain', llover: 'rain', lloviendo: 'rain', llueve: 'rain',
  nieve: 'snow', nieva: 'snow', nevando: 'snow', nevada: 'snow',
  niebla: 'fog', neblina: 'fog', bruma: 'fog', brumoso: 'fog',
  viento: 'wind', ventoso: 'wind', brisa: 'wind',
  tormenta: 'storm', tormentoso: 'storm', temporal: 'storm',
  rayo: 'lightning', rayos: 'lightning', relámpago: 'lightning', relampago: 'lightning',
  trueno: 'thunder', truenos: 'thunder',
  // time and light
  día: 'day', dia: 'day', diurno: 'day',
  noche: 'night', nocturno: 'night', oscuro: 'night', oscuridad: 'night',
  amanecer: 'dawn', amanece: 'dawn', amaneciendo: 'dawn', alba: 'dawn', madrugada: 'dawn',
  atardecer: 'sunset', ocaso: 'sunset', anochecer: 'dusk', anochece: 'dusk', crepúsculo: 'dusk', crepusculo: 'dusk',
  mediodía: 'noon', mediodia: 'noon', tarde: 'afternoon', mañana: 'morning', manana: 'morning',
  luz: 'light', luces: 'light', iluminación: 'light', iluminacion: 'light',
  sol: 'day', luna: 'night', estrellas: 'night',
  // water and ground
  agua: 'water', mar: 'water', océano: 'water', oceano: 'water', lago: 'water',
  inundado: 'flooded', inundada: 'flooded', inundación: 'flooded', inundacion: 'flooded',
  suelo: 'ground', tierra: 'ground', arena: 'desert', desierto: 'desert',
  // structure
  torre: 'tower', torres: 'tower', rascacielos: 'skyline', edificio: 'skyline',
  edificios: 'skyline', ciudad: 'city', altos: 'taller', alto: 'taller', alta: 'taller',
  altas: 'taller', grande: 'taller', grandes: 'taller',
  // spectacle
  aurora: 'aurora', boreal: 'aurora',
  pájaros: 'flock', pajaros: 'flock', aves: 'flock', bandada: 'flock',
  reflectores: 'searchlights', focos: 'searchlights', haces: 'searchlights',
  // moods
  acogedor: 'cozy', cálido: 'cozy', calido: 'cozy', hogareño: 'cozy',
  apocalíptico: 'apocalyptic', apocaliptico: 'apocalyptic', peligroso: 'dangerous',
  amenazante: 'ominous', sombrío: 'ominous', sombrio: 'ominous',
  dramático: 'dramatic', dramatico: 'dramatic', épico: 'epic', epico: 'epic',
  cinematográfico: 'cinematic', cinematografico: 'cinematic',
  tranquilo: 'peaceful', calmado: 'calm', sereno: 'serene', pacífico: 'peaceful',
  pacifico: 'peaceful', silencioso: 'quiet',
  bonito: 'beautiful', hermoso: 'beautiful', precioso: 'gorgeous', bello: 'beautiful',
  espectacular: 'spectacular', increíble: 'amazing', increible: 'amazing',
  sorpréndeme: 'surprise me', sorprendeme: 'surprise me',
  ambiente: 'atmosphere', atmósfera: 'atmosphere', atmosfera: 'atmosphere',
  submarino: 'underwater', bajo: 'underwater',
  // Requests that name a property the catalogue does have, phrased as a verb it does
  // not. "hazlo rojo" is a ground tint; "cambia el cielo" is a time of day. Rejecting
  // these taught the user the world was broken when it simply had a different name for
  // what they wanted.
  rojo: 'ground-tint', roja: 'ground-tint', azul: 'ground-tint', verde: 'ground-tint',
  dorado: 'ground-tint', color: 'ground-tint', colores: 'ground-tint',
  cielo: 'day', celeste: 'day',
  algo: 'surprise me', cualquier: 'surprise me', lo: '', que: '',
};

/**
 * Rewrites Spanish words into the catalogue's own vocabulary, leaving everything else
 * untouched. Additive by design: an English utterance passes through unchanged, and a
 * mixed one ("make it acogedor") resolves too.
 */
/**
 * The translated form alone, for deciding what went unaddressed.
 *
 * `toCatalogueVocabulary` deliberately keeps both the original and the translation so
 * matching sees each, and that is right for matching and wrong for disclosure: every
 * Spanish word the lexicon *did* translate was still present in its original spelling,
 * matched nothing, and was reported as something the catalogue could not express.
 * "una noche de tormenta" rendered night, rain, wind and lightning and then told the
 * user it could not do `noche` or `tormenta`. The owner of this project types Spanish,
 * so this was the failure mode on the path most likely to be used.
 *
 * Every word here is either translated — and can therefore match — or left alone, and
 * a word left alone genuinely is unknown. That makes this the honest basis for the
 * claim, where the doubled text is the useful basis for the search.
 */
export function toTranslatedVocabulary(utterance: string): string {
  return utterance
    .toLowerCase()
    .split(/([^\p{L}\p{N}]+)/u)
    .map((part) => LEXICON[part] ?? part)
    .join('');
}

export function toCatalogueVocabulary(utterance: string): string {
  const mapped = toTranslatedVocabulary(utterance);
  // Both are kept: the original may contain an English keyword the lexicon would
  // never have touched, and dropping it to make room for a translation would trade one
  // rejection for another.
  return mapped === utterance.toLowerCase() ? utterance : `${utterance} ${mapped}`;
}
