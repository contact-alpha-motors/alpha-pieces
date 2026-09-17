-- Alpha Motors — suivi des pièces. Idempotent : peut être relancé.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS utilisateurs (
  id            SERIAL PRIMARY KEY,
  nom           TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','boss','magasinier','atelier')),
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_id   BIGINT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS codes_liaison (
  code        TEXT PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  expire_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pieces (
  id           SERIAL PRIMARY KEY,
  commande     TEXT NOT NULL,
  vehicule     TEXT NOT NULL,
  vin          TEXT NOT NULL DEFAULT '',
  ref          TEXT NOT NULL DEFAULT '',
  designation  TEXT NOT NULL,
  emplacement  TEXT NOT NULL DEFAULT '',
  qte          INT  NOT NULL DEFAULT 1 CHECK (qte >= 0),
  unite        TEXT NOT NULL DEFAULT '',
  prix         NUMERIC(14,0),
  fournisseur  TEXT NOT NULL DEFAULT '',
  statut       TEXT NOT NULL DEFAULT 'demandee'
               CHECK (statut IN ('demandee','devis','validee','commandee','recue','montee')),
  date_prevue  DATE,
  note         TEXT NOT NULL DEFAULT '',
  ordre        INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   INT REFERENCES utilisateurs(id)
);
CREATE INDEX IF NOT EXISTS pieces_commande_idx ON pieces(commande);
CREATE INDEX IF NOT EXISTS pieces_statut_idx   ON pieces(statut);

CREATE TABLE IF NOT EXISTS stock (
  id           SERIAL PRIMARY KEY,
  cle          TEXT NOT NULL UNIQUE,
  designation  TEXT NOT NULL,
  ref          TEXT NOT NULL DEFAULT '',
  vehicule     TEXT NOT NULL DEFAULT '',
  qte          INT  NOT NULL DEFAULT 0 CHECK (qte >= 0),
  seuil        INT  NOT NULL DEFAULT 0,
  rayon        TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historique (
  id        BIGSERIAL PRIMARY KEY,
  texte     TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'commande' CHECK (type IN ('commande','stock','utilisateur','systeme')),
  source    TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','telegram','systeme')),
  user_id   INT REFERENCES utilisateurs(id),
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historique_at_idx ON historique(at DESC);

-- Actions proposées par l'IA, exécutées seulement après confirmation humaine.
CREATE TABLE IF NOT EXISTS actions_en_attente (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  action      JSONB NOT NULL,
  resume      TEXT NOT NULL,
  statut      TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente','executee','annulee')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
