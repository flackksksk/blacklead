# BLACKLEAD

BLACKLEAD é um app web estático em um único arquivo `index.html`, com painel de leads, pipeline comercial, exportação CSV e mapa com MapLibre/MapTiler.

A única variável obrigatória para a funcionalidade do mapa é `MAPTILER_API_KEY`.

## Publicação na Vercel

1. Faça o push do repositório para o GitHub.
2. No Vercel, importe o projeto com o preset `Other`.
3. Não configure build command; mantenha em branco.
4. Em `Settings > Environment Variables`, adicione `MAPTILER_API_KEY` com o valor da sua chave do MapTiler.
5. Faça um `Redeploy`.

A chave do MapTiler deve ser criada em https://cloud.maptiler.com/account/keys/ e restrita em "Allowed HTTP origins".
