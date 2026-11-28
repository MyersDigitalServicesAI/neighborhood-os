// Search filters for events, read from a query string. Anything unexpected is dropped, so only known values reach
// the database and the cached public page can't be given endless variations.
export const eventCategories = [
  ['family','Family & kids'],['arts','Arts & culture'],['food','Food & markets'],['civic','Civic & government'],
  ['community','Volunteering & community'],['outdoors','Sports & outdoors'],['classes','Classes & library'],['holiday','Holiday & seasonal'],['other','Other']
];
export const radiusMiles = [1,3,5,10];
export const eventSpans = [['','All upcoming'],['today','Today'],['tomorrow','Tomorrow'],['weekend','This weekend'],['week','Next 7 days']];

export function searchFilters(params) {
  const get = (name) => params.get(name) ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(get('day')) && !Number.isNaN(Date.parse(get('day')+'T12:00:00Z')) ? get('day') : '';
  return {
    cat: eventCategories.some(([key])=>key===get('cat')) ? get('cat') : '',
    miles: radiusMiles.includes(Number(get('miles'))) ? String(Number(get('miles'))) : '',
    day,
    mine: get('mine')==='neighbors' ? 'neighbors' : ''
  };
}
