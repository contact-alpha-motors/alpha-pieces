# Alpha Motors — Suivi des commandes et du stock de pièces

Application web + bot Telegram + assistant IA (GLM 5.3 Flash via OpenRouter), sur une seule base PostgreSQL.

```
 Navigateur ──┐                                  ┌── PostgreSQL (pièces, stock, historique, utilisateurs)
              ├── nginx proxy manager (HTTPS) ── App Node.js ──┤
 Telegram  ───┘        /telegram/webhook         └── OpenRouter (IA, texte + photos)
```

Toute la logique métier est dans `src/services/` : le site, le bot et l'IA appliquent exactement les mêmes règles et écrivent le même historique.

## Rôles

| Action | Admin (IT) | Boss | Magasinier | Atelier |
|---|:-:|:-:|:-:|:-:|
| Consulter commandes, stock, historique | ✅ | ✅ | ✅ | ✅ |
| Ajouter / modifier des pièces, changer les statuts | ✅ | ✅ | ✅ | — |
| Passer une pièce à « Validée » | ✅ | ✅ | — | — |
| Passer une pièce « Reçue » → « Montée » | ✅ | ✅ | ✅ | ✅ |
| Supprimer une pièce | ✅ | ✅ | — | — |
| Entrées / sorties de stock | ✅ | ✅ | ✅ | — |
| Gérer les utilisateurs | ✅ | — | — | — |

Règle de stock : une pièce passée à **Reçue** entre en stock, passée à **Montée** elle en sort. Un retour en arrière corrige automatiquement.

## Prérequis

- Un VPS Linux avec **Docker**, **Docker Compose**, **Portainer**, et **nginx proxy manager** (NPM) déjà en place pour gérer les ports 80/443 et le HTTPS des différents sites.
- Un réseau Docker externe partagé entre NPM et cette stack (ex. `proxy`) : `docker network create proxy` s'il n'existe pas encore, puis attacher le conteneur NPM à ce réseau (Portainer → conteneur NPM → Network → connect).
- Un nom de domaine pointant vers l'IP du VPS (ex. `pieces.alphamotors.cm`). Telegram exige HTTPS pour le webhook ; c'est NPM qui obtient le certificat Let's Encrypt.
- Un bot Telegram : dans Telegram, parler à **@BotFather** → `/newbot` → récupérer le token.
- Une clé **OpenRouter** (openrouter.ai → Keys), avec un peu de crédit.

## Installation

```bash
git clone <depot> alpha-pieces && cd alpha-pieces     # ou décompresser l'archive
cp .env.example .env
nano .env                                             # remplir toutes les valeurs
#   JWT_SECRET               : openssl rand -hex 32
#   TELEGRAM_WEBHOOK_SECRET  : openssl rand -hex 24
#   DATABASE_URL             : même mot de passe que POSTGRES_PASSWORD

docker compose up -d --build
docker compose logs -f app        # attendre « Alpha Pièces sur le port 3000 » et « webhook actif »

# Créer le premier compte admin
docker compose exec app node src/scripts/create-admin.js "Nom IT" it@alphamotors.cm "MotDePasseSolide"
```

Dans **nginx proxy manager**, créer un Proxy Host :
- Domain: le domaine du site (ex. `pieces.alphamotors.cm`)
- Forward Hostname/IP: `app` (nom du service, résolu via le réseau Docker `proxy`)
- Forward Port: `3000`
- Activer SSL → demander un certificat Let's Encrypt, forcer HTTPS.

Au premier démarrage, la base est créée et les données initiales sont importées (bon de commande du 11/09/2026 et facture M6 Plus). Pour démarrer à vide : `SEED=non` dans `.env` avant le premier lancement.

Ouvrir `https://votre-domaine`, se connecter, puis créer les comptes dans l'onglet **Utilisateurs**.

## Lier Telegram (chaque utilisateur)

1. Sur le site : **Mon compte → Générer un code de liaison**.
2. Cliquer sur le lien du bot, ou envoyer `/lier 123456` au bot. Le code expire après 10 minutes.
3. Le bot ignore toute personne non liée. Un admin peut délier un compte, et désactiver un utilisateur coupe aussi son accès Telegram.

## Utiliser le bot

- Questions : « Qu'est-ce qui manque pour la Haval ? », « Quelles pièces n'ont pas de prix ? », « Combien de phares Dongfeng en stock ? »
- Mises à jour : « Reçu les 12 injecteurs Rich 6 », « Prix du capot pick-up : 185 000 », « Sors 2 bougies Rich 6 »
- Photos : envoyer la photo d'une facture ou d'un bon fournisseur → l'IA lit les lignes et propose de les ajouter.
- `/oublier` remet la conversation à zéro.

**Sécurité IA :** l'IA peut lire librement, mais ne modifie jamais rien seule. Chaque modification arrive avec des boutons **✅ Confirmer / ❌ Annuler**, reste valable 1 heure, vérifie les droits du rôle et est inscrite dans l'historique avec la mention « Telegram ».

## Exploitation

```bash
docker compose logs -f app                       # journaux
docker compose pull && docker compose up -d --build   # mise à jour
# Sauvegarde quotidienne (à mettre dans cron)
docker compose exec -T db pg_dump -U alpha alpha_pieces | gzip > /backup/pieces-$(date +%F).sql.gz
# Restauration
gunzip -c sauvegarde.sql.gz | docker compose exec -T db psql -U alpha alpha_pieces
```

Test local sans domaine : `TELEGRAM_MODE=polling` dans `.env` (pas besoin de HTTPS), puis accéder au port 3000 en ajoutant `ports: ["3000:3000"]` au service `app`.

## Coût IA

Modèle `z-ai/glm-5.3-flash` : environ 0,15 $ / million de tokens en entrée et 0,50 $ en sortie (tarif après promotion de lancement), plus 5,5 % de frais OpenRouter. Un échange avec recherche coûte une fraction de franc CFA ; une photo coûte davantage. Surveiller la consommation sur openrouter.ai et fixer une limite de crédit. Le modèle se change dans `.env` (`AI_MODEL`) sans toucher au code.

## Structure

```
db/schema.sql            tables et contraintes
db/seed.sql              données initiales
src/services/            logique métier + permissions (source unique de vérité)
src/routes/api.js        API REST du site
src/bot/telegram.js      bot : liaison, messages, photos, boutons de confirmation
src/ai/agent.js          agent IA : outils de lecture + propositions à confirmer
public/                  interface web
```

## Pistes pour la suite

Notifications Telegram automatiques (pièce en retard, stock bas, devis à valider), photos de pièces stockées sur les lignes, export Excel, messages vocaux, table dédiée aux fournisseurs et aux commandes.
