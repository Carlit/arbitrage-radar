# Project Rules (Spec-Driven Development)

Ce repository utilise un workflow **Spec-Driven Development** inspiré du GitHub Spec Kit.
Tout travail non trivial (nouvelle fonctionnalité, refactor touchant plusieurs fichiers,
tout ce qui touche la sécurité, l'auth, ou le multi-tenant) DOIT suivre ce flux, dans l'ordre :

1. `/constitution` — (re)affirmer les principes et contraintes du projet (voir `memory/constitution.md`)
2. `/specify` — définir le besoin : quoi, pourquoi, pour qui (pas comment)
3. `/clarify` — lever les ambiguïtés AVANT toute planification technique
4. `/plan` — choisir la stack, l'architecture, les impacts sur le schéma de données
5. `/tasks` — découper le plan en tâches unitaires, testables, ordonnées
6. `/analyze` — vérifier la cohérence entre spec, plan et tâches avant de coder
7. `/implement` — exécuter les tâches, une par une

## Règles non négociables

- **Ne jamais coder directement une demande complexe sans passer par `/specify` puis `/plan`.**
  Si une demande arrive sans spec ni plan validés, la première réponse doit être de proposer
  une spec courte, pas du code.
- **Sécurité et RLS (Row Level Security) :** toute solution qui contourne une policy RLS
  (ex: usage de la Service Role Key côté serveur pour "démo" ou "MVP rapide") doit être
  signalée explicitement comme un compromis temporaire dans le plan, jamais appliquée
  silencieusement. Le plan doit toujours inclure le chemin vers la vraie policy RLS.
- **Multi-tenant :** toute nouvelle table ou requête touchant des données utilisateur doit
  préciser dans le plan comment l'isolation par tenant est garantie (RLS, filtre applicatif,
  ou les deux).
- **Les artefacts font foi.** Ne jamais coder "de mémoire" sur un besoin déjà spécifié :
  se référer à `memory/constitution.md` et aux fichiers dans `specs/`.
- Après `/implement`, mettre à jour le fichier de spec correspondant avec le statut réel
  (fait / partiellement fait / reste à faire), pas seulement dans le chat.

## Où vivent les artefacts

- `memory/constitution.md` — principes durables du projet (stack, conventions, contraintes de sécurité)
- `specs/<nom-feature>/spec.md` — le besoin (issu de `/specify` + `/clarify`)
- `specs/<nom-feature>/plan.md` — l'architecture retenue (issu de `/plan`)
- `specs/<nom-feature>/tasks.md` — la liste de tâches (issu de `/tasks`)
