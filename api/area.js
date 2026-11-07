// Busca de empresas dentro de uma área do mapa (caixa de coordenadas) no OpenStreetMap.
// Gratuito e sem chave. Opcional: defina OSM_CONTACT (e-mail ou site) na Vercel.
const UA = "BLACKLEAD/1.0 (" + (process.env.OSM_CONTACT || "ferramenta pessoal de prospecção") + ")";
const OK = /^[\p{L}\p{N} '\-]{0,40}$/u;
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter"];
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const CLS = { a: "aáàâãä", e: "eéèêë", i: "iíìîï", o: "oóòôõö", u: "uúùûü", c: "cç", n: "nñ" };
const CATS = [
  [/^restaurant|^lanchonet/, ['["amenity"~"^(restaurant|fast_food)$"]']], [/^pizz/, ['["cuisine"~"pizza"]']],
  [/^barbear|^salao|^cabeleir|^beleza/, ['["shop"~"^(hairdresser|beauty)$"]']], [/^oficina|^mecanic/, ['["shop"="car_repair"]']],
  [/^clinic|^medic|^consultorio/, ['["amenity"~"^(clinic|doctors)$"]']], [/^dentist|^odonto/, ['["amenity"="dentist"]']],
  [/^academia/, ['["leisure"="fitness_centre"]']], [/^farmaci|^drogaria/, ['["amenity"="pharmacy"]']],
  [/^mercad|^supermerc/, ['["shop"~"^(supermarket|convenience)$"]']], [/^padaria|^confeit/, ['["shop"~"^(bakery|pastry)$"]']],
  [/^loja de roupa|^roupa|^moda/, ['["shop"="clothes"]']], [/^imobiliar/, ['["office"="estate_agent"]']],
  [/^autopec/, ['["shop"="car_parts"]']], [/^escola|^colegio/, ['["amenity"~"^(school|kindergarten)$"]']],
  [/^hotel|^pousada/, ['["tourism"~"^(hotel|guest_house|hostel)$"]']],
];
const PT = { restaurant: "Restaurante", fast_food: "Lanchonete", cafe: "Café", bar: "Bar", pharmacy: "Farmácia", clinic: "Clínica", doctors: "Consultório médico", dentist: "Dentista", school: "Escola", hairdresser: "Salão de beleza", beauty: "Estética", car_repair: "Oficina mecânica", supermarket: "Supermercado", convenience: "Mercearia", bakery: "Padaria", pastry: "Confeitaria", clothes: "Loja de roupas", car_parts: "Autopeças", fitness_centre: "Academia", hotel: "Hotel", guest_house: "Pousada", estate_agent: "Imobiliária", hardware: "Ferragens" };
const label = (t) => PT[t.amenity] || PT[t.shop] || PT[t.leisure] || PT[t.tourism] || PT[t.office] || t.shop || t.amenity || t.office || t.craft || "";
const KEYS = ["amenity", "shop", "office", "craft", "tourism", "leisure", "healthcare"];
const BIZ = ['["shop"]', '["office"]', '["craft"]', '["amenity"~"^(restaurant|fast_food|cafe|bar|pub|pharmacy|clinic|doctors|dentist|veterinary|bank|car_wash|fuel|driving_school|language_school|childcare)$"]', '["tourism"~"^(hotel|guest_house|hostel|motel)$"]', '["leisure"~"^(fitness_centre|sports_centre)$"]'];
function rx(s) {
  let n = norm(s).replace(/[^a-z0-9 ]/g, "").trim();
  if (n.length > 4) n = n.replace(/s$/, "");
  return n.split("").map((c) => (CLS[c] ? "[" + CLS[c] + "]" : c)).join("");
}
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return arr.length > 15;
}
const DEADLINE = 28000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, opt, cap, t0, ctrl) {
  const ms = Math.min(cap, DEADLINE - (Date.now() - t0));
  if (ms < 1500) throw new Error("tempo esgotado");
  const tmo = AbortSignal.timeout(ms);
  const signal = ctrl && AbortSignal.any ? AbortSignal.any([tmo, ctrl.signal]) : tmo;
  const r = await fetch(url, Object.assign({ signal }, opt));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
function toItem(type, id, t, lat, lon) {
  if (!t.name || lat == null || lon == null || !["node", "way", "relation"].includes(type) || !Number.isInteger(id)) return null;
  return {
    t: type, id: id, name: String(t.name).slice(0, 120), cat: label(t),
    addr: [(t["addr:street"] || "") + (t["addr:housenumber"] ? ", " + t["addr:housenumber"] : ""), t["addr:suburb"]].filter(Boolean).join(" - ").slice(0, 160),
    phone: String(t.phone || t["contact:phone"] || t["contact:mobile"] || "").split(";")[0].trim().slice(0, 40),
    web: String(t.website || t["contact:website"] || "").slice(0, 200),
    ig: String(t["contact:instagram"] || "").slice(0, 80),
    lat: +lat, lng: +lon,
  };
}
function nomItem(p) {
  const a = p.address || {}, t = Object.assign({}, p.extratags || {});
  t.name = p.name; t[p.category] = p.type; t["addr:street"] = a.road; t["addr:housenumber"] = a.house_number; t["addr:suburb"] = a.suburb || a.neighbourhood;
  return toItem(p.osm_type, p.osm_id, t, p.lat, p.lon);
}
module.exports = async (req, res) => {
  const site = req.headers["sec-fetch-site"];
  if (req.method !== "GET" || (site && site !== "same-origin" && site !== "none")) return res.status(403).json({ error: "Acesso negado." });
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  if (limited(ip)) return res.status(429).json({ error: "Muitas buscas seguidas. Aguarde um minuto." });
  const q = String(req.query.q || "").trim();
  const [s, w, n, e] = ["s", "w", "n", "e"].map((k) => Number(req.query[k]));
  if (![s, w, n, e].every(Number.isFinite) || s < -35 || n > 6 || w < -75 || e > -33 || s >= n || w >= e) return res.status(400).json({ error: "Área inválida." });
  if (n - s > 0.25 || e - w > 0.25) return res.status(400).json({ error: "Área grande demais. Aproxime mais o mapa." });
  if (!OK.test(q)) return res.status(400).json({ error: "Termo inválido. Use só letras e números." });
  const bb = "(" + [s, w, n, e].map((v) => v.toFixed(5)).join(",") + ")", re = rx(q), t0 = Date.now();
  const tags = (CATS.find(([r]) => r.test(norm(q))) || [, []])[1];
  const parts = re ? KEYS.map((k) => 'nwr["' + k + '"]["name"~"' + re + '",i]' + bb + ";").concat(tags.map((f) => "nwr" + f + '["name"]' + bb + ";")) : BIZ.map((f) => "nwr" + f + '["name"]' + bb + ";");
  const ql = "[out:json][timeout:10];(" + parts.join("") + ");out tags center 100;";
  let list = null, why = "sem resposta";
  try {
    const ctrl = new AbortController();
    const post = { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(ql) };
    const data = await Promise.any(OVERPASS.map((ep) => getJson(ep, post, 11000, t0, ctrl).then((j) => {
      if (j.remark && !(j.elements || []).length) throw new Error("servidor sobrecarregado");
      return j;
    })));
    ctrl.abort();
    list = (data.elements || []).map((el) => { const c = el.center || { lat: el.lat, lon: el.lon }; return toItem(el.type, el.id, el.tags || {}, c.lat, c.lon); });
  } catch (err) {
    const x = err.errors && err.errors[0] ? err.errors[0] : err;
    why = x.name === "TimeoutError" ? "tempo esgotado" : x.message;
  }
  if (!list || !list.length) {
    const words = re ? [q] : ["restaurante", "loja", "farmácia", "salão", "clínica", "academia"], extra = [];
    for (let i = 0; i < words.length && Date.now() - t0 < DEADLINE - 3500; i++) {
      try {
        if (i) await sleep(1100);
        const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&extratags=1&addressdetails=1&bounded=1&countrycodes=br&viewbox=" + [w, n, e, s].join(",") + "&q=" + encodeURIComponent(words[i]);
        const arr = await getJson(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" } }, 6000, t0);
        arr.filter((p) => KEYS.includes(p.category)).forEach((p) => extra.push(nomItem(p)));
      } catch (err2) { /* segue para o próximo termo */ }
    }
    if (extra.length) list = (list || []).concat(extra);
  }
  if (!list) return res.status(502).json({ error: "O OpenStreetMap não respondeu a tempo (" + why + "). Tente de novo em instantes." });
  const seen = new Set(), items = [];
  for (const it of list) {
    if (!it) continue;
    const k = norm(it.name) + "|" + it.lat.toFixed(3) + "|" + it.lng.toFixed(3);
    if (seen.has(k)) continue; seen.add(k); items.push(it);
  }
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
  return res.status(200).json({ items: items.slice(0, 100) });
};
