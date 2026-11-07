// Função serverless da Vercel: entrega ao navegador a chave do MapTiler lida da variável de ambiente.
// A chave nunca fica em arquivos do projeto. Proteja-a no painel do MapTiler com "Allowed HTTP origins".
module.exports = (req, res) => {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ maptilerKey: process.env.MAPTILER_API_KEY || null });
};
