Oui, le boss pouvait déjà passer une pièce à « Montée ». Il lui manquait seulement la gestion des utilisateurs. Je lui donne tous les droits.C'est corrigé et vérifié : le boss a maintenant **tous les droits**, y compris la création et la gestion des comptes. L'archive mise à jour est ci-dessous.

---

## Briefing : Alpha Pièces

**Le problème**
Les commandes de pièces se perdaient entre WhatsApp, les PDF et Excel. Personne ne savait avec certitude ce qui était commandé, reçu, en stock ou monté, ni qui s'en occupait. Le but n'est pas de sanctionner, mais de rendre chaque étape visible pour tous.

**La solution**
Une seule base de données, accessible par deux portes :
- **le site web**, pour le bureau et le boss ;
- **Telegram avec un assistant IA**, pour le boss, magasin et l'atelier, depuis le téléphone.

**Le parcours d'une pièce**
Demandée → Devis reçu → Validée → Commandée → Reçue → Montée

- À **Reçue**, la pièce entre automatiquement en stock.
- À **Montée**, elle sort du stock.
- Chaque changement est inscrit dans l'historique : qui, quoi, quand, et si c'était via le site ou Telegram.

**Ce qu'on voit d'un coup d'œil**
- Le nombre de pièces à chaque étape.
- Les alertes : pièces en retard, sans prix, sans référence, stock trop bas.
- L'avancement et le montant en FCFA par véhicule.

**Qui fait quoi**

| | Boss | Admin (IT) | Magasinier | Atelier |
|---|:-:|:-:|:-:|:-:|
| Tout consulter | ✅ | ✅ | ✅ | ✅ |
| Ajouter et modifier des pièces, prix, statuts | ✅ | ✅ | ✅ | — |
| Valider un devis | ✅ | ✅ | — | — |
| Marquer une pièce montée | ✅ | ✅ | ✅ | ✅ |
| Gérer le stock | ✅ | ✅ | ✅ | — |
| Supprimer une pièce | ✅ | ✅ | — | — |
| Gérer les comptes | ✅ | ✅ | — | — |

**L'assistant Telegram**
- On lui pose des questions : *« Qu'est-ce qui manque pour la Haval ? »*
- On lui annonce une mise à jour : *« Reçu les 12 injecteurs Rich 6 »*
- On lui envoie une photo de facture : il lit les lignes et propose de les ajouter.
- **Il ne modifie rien sans un clic sur ✅ Confirmer**, et il respecte le rôle de la personne.

**Sécurité**
- Chacun a son compte personnel avec mot de passe.
- Telegram est lié à ce compte par un code à 6 chiffres. Désactiver un compte coupe aussi son accès Telegram.
- L'application tourne sur le serveur de l'entreprise : les données restent chez vous.

**Coûts**
- L'application et la base de données sont gratuites (logiciels libres).
- Il faut payer le serveur et le nom de domaine.
- L'IA coûte quelques centaines à quelques milliers de FCFA par mois selon l'usage, avec une limite de crédit réglable.

**Prochaines étapes**
1. L'IT installe l'application et crée les comptes.
2. Test d'une semaine sur les commandes en cours.
3. Ensuite : alertes Telegram automatiques (retards, stock bas, devis à valider) et export Excel.