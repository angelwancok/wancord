# Wancord

Clone estilo Discord com chat em tempo real, chamadas de voz/vídeo e
compartilhamento de tela (via WebRTC), e uma senha de acesso ao site.

## O que tem pronto

- Tela de senha: só entra quem digitar a senha correta (padrão: `amoalara1910`)
- Criar servidores públicos ou privados (privados exigem senha própria)
- Convite por código para servidores privados
- Criar canais de texto e de voz dentro de cada servidor
- Chat de texto em tempo real
- Chamadas de voz e vídeo em grupo (WebRTC, ponto a ponto — a menor
  latência tecnicamente possível, sem passar por um servidor no meio)
- Compartilhamento de tela (corrigido: agora continua aparecendo mesmo se
  alguém sair e voltar da chamada, sem precisar reiniciar o compartilhamento)
- Lista de quem está em cada sala de voz, aparecendo/sumindo em tempo real
  (embaixo do canal, e como avatar com nome dentro da chamada)
- Mudo/desmudo do microfone
- Desativar som (deafen) — silencia o que você ouve dos outros, separado
  do mudo do microfone (igual Discord)
- Ligar/desligar câmera

## Rodando localmente

Precisa ter [Node.js](https://nodejs.org) 18+ instalado.

```bash
npm install
npm start
```

Depois abra `http://localhost:3000` no navegador. A senha padrão é
`amoalara1910` (pode trocar, veja abaixo).

## Trocar a senha e outras configurações

Você pode trocar a senha e o segredo da sessão por variáveis de ambiente,
sem mexer no código:

```bash
SITE_PASSWORD=suasenha SESSION_SECRET=algosecreto npm start
```

Se não definir nada, o site usa `amoalara1910` como senha padrão (já
vem configurada no `server.js`).

## Colocando no GitHub

```bash
cd wancord
git init
git add .
git commit -m "Wancord inicial"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/wancord.git
git push -u origin main
```

## Colocando no ar (hospedagem)

**Importante:** este projeto usa Socket.io (WebSocket) e precisa de um
servidor Node.js rodando de verdade — **não funciona no GitHub Pages**,
que só serve arquivos estáticos. Use um destes serviços gratuitos/baratos
que rodam Node.js:

### Render.com (recomendado, tem plano gratuito)
1. Crie uma conta em https://render.com
2. "New +" → "Web Service" → conecte seu repositório do GitHub
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Em "Environment", adicione a variável `SITE_PASSWORD` se quiser trocar
   a senha (opcional)
6. Deploy. Você recebe uma URL tipo `https://wancord.onrender.com`

### Railway.app
1. https://railway.app → "New Project" → "Deploy from GitHub repo"
2. Ele detecta o Node.js automaticamente e já sobe
3. Configure variáveis de ambiente em "Variables" se quiser

### Fly.io / Heroku / VPS próprio
Também funcionam — qualquer lugar que rode `npm install && npm start`
com Node 18+ serve.

## Limitações importantes (para você saber, sem enrolação)

- **Armazenamento em memória**: servidores, canais e mensagens ficam na
  memória do servidor. Se o processo reiniciar (comum em planos
  gratuitos que "dormem"), tudo é apagado. Para persistir dados de
  verdade, seria preciso adicionar um banco de dados (ex: SQLite,
  MongoDB, Postgres) — posso te ajudar a adicionar isso se quiser.
- **Chamadas em grupo grandes**: o modelo usado é "mesh" (cada pessoa
  conecta diretamente com todas as outras). Funciona muito bem para
  grupos pequenos/médios (até uns 6-8 pessoas por chamada). Para
  dezenas de pessoas ao mesmo tempo, o Discord de verdade usa um
  servidor de mídia (SFU) — isso é bem mais complexo de montar.
  Nenhuma tecnologia consegue garantir "zero delay e zero travamento"
  o tempo todo — isso depende também da internet de cada pessoa — mas
  o WebRTC ponto a ponto é a abordagem mais rápida que existe.
  Compartilhamento de tela usa a mesma conexão, então mesma lógica.
- **Senha simples**: a senha do site é uma senha única compartilhada
  (não é um sistema de contas com usuário/senha individual). Serve bem
  para uso pessoal/entre amigos, mas não é um sistema de autenticação
  robusto para uso público em grande escala.
