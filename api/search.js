// Busca de empresas por palavra-chave e cidade no OpenStreetMap (Nominatim + Overpass).
// Gratuito e sem chave. Uso educado dos servidores comunitários: cache, limite por IP e User-Agent identificado.
// Opcional: defina OSM_CONTACT (e-mail ou site) na Vercel para identificar sua ferramenta no User-Agent.
const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const UA = "BLACKLEAD/1.0 (" + (process.env.OSM_CONTACT || "ferramenta pessoal de prospecção") + ")";
const OK = /^[\p{L}\p{N} '\-]{2,60}$/u;
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const CLS = { a: "aáàâãä", e: "eéèêë", i: "iíìîï", o: "oóòôõö", u: "uúùûü", c: "cç", n: "nñ" };
const CATS = [
  [/^restaurant|^lanchonet/, ['["amenity"~"^(restaurant|fast_food)$"]']],
  [/^pizz/, ['["cuisine"~"pizza"]']],
  [/^barbear|^salao|^cabeleir|^beleza/, ['["shop"~"^(hairdresser|beauty)$"]']],
  [/^oficina|^mecanic/, ['["shop"="car_repair"]']],
  [/^clinic|^medic|^consultorio/, ['["amenity"~"^(clinic|doctors)$"]']],
  [/^dentist|^odonto/, ['["amenity"="dentist"]']],
  [/^academia/, ['["leisure"="fitness_centre"]']],
  [/^farmaci|^drogaria/, ['["amenity"="pharmacy"]']],
  [/^mercad|^supermerc/, ['["shop"~"^(supermarket|convenience)$"]']],
  [/^padaria|^confeit/, ['["shop"~"^(bakery|pastry)$"]']],
  [/^loja de roupa|^roupa|^moda/, ['["shop"="clothes"]']],
  [/^material de constr|^construc/, ['["shop"~"^(doityourself|hardware|building_materials)$"]']],
  [/^imobiliar/, ['["office"="estate_agent"]']],
  [/^autopec/, ['["shop"="car_parts"]']],
  [/^escola|^colegio/, ['["amenity"~"^(school|kindergarten)$"]']],
  [/^hotel|^pousada/, ['["tourism"~"^(hotel|guest_house|hostel)$"]']],
];
const PT = { restaurant: "Restaurante", fast_food: "Lanchonete", cafe: "Café", bar: "Bar", pharmacy: "Farmácia", clinic: "Clínica", doctors: "Consultório médico", dentist: "Dentista", school: "Escola", hairdresser: "Salão de beleza", beauty: "Estética", car_repair: "Oficina mecânica", supermarket: "Supermercado", convenience: "Mercearia", bakery: "Padaria", pastry: "Confeitaria", clothes: "Loja de roupas", car_parts: "Autopeças", fitness_centre: "Academia", hotel: "Hotel", guest_house: "Pousada", estate_agent: "Imobiliária", hardware: "Ferragens", doityourself: "Materiais de construção" };
const label = (t) => PT[t.amenity] || PT[t.shop] || PT[t.leisure] || PT[t.tourism] || PT[t.office] || t.shop || t.amenity || t.office || t.craft || "";
function rx(s) {
  let n = norm(s).replace(/[^a-z0-9 ]/g, "").trim();
  if (n.length > 4) n = n.replace(/s$/, "");
  return n.split("").map((c) => (CLS[c] ? "[" + CLS[c] + "]" : c)).join("");
}
function buildQuery(term, areaId, limit) {
  const n = norm(term).trim();
  const tags = (CATS.find(([r]) => r.test(n)) || [, []])[1];
  const parts = ['nwr["name"~"' + rx(term) + '",i](area.a);'].concat(tags.map((f) => "nwr" + f + '["name"](area.a);'));
  return "[out:json][timeout:25];area(" + (3600000000 + areaId) + ")->.a;(" + parts.join("") + ");out tags center " + limit + ";";
}
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return arr.length > 10;
}
async function getJson(url, opt) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(25000) }, opt));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
module.exports = async (req, res) => {
  const site = req.headers["sec-fetch-site"];
  if (req.method !== "GET" || (site && site !== "same-origin" && site !== "none")) return res.status(403).json({ error: "Acesso negado." });
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  if (limited(ip)) return res.status(429).json({ error: "Muitas buscas seguidas. Aguarde um minuto." });
  const q = String(req.query.q || "").trim(), city = String(req.query.city || "").trim(), uf = String(req.query.uf || "").toUpperCase();
  if (!OK.test(q) || !OK.test(city) || (uf && !UFS.has(uf))) return res.status(400).json({ error: "Pesquisa inválida. Use de 2 a 60 letras ou números." });
  try {
    const nom = await getJson("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&q=" + encodeURIComponent(city + (uf ? ", " + uf : "") + ", Brasil"), { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" } });
    const place = nom.find((p) => p.osm_type === "relation" && p.category === "boundary");
    if (!place) return res.status(404).json({ error: "Não encontrei o limite da cidade “" + city + "”. Confira o nome e o estado." });
    const ql = buildQuery(q, Number(place.osm_id), 60);
    let data = null;
    for (const ep of OVERPASS) {
      try {
        const j = await getJson(ep, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(ql) });
        if (j.remark && !(j.elements || []).length) continue;
        data = j; break;
      } catch (e) { /* tenta o próximo servidor */ }
    }
    if (!data) return res.status(502).json({ error: "O servidor do OpenStreetMap está ocupado. Tente de novo em instantes." });
    const seen = new Set(), items = [];
    for (const el of data.elements || []) {
      const t = el.tags || {}, c = el.center || { lat: el.lat, lon: el.lon };
      if (!t.name || c.lat == null || !["node", "way", "relation"].includes(el.type) || !Number.isInteger(el.id)) continue;
      const k = norm(t.name) + "|" + c.lat.toFixed(3) + "|" + c.lon.toFixed(3);
      if (seen.has(k)) continue; seen.add(k);
      items.push({
        t: el.type, id: el.id, name: t.name.slice(0, 120), cat: label(t),
        addr: [(t["addr:street"] || "") + (t["addr:housenumber"] ? ", " + t["addr:housenumber"] : ""), t["addr:suburb"]].filter(Boolean).join(" - ").slice(0, 160),
        phone: String(t.phone || t["contact:phone"] || t["contact:mobile"] || "").split(";")[0].trim().slice(0, 40),
        web: String(t.website || t["contact:website"] || "").slice(0, 200),
        ig: String(t["contact:instagram"] || "").slice(0, 80),
        lat: +c.lat, lng: +c.lon,
      });
    }
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=604800");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ error: "Não foi possível consultar o OpenStreetMap agora. Tente de novo em instantes." });
  }
};
